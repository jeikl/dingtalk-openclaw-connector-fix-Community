/**
 * 钉钉 WebSocket 连接层
 *
 * 职责：
 * - 管理单个钉钉账号的 WebSocket 连接
 * - 实现应用层心跳检测（10 秒间隔，20 秒无 pong 超时）
 * - 处理连接重连逻辑，带指数退避
 * - 消息去重（内置 Map，5 分钟 TTL）
 *
 * 核心特性：
 * - 关闭 SDK 内置 keepAlive，使用自定义心跳
 * - connect 后等 OPEN + SYSTEM/REGISTERED 再报 ready（防首条消息丢失）
 * - 重连后先挂 pong/message/close listener 再等就绪（防幽灵重连）
 * - 详细的消息接收日志（三阶段：接收、解析、处理）
 * - 连接统计和监控（每分钟输出）
 */
import * as fs from 'fs';
import type { ClawdbotConfig, RuntimeEnv } from "openclaw/plugin-sdk";
import type { ResolvedDingtalkAccount } from "../types/index.ts";
import {
  checkAndMarkDingtalkMessage,
} from "../utils/utils-legacy.ts";
import {
  getActiveBackgroundWorkCount,
  onBackgroundWorkCountChange,
} from "../utils/background-work.ts";

// ============ 类型定义 ============

export type DingtalkReactionCreatedEvent = {
  type: "reaction_created";
  channelId: string;
  messageId: string;
  userId: string;
  emoji: string;
};

// 消息处理器函数类型
export type MessageHandler = (params: {
  accountId: string;
  config: any;
  data: any;
  sessionWebhook: string;
  runtime?: RuntimeEnv;
  log?: any;
  cfg: ClawdbotConfig;
}) => Promise<void>;

/** 连接状态变更回调，用于向框架报告 connected / lastInboundAt 等字段 */
export type OnStatusChange = (patch: Record<string, unknown>) => void;

export type MonitorDingtalkAccountOpts = {
  cfg: ClawdbotConfig;
  account: ResolvedDingtalkAccount;
  runtime?: RuntimeEnv;
  abortSignal?: AbortSignal;
  messageHandler: MessageHandler;
  /** 可选：连接状态变更时回调，用于更新 UI 显示的 Connected / Last inbound 字段 */
  onStatusChange?: OnStatusChange;
};

// ============ 连接配置 ============

/** 心跳间隔（毫秒） */
const HEARTBEAT_INTERVAL = 10 * 1000; // 10 秒
/**
 * 无 pong 软超时：仅计「连续未确认」次数，不立刻 disconnect。
 * 过去这里直接 doReconnect()，会在 socket 仍 OPEN 时拆掉活连接，
 * 造成数秒空窗 → 用户连发 3~7 条消息钉钉推不到本进程（网关 UI 完全收不到）。
 */
const SOFT_STALE_MS = 20 * 1000;
/** 连续软超时次数达到该值，且 socket 非 OPEN 或 ping 失败，才硬重连 */
const HARD_RECONNECT_AFTER_MISSES = 3;
/** 两次硬重连之间的最小间隔（除非 socket 已死） */
const MIN_RECONNECT_GAP_MS = 30 * 1000;
/**
 * 消息处理期间刷新 lastSocketAvailableTime 的间隔。
 * 必须明显小于 SOFT_STALE_MS。
 */
const MESSAGE_PROCESSING_KEEPALIVE_MS = 15 * 1000; // 15 秒
/** 基础退避时间（毫秒） */
const BASE_BACKOFF_DELAY = 1000; // 1 秒
/** 最大退避时间（毫秒） */
const MAX_BACKOFF_DELAY = 30 * 1000; // 30 秒
/** 单次等待 OPEN + REGISTERED 的超时 */
const STREAM_READY_TIMEOUT_MS = 15_000;
/**
 * REGISTERED 未就绪时最多完整重连次数（含首次）。
 * 超时禁止 OPEN-only 假 ready，避免「显示已连接但收不到 CALLBACK」。
 */
const REGISTERED_CONNECT_MAX_ATTEMPTS = 5;

// ============ 上游 SDK 噪音抑制（借鉴官方 #571/#536/#573）============
// dingtalk-stream 在 connect/disconnect 时直接 console.info 两条固定串，
// 绕过插件 logger，频繁重连时会刷屏造成「故障」误判。只过滤这两条精确匹配。
let _streamNoiseSilenced = false;
function silenceDingtalkStreamConsoleNoise(): void {
  if (_streamNoiseSilenced) return;
  _streamNoiseSilenced = true;
  const origConsoleInfo = console.info.bind(console);
  console.info = (...args: any[]) => {
    const first = args[0];
    if (typeof first === "string") {
      if (first === "Disconnecting.") return;
      if (/^\[[^\]]+\] connect success$/.test(first)) return;
    }
    return origConsoleInfo(...args);
  };
}

let _connectionNoticePrinted = false;
function printConnectionNoticeOnce(): void {
  if (_connectionNoticePrinted) return;
  _connectionNoticePrinted = true;
  console.log(
    "[dingtalk-connector] ℹ️  上游 dingtalk-stream 噪音已过滤；" +
      "须 OPEN+REGISTERED 才报 ready，REGISTERED 超时会强制重连（禁止假 online）。" +
      "正常运行不应出现 ≤30s 周期性硬重连。",
  );
}

// ============ 监控账号 ============

export async function monitorSingleAccount(
  opts: MonitorDingtalkAccountOpts,
): Promise<void> {
  const { cfg, account, runtime, abortSignal, messageHandler, onStatusChange } = opts;
  const { accountId } = account;

  // 在动态 import dingtalk-stream 之前抑制其 console.info 噪音
  silenceDingtalkStreamConsoleNoise();

  // 保存 cfg 以便传递给 messageHandler
  const clawdbotConfig = cfg;
  const log = runtime?.log;
  
  // 创建 debug logger（仅在 debug 模式下输出 info/debug 日志）
  const { createLoggerFromConfig } = await import('../utils/logger');
  const logger = createLoggerFromConfig(account.config, `DingTalk:${accountId}`);

  // 验证凭据是否存在
  if (!account.clientId || !account.clientSecret) {
    throw new Error(
      `[DingTalk][${accountId}] Missing credentials: ` +
        `clientId=${account.clientId ? "present" : "MISSING"}, ` +
        `clientSecret=${account.clientSecret ? "present" : "MISSING"}. ` +
        `Please check your configuration in channels.dingtalk-connector.`,
    );
  }

  // 验证凭据格式
  const clientIdStr = String(account.clientId);
  const clientSecretStr = String(account.clientSecret);

  if (clientIdStr.length < 10 || clientSecretStr.length < 10) {
    throw new Error(
      `[DingTalk][${accountId}] Invalid credentials format: ` +
        `clientId length=${clientIdStr.length}, clientSecret length=${clientSecretStr.length}. ` +
        `Credentials appear to be too short or invalid.`,
    );
  }

  // ============ 修复 macOS LaunchAgent 环境下的文件描述符问题 ============
  //
  // 在 macOS LaunchAgent/daemon 环境下，进程启动时 stdin/stdout/stderr（fd 0/1/2）
  // 可能无效（EBADF），导致 Node.js 的 net.Socket 在创建 TCP 连接时出现 EBADF 错误。
  // 通过打开 /dev/null 来确保 fd 0/1/2 有效，避免 socket 创建时使用无效的 fd。
  //
  // 参考：OpenClaw issue #8021 (spawn EBADF on macOS with Node.js 22+)
  if (process.platform === 'darwin') {
    for (const stdioFd of [0, 1, 2]) {
      try {
        fs.fstatSync(stdioFd);
      } catch (fdError: any) {
        if (fdError.code === 'EBADF') {
          logger.warn(`[LaunchAgent] 检测到 fd ${stdioFd} 无效（EBADF），重定向到 /dev/null 以防止 TCP socket 创建失败`);
          try {
            fs.openSync('/dev/null', stdioFd === 0 ? 'r' : 'w');
          } catch (openError: any) {
            logger.warn(`[LaunchAgent] 无法修复 fd ${stdioFd}: ${openError.message}`);
          }
        }
      }
    }
  }

  logger.info(`Starting DingTalk Stream client...`);
  logger.info(`Initializing with clientId: ${clientIdStr.substring(0, 8)}...`);
  logger.info(`WebSocket keepAlive: false (using application-layer heartbeat)`);

  // 动态导入 dingtalk-stream 模块（避免循环依赖和 ESM/CJS 兼容性问题）
  const dingtalkStreamModule = await import("dingtalk-stream");
  const DWClient = dingtalkStreamModule.DWClient;
  const { TOPIC_ROBOT } = dingtalkStreamModule;

  if (!DWClient) {
    throw new Error("Failed to import DWClient from dingtalk-stream module");
  }

  // 配置 DWClient：禁用 SDK 内置的 keepAlive 和 autoReconnect，使用自定义实现
  const client = new DWClient({
    clientId: account.clientId,
    clientSecret: account.clientSecret,
    debug: account.config.debug,
    // 显式设置 HTTPS endpoint，防止被降级为 HTTP
    endpoint: account.config.endpoint || "https://api.dingtalk.com",
    autoReconnect: false, // ❌ 禁用 SDK 自动重连
    keepAlive: false, // ❌ 禁用 SDK 心跳检测
  } as any);

  // ============ 连接状态管理 ============

  let lastSocketAvailableTime = Date.now();
  let connectionEstablishedTime = Date.now(); // 记录连接建立时间
  let isReconnecting = false;
  let reconnectAttempts = 0;
  let keepAliveTimer: NodeJS.Timeout | null = null;
  let isStopped = false;
  /** 连续 keepAlive 周期内未收到 pong / 未刷新的次数 */
  let consecutiveStaleMisses = 0;
  let lastHardReconnectAt = 0;
  
  // ============ 消息处理活跃标记 ============
  // 覆盖「WS 回调短暂入队」+「sessionQueues 后台 AI 全长」（见 background-work.ts）
  // 仅覆盖 WS 回调会导致：入队后立刻 End → 503/长任务期间幽灵重连 → 后续消息无反应
  let wsCallbackActive = false;
  let activeMessageProcessing = false;
  let messageProcessingKeepAliveTimer: NodeJS.Timeout | null = null;
  let unsubscribeBackgroundWork: (() => void) | null = null;

  function ensureProcessingKeepAliveTimer(): void {
    if (messageProcessingKeepAliveTimer) return;
    messageProcessingKeepAliveTimer = setInterval(() => {
      if (activeMessageProcessing) {
        lastSocketAvailableTime = Date.now();
        logger.debug(
          `📝 消息处理中，更新 socket 可用时间 (ws=${wsCallbackActive} bg=${getActiveBackgroundWorkCount()})`,
        );
      }
    }, MESSAGE_PROCESSING_KEEPALIVE_MS);
  }

  function clearProcessingKeepAliveTimer(): void {
    if (messageProcessingKeepAliveTimer) {
      clearInterval(messageProcessingKeepAliveTimer);
      messageProcessingKeepAliveTimer = null;
    }
  }

  /** 根据 WS 入队中 / 后台任务数 合成 activeMessageProcessing */
  function refreshProcessingActive(reason: string): void {
    const bg = getActiveBackgroundWorkCount();
    const next = wsCallbackActive || bg > 0;
    activeMessageProcessing = next;
    lastSocketAvailableTime = Date.now();
    if (next) {
      ensureProcessingKeepAliveTimer();
      logger.debug(
        `📝 处理活跃 reason=${reason} ws=${wsCallbackActive} bg=${bg}`,
      );
    } else {
      clearProcessingKeepAliveTimer();
      logger.debug(`✅ 处理空闲 reason=${reason}`);
    }
  }

  function markMessageProcessingStart() {
    wsCallbackActive = true;
    refreshProcessingActive("ws-start");
  }

  function markMessageProcessingEnd() {
    wsCallbackActive = false;
    refreshProcessingActive("ws-end");
  }

  unsubscribeBackgroundWork = onBackgroundWorkCountChange(() => {
    refreshProcessingActive("bg-count");
  });

  // ============ 辅助函数 ============

  /** 计算指数退避延迟（带抖动） */
  function calculateBackoffDelay(attempt: number): number {
    const exponentialDelay = BASE_BACKOFF_DELAY * Math.pow(2, attempt);
    const jitter = Math.random() * 1000; // 0-1 秒随机抖动
    return Math.min(exponentialDelay + jitter, MAX_BACKOFF_DELAY);
  }

  /**
   * 等待钉钉 Stream 真正可收消息。
   *
   * dingtalk-stream 的 client.connect() 在创建 WebSocket 后立刻 resolve，
   * **不等** socket open，更不等服务端 SYSTEM/REGISTERED。
   *
   * 顺序：socket OPEN → SYSTEM topic=REGISTERED（client.registered=true）
   * 任一步失败均 throw，禁止 OPEN-only 假 ready。
   */
  async function waitForStreamReady(timeoutMs = STREAM_READY_TIMEOUT_MS): Promise<void> {
    const started = Date.now();

    // 1) 等 WebSocket OPEN
    if ((client as any).socket?.readyState !== 1) {
      const opened = await new Promise<boolean>((resolve) => {
        const socket = (client as any).socket;
        if (!socket) {
          resolve(false);
          return;
        }
        if (socket.readyState === 1) {
          resolve(true);
          return;
        }
        const remain = Math.max(1_000, timeoutMs - (Date.now() - started));
        let settled = false;
        const finish = (ok: boolean) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          socket.removeListener?.("open", onOpen);
          socket.removeListener?.("error", onError);
          resolve(ok);
        };
        const timer = setTimeout(() => finish(false), remain);
        const onOpen = () => finish(true);
        const onError = () => finish(false);
        socket.once("open", onOpen);
        socket.once("error", onError);
      });
      if (!opened) {
        throw new Error(`WebSocket OPEN 超时（${timeoutMs}ms）`);
      }
    }

    // 2) 等服务端 REGISTERED（订阅生效，此后 CALLBACK 才会推到本连接）
    if ((client as any).registered === true) {
      logger.info(
        `✅ Stream 已就绪（OPEN + REGISTERED），耗时 ${Date.now() - started}ms`,
      );
      return;
    }

    const registered = await new Promise<boolean>((resolve) => {
      const socket = (client as any).socket;
      if (!socket) {
        resolve(false);
        return;
      }
      const remain = Math.max(1_000, timeoutMs - (Date.now() - started));
      let settled = false;
      const finish = (ok: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        clearInterval(poll);
        socket.removeListener?.("message", onMessage);
        resolve(ok);
      };
      const timer = setTimeout(() => finish(false), remain);

      const onMessage = (data: any) => {
        try {
          const raw = typeof data === "string" ? data : data?.toString?.() ?? String(data);
          const msg = JSON.parse(raw);
          if (msg?.type === "SYSTEM" && msg?.headers?.topic === "REGISTERED") {
            finish(true);
            return;
          }
        } catch {
          // ignore parse errors
        }
        if ((client as any).registered === true) {
          finish(true);
        }
      };

      const poll = setInterval(() => {
        if ((client as any).registered === true) {
          finish(true);
        }
      }, 100);

      socket.on("message", onMessage);
    });

    if (registered || (client as any).registered === true) {
      logger.info(
        `✅ Stream 已就绪（OPEN + REGISTERED），耗时 ${Date.now() - started}ms`,
      );
      return;
    }

    // 禁止 OPEN-only 假 ready：未 REGISTERED 一律失败，由上层强制重连
    throw new Error(
      `SYSTEM/REGISTERED 超时（${timeoutMs}ms）：socket 已 OPEN 但订阅未生效，禁止报 connected`,
    );
  }

  /**
   * connect 之后、wait ready 之前挂上 pong/message/close。
   * 官方 #566：若在 connect 前 setup，socket 为 undefined，listener 静默 no-op →
   * pong 无人接 → lastSocketAvailableTime 不刷新 → TIMEOUT 幽灵重连。
   * 必须在 wait OPEN 之前挂好，否则等待窗内的 pong 也会丢。
   */
  function attachSocketLifecycleListeners(): void {
    setupPongListener();
    setupMessageListener();
    setupCloseListener();
  }

  /**
   * 单次：connect + 挂 listener + 等 OPEN/REGISTERED。
   * 失败 throw，不报 connected。
   */
  async function connectAndWaitRegistered(): Promise<void> {
    await client.connect();
    attachSocketLifecycleListeners();
    await waitForStreamReady(STREAM_READY_TIMEOUT_MS);
    if ((client as any).registered !== true) {
      // 双保险：wait 已要求 registered，此处再断言
      throw new Error("connect 后 client.registered 仍为 false");
    }
  }

  /**
   * 直到 REGISTERED 成功或次数用尽。
   * 用于初次启动与硬重连：绝不在未订阅时对外 connected=true。
   */
  async function ensureRegisteredConnection(
    maxAttempts = REGISTERED_CONNECT_MAX_ATTEMPTS,
  ): Promise<void> {
    let lastError: Error | undefined;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (isStopped) {
        throw new Error("连接已停止，中止 REGISTERED 等待");
      }
      try {
        if (attempt > 1) {
          logger.warn(
            `🔄 REGISTERED 未就绪，强制重连 ${attempt}/${maxAttempts}…`,
          );
          try {
            if ((client as any).socket) {
              await client.disconnect();
            }
          } catch (discErr: any) {
            logger.debug(`断开旧连接: ${discErr?.message || discErr}`);
          }
          const delay = Math.min(1000 * attempt, 5_000);
          await new Promise((r) => setTimeout(r, delay));
        } else {
          logger.info(
            `⏳ 建立 Stream 并等待 REGISTERED（单次超时 ${STREAM_READY_TIMEOUT_MS}ms，最多 ${maxAttempts} 次）…`,
          );
        }

        await connectAndWaitRegistered();
        noteSocketAlive("registered-ok");
        connectionEstablishedTime = Date.now();
        logger.info(
          `✅ 订阅已生效 registered=true（attempt ${attempt}/${maxAttempts}, ` +
            `socket=${(client as any).socket?.readyState}）`,
        );
        return;
      } catch (err: any) {
        lastError = err instanceof Error ? err : new Error(String(err));
        logger.warn(
          `⚠️ Stream 就绪失败 attempt=${attempt}/${maxAttempts}: ${lastError.message}`,
        );
      }
    }
    throw new Error(
      `钉钉 Stream 在 ${maxAttempts} 次尝试后仍未 REGISTERED，拒绝假 connected。` +
        ` 最后错误: ${lastError?.message || "unknown"}`,
    );
  }

  /** 统一重连函数，带指数退避（无限重连） */
  async function doReconnect(immediate = false) {
    if (isReconnecting || isStopped) {
      logger.debug(`正在重连中或已停止，跳过`);
      return;
    }

    isReconnecting = true;

    // 应用指数退避（非立即重连时）
    if (!immediate && reconnectAttempts > 0) {
      const delay = calculateBackoffDelay(reconnectAttempts);
      logger.info(
        `⏳ 等待 ${Math.round(delay / 1000)} 秒后重连 (尝试 ${reconnectAttempts + 1})`,
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }

    try {
      // 1. 先断开旧连接
      if ((client as any).socket?.readyState === 1 || (client as any).socket?.readyState === 3) {
        await client.disconnect();
        logger.info(`已断开旧连接`);
      }

      // 2. 重连直到 REGISTERED（内部含 connect + listener + wait，失败会多轮）
      await ensureRegisteredConnection(REGISTERED_CONNECT_MAX_ATTEMPTS);

      // 3. 重置计时与状态
      noteSocketAlive("reconnect-ok");
      connectionEstablishedTime = Date.now();
      reconnectAttempts = 0;
      lastHardReconnectAt = Date.now();

      // 4. 真正可收 CALLBACK 后再报 connected
      onStatusChange?.({ connected: true, lastConnectedAt: Date.now() });

      logger.info(
        `✅ 重连成功 (socket=${(client as any).socket?.readyState}, registered=${Boolean((client as any).registered)})`,
      );
    } catch (err: any) {
      reconnectAttempts++;
      // 未 REGISTERED：保持 connected=false，避免 UI 假在线
      onStatusChange?.({ connected: false });
      logger.error(
        `重连失败：${err.message} (尝试 ${reconnectAttempts})`,
      );
      throw err;
    } finally {
      isReconnecting = false;
    }
  }

  /** 监听 pong 响应（更新 socket 可用时间） */
  function setupPongListener() {
    (client as any).socket?.on("pong", () => {
      lastSocketAvailableTime = Date.now();
      consecutiveStaleMisses = 0;
      logger.debug(`收到 PONG 响应`);
    });
  }

  function noteSocketAlive(reason: string): void {
    lastSocketAvailableTime = Date.now();
    consecutiveStaleMisses = 0;
    logger.debug(`socket alive reason=${reason}`);
  }

  /** 监听 WebSocket message 事件，收到 disconnect 消息时立即触发重连 */
  function setupMessageListener() {
    (client as any).socket?.on("message", (data: any) => {
      try {
        const msg = JSON.parse(data);
        if (msg.type === "SYSTEM" && msg.headers?.topic === "disconnect") {
          if (!isStopped && !isReconnecting) {
            // 立即重连，不退避
            doReconnect(true).catch((err) => {
              logger.error(`[${accountId}] 重连失败：${err.message}`);
            });
          }
        }
      } catch (e) {
        // 忽略解析错误
      }
    });
  }

  /** 监听 WebSocket close 事件，服务端主动断开时立即触发重连 */
  function setupCloseListener() {
    (client as any).socket?.on("close", (code, reason) => {
      logger.info(
        `WebSocket close: code=${code}, reason=${reason || "未知"}, isStopped=${isStopped}`,
      );

      // 连接断开时，向框架报告 connected: false
      onStatusChange?.({ connected: false });

      if (isStopped) {
        return;
      }

      // 立即重连，不退避
      setTimeout(() => {
        doReconnect(true).catch((err) => {
          logger.error(`重连失败：${err.message}`);
        });
      }, 0);
    });
  }

  /**
   * 请求硬重连（拆 socket）。
   * - socket 仍 OPEN：先补 PING，连续 misses 未达阈值则绝不拆连接（防空窗吞消息）
   * - socket 已死：立即重连
   * - 冷却：非死连接时距上次硬重连 < MIN_RECONNECT_GAP_MS 则跳过
   */
  async function requestHardReconnect(reason: string, socketDead = false): Promise<void> {
    if (isReconnecting || isStopped) return;

    const socketState = (client as any).socket?.readyState;

    // 活连接：优先补 ping，未达连续 miss 阈值不拆
    if (!socketDead && socketState === 1) {
      try {
        (client as any).socket?.ping();
        logger.warn(
          `⚠️ 软超时但 socket 仍 OPEN (reason=${reason}, misses=${consecutiveStaleMisses}/${HARD_RECONNECT_AFTER_MISSES})，仅补 PING`,
        );
      } catch (err: any) {
        logger.warn(`补 PING 失败: ${err.message}`);
        consecutiveStaleMisses += 1;
      }
      if (consecutiveStaleMisses < HARD_RECONNECT_AFTER_MISSES) {
        return;
      }
    }

    // 冷却（socket 已死时跳过冷却）
    if (!socketDead) {
      const gap = Date.now() - lastHardReconnectAt;
      if (lastHardReconnectAt > 0 && gap < MIN_RECONNECT_GAP_MS) {
        logger.warn(
          `⚠️ 跳过硬重连：距上次仅 ${Math.round(gap / 1000)}s < ${MIN_RECONNECT_GAP_MS / 1000}s 冷却 (reason=${reason})`,
        );
        return;
      }
    }

    lastHardReconnectAt = Date.now();
    consecutiveStaleMisses = 0;
    logger.info(`🔄 硬重连 reason=${reason} socket=${socketState}`);
    await doReconnect(socketDead);
  }

  /**
   * 启动 keepAlive：
   * - 10s 发 ping；pong 刷新 lastSocketAvailableTime
   * - 软超时只计数 + 补 ping，达到 HARD_RECONNECT_AFTER_MISSES 且 socket 异常才拆连接
   * - 处理中任务期间绝不硬重连
   */
  function startKeepAlive(): () => void {
    logger.debug(
      `🚀 启动 keepAlive 定时器，间隔=${HEARTBEAT_INTERVAL / 1000}秒`,
    );

    keepAliveTimer = setInterval(async () => {
      if (isStopped) {
        if (keepAliveTimer) clearInterval(keepAliveTimer);
        return;
      }

      try {
        const elapsed = Date.now() - lastSocketAvailableTime;
        const socketState = (client as any).socket?.readyState;
        const timeSinceConnection = Date.now() - connectionEstablishedTime;

        logger.debug(
          `心跳检测：socket=${socketState}, elapsed=${Math.round(elapsed / 1000)}s, ` +
            `misses=${consecutiveStaleMisses}, processing=${activeMessageProcessing}, ` +
            `connectedFor=${Math.round(timeSinceConnection / 1000)}s`,
        );

        // socket 非 OPEN：宽限期后硬重连
        if (socketState !== 1) {
          if (timeSinceConnection < 15_000) {
            logger.debug(
              `⏳ 连接建立中（已 ${Math.round(timeSinceConnection / 1000)}s），跳过状态检查`,
            );
            return;
          }
          if (activeMessageProcessing) {
            logger.warn(
              `⚠️ socket 非 OPEN 但消息处理中，暂缓硬重连 state=${socketState}`,
            );
            return;
          }
          await requestHardReconnect(`socket-dead state=${socketState}`, true);
          return;
        }

        // 软超时：无 pong/刷新超过 SOFT_STALE_MS
        if (elapsed > SOFT_STALE_MS) {
          consecutiveStaleMisses += 1;
          if (activeMessageProcessing) {
            noteSocketAlive("processing-hold");
            logger.warn(
              `⚠️ 软超时但处理中，刷新活跃时间不重连 (elapsed=${Math.round(elapsed / 1000)}s)`,
            );
            return;
          }
          logger.warn(
            `⚠️ 软超时 misses=${consecutiveStaleMisses}/${HARD_RECONNECT_AFTER_MISSES} ` +
              `elapsed=${Math.round(elapsed / 1000)}s socket=OPEN`,
          );
          // OPEN 时优先补 ping；达到次数再考虑硬重连
          await requestHardReconnect("stale-pong", false);
          return;
        }

        consecutiveStaleMisses = 0;

        // 正常心跳 ping（pong 到了才刷新时间戳）
        try {
          (client as any).socket?.ping();
          logger.debug(`💓 发送 PING 心跳成功`);
        } catch (err: any) {
          logger.warn(`发送 PING 失败：${err.message}`);
          consecutiveStaleMisses += 1;
          if (consecutiveStaleMisses >= HARD_RECONNECT_AFTER_MISSES) {
            await requestHardReconnect("ping-failed", true);
          }
        }
      } catch (err: any) {
        logger.error(`keepAlive 检测失败：${err.message}`);
      }
    }, HEARTBEAT_INTERVAL);

    logger.debug(`✅ keepAlive 定时器已启动`);

    return () => {
      if (keepAliveTimer) clearInterval(keepAliveTimer);
      keepAliveTimer = null;
      logger.debug(`keepAlive 定时器已清理`);
    };
  }

  /** 停止并清理所有资源 */
  function stop() {
    isStopped = true;

    // 清理心跳定时器
    if (keepAliveTimer) clearInterval(keepAliveTimer);
    keepAliveTimer = null;

    // 清理消息处理活跃标记定时器
    clearProcessingKeepAliveTimer();
    wsCallbackActive = false;
    activeMessageProcessing = false;
    unsubscribeBackgroundWork?.();
    unsubscribeBackgroundWork = null;

    // 清理事件监听器
    if ((client as any).socket) {
      (client as any).socket.removeAllListeners();
    }

    logger.debug(`Connection 已停止`);
  }

  return new Promise<void>(async (resolve, reject) => {
    // Handle abort signal
    if (abortSignal) {
      const onAbort = async () => {
        logger.info(`Abort signal received, stopping...`);
        stop();
        try {
          // 只在连接已建立时才断开
          if ((client as any).socket && (client as any).socket.readyState === 1) {
            await client.disconnect();
          }
        } catch (err: any) {
          logger.warn(`断开连接时出错：${err.message}`);
        }
        resolve();
      };
      abortSignal.addEventListener("abort", onAbort, { once: true });
    }

    // 消息接收统计（用于检测消息丢失）
    let receivedCount = 0;
    let processedCount = 0;
    let lastMessageTime = Date.now();

    // 定期输出统计信息
    const statsInterval = setInterval(() => {
      const now = Date.now();
      const timeSinceLastMessage = Math.round((now - lastMessageTime) / 1000);
      logger.info(
        `统计：收到=${receivedCount}, 处理=${processedCount}, ` +
          `丢失=${receivedCount - processedCount}, 距上次消息=${timeSinceLastMessage}s`,
      );
    }, 60000); // 每分钟输出一次

    // Register message handler
    client.registerCallbackListener(TOPIC_ROBOT, async (res: any) => {
      receivedCount++;
      lastMessageTime = Date.now();
      // 能收到 CALLBACK 说明链路活着——立刻刷新，打断「软超时→硬重连」误判
      noteSocketAlive("inbound-callback");

      // 收到消息时，向框架报告 lastInboundAt（用于 UI 显示 "Last inbound"）
      onStatusChange?.({ lastInboundAt: Date.now() });

      const messageId = res.headers?.messageId;
      const timestamp = new Date().toISOString();

      // ===== 第一步：记录原始消息接收 =====
      logger.info(`\n========== 收到新消息 ==========`);
      logger.info(`时间：${timestamp}`);
      logger.info(`MessageId: ${messageId || "N/A"}`);
      logger.info(`Headers: ${JSON.stringify(res.headers || {})}`);
      logger.info(`Data 长度：${res.data?.length || 0} 字符`);

      // ⚠️ 不要在解析/入队前 ACK。
      // 旧逻辑「立刻 socketCallBackResponse」：若随后去重误杀、解析失败、或入队前进程重连，
      // 钉钉认为已送达，不再重推 → 网关 UI 永远收不到。
      // 正确：入队成功后再 ACK；失败则不 ACK，让钉钉 ~60s 内重投。
      let acked = false;
      const ackMessage = (why: string) => {
        if (acked || !messageId) return;
        try {
          (client as any).socketCallBackResponse(messageId, { success: true });
          acked = true;
          logger.info(`✅ 已确认回调 messageId=${messageId} (${why})`);
        } catch (ackErr: any) {
          logger.warn(`确认回调失败: ${ackErr?.message || ackErr}`);
        }
      };

      markMessageProcessingStart();

      try {
        // 解析消息数据
        let data;
        try {
          data = JSON.parse(res.data);
        } catch (parseError: any) {
          logger.error('Failed to parse response data as JSON:', {
            error: parseError instanceof Error ? parseError.message : String(parseError),
            rawData: typeof res.data === 'string' 
              ? res.data.substring(0, 500)
              : res.data,
            dataType: typeof res.data,
          });
          // 解析失败：不 ACK，允许钉钉重投
          throw new Error(
            `Invalid JSON response from DingTalk API. ` +
            `Error: ${parseError instanceof Error ? parseError.message : String(parseError)}. ` +
            `Raw data (first 100 chars): ${String(res.data).substring(0, 100)}`
          );
        }

        // ===== 第二步：记录解析后的消息详情 =====
        logger.info(`\n----- 消息详情 -----`);
        logger.info(`消息类型：${data.msgtype || "unknown"}`);
        logger.info(
          `会话类型：${data.conversationType === "1" ? "DM (单聊)" : data.conversationType === "2" ? "Group (群聊)" : data.conversationType}`,
        );
        logger.info(
          `发送者：${data.senderNick || "unknown"} (${data.senderStaffId || data.senderId || "unknown"})`,
        );
        logger.info(`会话 ID: ${data.conversationId || "N/A"}`);
        logger.info(`消息 ID: ${data.msgId || "N/A"}`);
        logger.info(
          `SessionWebhook: ${data.sessionWebhook ? "已提供" : "未提供"}`,
        );
        logger.info(
          `RobotCode: ${data.robotCode || account.config?.clientId || "N/A"}`,
        );
        if (data.chatbotUserId || data.chatbotCorpId) {
          console.log(
            `[DingTalk:${accountId}] [BotIdentity] accountId=${accountId} chatbotUserId=${data.chatbotUserId || "N/A"} chatbotCorpId=${data.chatbotCorpId || "N/A"}`,
          );
        }

        const businessMsgId = data.msgId;

        // 双层去重：协议 messageId + 业务 msgId（须在解析后一次完成）
        if (checkAndMarkDingtalkMessage(accountId, messageId, businessMsgId)) {
          processedCount++;
          // 重复投递：ACK 掉避免钉钉无限重推
          ackMessage("duplicate");
          logger.warn(
            `⚠️ 检测到重复消息，跳过：protocol=${messageId || "-"} business=${businessMsgId || "-"} (${processedCount}/${receivedCount})`,
          );
          logger.info(`========== 消息处理结束（重复） ==========\n`);
          return;
        }

        let contentPreview = "N/A";
        if (data.text?.content) {
          contentPreview =
            data.text.content.length > 100
              ? data.text.content.substring(0, 100) + "..."
              : data.text.content;
        } else if (data.content) {
          contentPreview =
            JSON.stringify(data.content).substring(0, 100) + "...";
        }
        logger.info(`消息内容预览：${contentPreview}`);
        logger.info(`完整数据字段：${Object.keys(data).join(", ")}`);
        logger.info(`----- 消息详情结束 -----\n`);

        // ===== 第三步：入队处理 =====
        logger.info(`🚀 开始处理消息...`);

        await messageHandler({
          accountId,
          config: account.config,
          data,
          sessionWebhook: data.sessionWebhook,
          runtime,
          log,
          cfg: clawdbotConfig,
        });

        // 入队/受理成功后再 ACK（handleDingTalkMessage 返回表示已进 session 队列）
        ackMessage("enqueued");
        noteSocketAlive("after-enqueue");

        processedCount++;
        logger.info(`✅ 消息处理完成 (${processedCount}/${receivedCount})`);
        logger.info(`========== 消息处理结束（成功） ==========\n`);
      } catch (error: any) {
        processedCount++;
        const errorMsg = `❌ 处理消息异常 (${processedCount}/${receivedCount}): ${error?.message || "未知错误"}`;
        const errorStack = error?.stack || "无堆栈信息";
        
        logger.error(errorMsg);
        logger.error(`错误堆栈:\n${errorStack}`);
        
        // 未成功入队：故意不 ACK，让钉钉重投（最多约 60s）
        if (!acked) {
          logger.warn(
            `⚠️ 未 ACK messageId=${messageId || "N/A"}，等待钉钉重投（避免网关永久丢消息）`,
          );
        }
        
        logger.info(`========== 消息处理结束（失败） ==========\n`);
      } finally {
        markMessageProcessingEnd();
      }
    });

    // 清理定时器
    const cleanup = () => {
      clearInterval(statsInterval);
      stop();
    };

    // Connect to DingTalk Stream
    try {
      // 注意：registerCallbackListener 必须在 connect 之前（已在上方完成），
      // 这样 getEndpoint 会把 ROBOT 回调 topic 写进 subscriptions。
      //
      // 关键：禁止 OPEN-only 假 ready。
      // 未收到 SYSTEM/REGISTERED 时会强制多轮 disconnect+connect，
      // 直到 registered=true 才 onStatusChange(connected)；否则启动失败。
      await ensureRegisteredConnection(REGISTERED_CONNECT_MAX_ATTEMPTS);

      noteSocketAlive("initial-ready");
      connectionEstablishedTime = Date.now();

      logger.info(`Connected to DingTalk Stream successfully`);
      logger.info(`PID: ${process.pid}`);
      logger.info(
        `✅ keepAlive: 心跳 ${HEARTBEAT_INTERVAL / 1000}s / 软超时 ${SOFT_STALE_MS / 1000}s×${HARD_RECONNECT_AFTER_MISSES} / ` +
          `处理中刷新 ${MESSAGE_PROCESSING_KEEPALIVE_MS / 1000}s / 重连冷却 ${MIN_RECONNECT_GAP_MS / 1000}s, ` +
          `registered=${Boolean((client as any).registered)}`,
      );
      printConnectionNoticeOnce();

      // 仅 REGISTERED 成功后才报 connected
      onStatusChange?.({ connected: true, lastConnectedAt: Date.now() });

      // 启动自定义心跳检测
      const cleanupKeepAlive = startKeepAlive();

      // 重写 cleanup 函数，包含 keepAlive 清理
      const enhancedCleanup = () => {
        cleanupKeepAlive();
        clearInterval(statsInterval);
        stop();
      };

      // 进程退出时清理（使用 once 确保只执行一次）
      process.once("exit", enhancedCleanup);
      process.once("SIGINT", enhancedCleanup);
      process.once("SIGTERM", enhancedCleanup);
    } catch (error: any) {
      cleanup(); // 连接失败时清理资源

      // 记录完整错误信息用于调试
      logger.info(`连接失败，错误详情：`);
      logger.info(`  - error.message: ${error.message}`);
      logger.info(`  - error.response?.status: ${error.response?.status}`);
      logger.info(`  - error.response?.data: ${JSON.stringify(error.response?.data || {})}`);
      logger.info(`  - error.code: ${error.code}`);
      logger.info(`  - error.stack: ${error.stack?.split('\n').slice(0, 3).join('\n')}`);

      // 处理 400 错误（请求参数错误）
      if (error.response?.status === 400 || error.message?.includes("status code 400") || error.message?.includes("400")) {
        reject(new Error(
          `[DingTalk][${accountId}] Bad Request (400):\n` +
            `  - clientId or clientSecret format is invalid\n` +
            `  - clientId: ${clientIdStr} (type: ${typeof account.clientId}, length: ${clientIdStr.length})\n` +
            `  - clientSecret: ****** (type: ${typeof account.clientSecret}, length: ${clientSecretStr.length})\n` +
            `  - Common issues:\n` +
            `    1. clientId/clientSecret must be strings, not numbers\n` +
            `    2. Remove any quotes or special characters\n` +
            `    3. Ensure credentials are from the correct DingTalk app\n` +
            `    4. Check if clientId starts with 'ding' prefix\n` +
            `  - Error details: ${error.message}\n` +
            `  - Response data: ${JSON.stringify(error.response?.data || {})}`,
        ));
        return;
      }

      // 处理 401 认证错误
      if (error.response?.status === 401 || error.message?.includes("401")) {
        reject(new Error(
          `[DingTalk][${accountId}] Authentication failed (401 Unauthorized):\n` +
            `  - Your clientId or clientSecret is invalid, expired, or revoked\n` +
            `  - clientId: ${clientIdStr.substring(0, 8)}...\n` +
            `  - Please verify your credentials at DingTalk Developer Console\n` +
            `  - Error details: ${error.message}`,
        ));
        return;
      }

      // 处理其他连接错误
      reject(new Error(
        `[DingTalk][${accountId}] Failed to connect to DingTalk Stream: ${error.message}`,
      ));
      return;
    }

    // Handle disconnection（已被自定义 close 监听器替代）
    // client.on('close', ...) - 已移除，使用 setupCloseListener

    client.on("error", (err: Error) => {
      logger.error(`Connection error: ${err.message}`);
    });

    // 监听重连事件（仅用于日志，实际重连由自定义逻辑处理）
    client.on("reconnect", () => {
      logger.info(`SDK reconnecting...`);
    });

    client.on("reconnected", () => {
      logger.info(`✅ SDK reconnected successfully`);
    });
  });
}

export function resolveReactionSyntheticEvent(
  event: any,
): DingtalkReactionCreatedEvent | null {
  void event;
  return null;
}

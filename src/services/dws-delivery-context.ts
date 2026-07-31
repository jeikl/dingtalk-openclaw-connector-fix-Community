/**
 * DWS 发消息成功后注入 outbound_message 上下文（对齐 OpenClaw message 工具 OC-4）。
 *
 * - 不修改 dws 本体：仅解析 OpenClaw exec/shell 回调里看到的命令行
 * - 默认开启（target）：只在 dws 发消息成功时追加上下文，不影响普通回复 / message 工具
 * - 可配置 off | target | source | both
 */
import { CHANNEL_ID } from "../channel.ts";

export type DwsDeliveryContextMode = "off" | "target" | "source" | "both";

export type ParsedDwsSendCommand = {
  /** dws 子命令身份 */
  kind: "user-send" | "bot-send" | "webhook-send" | "reply";
  /** 规范化后的 message 工具风格 target：group:… / user:… */
  target?: string;
  /** 原始 openConversationId / userId / openDingTalkId */
  rawTarget?: string;
  targetChatType?: "group" | "direct";
  message?: string;
  title?: string;
  atAll?: boolean;
  atUserIds?: string[];
  atOpenDingTalkIds?: string[];
  atMobiles?: string[];
  robotCode?: string;
  /** 原始命令文本（截断后写入 args） */
  command: string;
};

const SEND_COMMAND_RE =
  /\bdws\b(?:\s+[^\s]+)*\s+chat\s+message\s+(send-by-bot|send-by-webhook|send|reply)\b/i;

/** 从命令行提取 --flag value / --flag=value / 布尔 --flag */
function extractFlag(cmd: string, name: string): string | undefined {
  const eq = new RegExp(`--${name}(?:=|\\s+)(?:"([^"]*)"|'([^']*)'|(\\S+))`, "i");
  const m = cmd.match(eq);
  if (!m) return undefined;
  return (m[1] ?? m[2] ?? m[3] ?? "").trim() || undefined;
}

function hasBoolFlag(cmd: string, name: string): boolean {
  return new RegExp(`(?:^|\\s)--${name}(?:\\s|=|$)`, "i").test(cmd);
}

function splitCsv(raw?: string): string[] | undefined {
  if (!raw) return undefined;
  const parts = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length ? parts : undefined;
}

/**
 * 判断是否为 dws 发消息类命令，并解析关键参数。
 * 解析失败返回 null（调用方 no-op，不影响现有体验）。
 */
/** 折叠 shell 续行 `\` + 换行，便于从 tool title/output 里解析 */
function normalizeShellCommandText(raw: string): string {
  return String(raw || "")
    .replace(/\\\r?\n/g, " ")
    .replace(/\r?\n/g, " ")
    .replace(/[ \t]+/g, " ")
    .trim();
}

export function parseDwsSendCommand(commandText: string): ParsedDwsSendCommand | null {
  const cmd = normalizeShellCommandText(commandText);
  if (!cmd) return null;
  const m = cmd.match(SEND_COMMAND_RE);
  if (!m) return null;

  const sub = m[1].toLowerCase();
  let kind: ParsedDwsSendCommand["kind"];
  if (sub === "send-by-bot") kind = "bot-send";
  else if (sub === "send-by-webhook") kind = "webhook-send";
  else if (sub === "reply") kind = "reply";
  else kind = "user-send";

  const group =
    extractFlag(cmd, "group") ||
    extractFlag(cmd, "conversation-id") ||
    extractFlag(cmd, "id") ||
    extractFlag(cmd, "chat");
  const user =
    extractFlag(cmd, "user") ||
    extractFlag(cmd, "open-dingtalk-id") ||
    // 批量单聊取第一个，便于 session 映射
    splitCsv(extractFlag(cmd, "users"))?.[0] ||
    splitCsv(extractFlag(cmd, "open-dingtalk-ids"))?.[0];

  const text =
    extractFlag(cmd, "text") ||
    extractFlag(cmd, "content") ||
    extractFlag(cmd, "body") ||
    extractFlag(cmd, "message") ||
    extractFlag(cmd, "markdown");

  let target: string | undefined;
  let rawTarget: string | undefined;
  let targetChatType: "group" | "direct" | undefined;

  if (group) {
    rawTarget = group.replace(/^(group:|channel:)/i, "");
    target = `group:${rawTarget}`;
    targetChatType = "group";
  } else if (user) {
    rawTarget = user.replace(/^(user:|dm:)/i, "");
    target = `user:${rawTarget}`;
    targetChatType = "direct";
  }

  // webhook 无明确会话目标时无法写 target session
  if (kind === "webhook-send" && !target) {
    return {
      kind,
      message: text,
      title: extractFlag(cmd, "title"),
      atAll: hasBoolFlag(cmd, "at-all"),
      atUserIds: splitCsv(extractFlag(cmd, "at-users")),
      atMobiles: splitCsv(extractFlag(cmd, "at-mobiles")),
      command: cmd.slice(0, 2000),
    };
  }

  return {
    kind,
    target,
    rawTarget,
    targetChatType,
    message: text,
    title: extractFlag(cmd, "title"),
    atAll: hasBoolFlag(cmd, "at-all"),
    atUserIds:
      splitCsv(extractFlag(cmd, "at-user-ids")) ||
      splitCsv(extractFlag(cmd, "at-users")),
    atOpenDingTalkIds: splitCsv(extractFlag(cmd, "at-open-dingtalk-ids")),
    atMobiles: splitCsv(extractFlag(cmd, "at-mobiles")),
    robotCode: extractFlag(cmd, "robot-code"),
    command: cmd.slice(0, 2000),
  };
}

export function resolveDwsDeliveryContextMode(
  config: any,
): DwsDeliveryContextMode {
  const raw = config?.dwsDeliveryContext;
  if (raw === "off" || raw === false) return "off";
  if (raw === "source" || raw === "both" || raw === "target") return raw;
  // 默认 target：仅叠加，不改 message 工具 / 普通回复
  if (raw === true || raw === undefined || raw === null) return "target";
  return "off";
}

export type MaybeInjectDwsOutboundContextParams = {
  /** 完整 OpenClaw 配置（resolveOutboundSessionRoute 需要） */
  cfg: any;
  /** 账号合并后的钉钉配置（读取 dwsDeliveryContext） */
  accountConfig?: any;
  agentId: string;
  accountId?: string;
  /** 当前发起会话 sessionKey */
  sourceSessionKey: string;
  invokerId?: string;
  invokerName?: string;
  commandText: string;
  exitCode?: number | null;
  phase?: string;
  toolCallId?: string;
  log?: { info?: (...a: any[]) => void; warn?: (...a: any[]) => void };
};

let warnedMissingApi = false;

/** 始终打到 console，不依赖 debug 开关（否则生产无法排障） */
function alwaysLog(level: "info" | "warn" | "error", msg: string): void {
  const line = `[DingTalk][dwsDeliveryContext] ${msg}`;
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

function resolveModeFromConfigs(cfg: any, accountConfig?: any): DwsDeliveryContextMode {
  // 账号级 > 渠道顶层 > 默认 target
  if (accountConfig?.dwsDeliveryContext !== undefined) {
    return resolveDwsDeliveryContextMode(accountConfig);
  }
  const channelCfg = cfg?.channels?.[CHANNEL_ID];
  if (channelCfg?.dwsDeliveryContext !== undefined) {
    return resolveDwsDeliveryContextMode(channelCfg);
  }
  return "target";
}

/**
 * 加载 OC-4 append API。
 *
 * 注意：钉钉插件装在 ~/.openclaw/npm/projects/... 下，Node 从插件路径
 * 解析不到名为 openclaw/jeikclaw 的 package（包名还可能是 jeikclaw）。
 * 必须用 gateway 进程入口（process.argv[1]）定位 dist/plugin-sdk。
 */
async function loadOutboundRuntime(): Promise<{
  append?: (p: any) => Promise<void>;
  resolveRoute?: (p: any) => Promise<any>;
  ensureEntry?: (p: any) => Promise<void>;
  via?: string;
} | null> {
  const { pathToFileURL } = await import("node:url");
  const path = await import("node:path");
  const fs = await import("node:fs");
  const { createRequire } = await import("node:module");

  const candidates: string[] = [
    "openclaw/plugin-sdk/outbound-runtime",
    "jeikclaw/plugin-sdk/outbound-runtime",
    "jeikclaw/dist/plugin-sdk/outbound-runtime.js",
    "openclaw/dist/plugin-sdk/outbound-runtime.js",
  ];

  const pushIfExists = (filePath: string) => {
    try {
      if (filePath && fs.existsSync(filePath)) {
        candidates.push(pathToFileURL(filePath).href);
      }
    } catch {
      /* ignore */
    }
  };

  // gateway 入口通常是 .../jeikclaw/dist/index.js 或 openclaw.mjs
  const entry = typeof process.argv[1] === "string" ? process.argv[1] : "";
  if (entry) {
    const entryDir = path.dirname(path.resolve(entry));
    // .../dist/index.js → .../dist/plugin-sdk/outbound-runtime.js
    pushIfExists(path.join(entryDir, "plugin-sdk", "outbound-runtime.js"));
    // .../openclaw.mjs → .../dist/plugin-sdk/...
    pushIfExists(path.join(entryDir, "dist", "plugin-sdk", "outbound-runtime.js"));
    // 再向上找 package root
    let dir = entryDir;
    for (let i = 0; i < 5; i++) {
      const pkgJson = path.join(dir, "package.json");
      if (fs.existsSync(pkgJson)) {
        pushIfExists(path.join(dir, "dist", "plugin-sdk", "outbound-runtime.js"));
        pushIfExists(path.join(dir, "plugin-sdk", "outbound-runtime.js"));
        break;
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }

    // createRequire 从 gateway 入口解析 package 名
    try {
      const req = createRequire(pathToFileURL(path.resolve(entry)).href);
      for (const name of ["jeikclaw", "openclaw"]) {
        try {
          const pkgJson = req.resolve(`${name}/package.json`);
          const root = path.dirname(pkgJson);
          pushIfExists(path.join(root, "dist", "plugin-sdk", "outbound-runtime.js"));
        } catch {
          /* ignore */
        }
      }
    } catch {
      /* ignore */
    }
  }

  // 也试 process.execPath 同级的全局 node_modules
  try {
    const execDir = path.dirname(process.execPath);
    pushIfExists(
      path.join(execDir, "..", "lib", "node_modules", "jeikclaw", "dist", "plugin-sdk", "outbound-runtime.js"),
    );
    pushIfExists(
      path.join(execDir, "..", "lib", "node_modules", "openclaw", "dist", "plugin-sdk", "outbound-runtime.js"),
    );
  } catch {
    /* ignore */
  }

  const errors: string[] = [];
  const seen = new Set<string>();
  for (const id of candidates) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    try {
      const oc: any = await import(id);
      if (typeof oc.appendOutboundMessageDeliveryContext === "function") {
        return {
          append: oc.appendOutboundMessageDeliveryContext.bind(oc),
          resolveRoute:
            typeof oc.resolveOutboundSessionRoute === "function"
              ? oc.resolveOutboundSessionRoute.bind(oc)
              : undefined,
          ensureEntry:
            typeof oc.ensureOutboundSessionEntry === "function"
              ? oc.ensureOutboundSessionEntry.bind(oc)
              : undefined,
          via: id,
        };
      }
      errors.push(`${id}: no append export`);
    } catch (e: any) {
      errors.push(`${id}: ${e?.message || e}`);
    }
  }
  if (!warnedMissingApi) {
    warnedMissingApi = true;
    alwaysLog(
      "warn",
      `无法加载 outbound-runtime。argv1=${entry || "-"} tried=${seen.size} err=${errors.slice(0, 4).join(" | ")}`,
    );
  }
  return null;
}

/**
 * 在 dws 发消息命令成功结束后，向目标/来源会话写入 outbound_message。
 * 全程 best-effort，失败只打日志。
 */
export async function maybeInjectDwsOutboundContext(
  params: MaybeInjectDwsOutboundContextParams,
): Promise<boolean> {
  const log = params.log;
  const effectiveMode = resolveModeFromConfigs(params.cfg, params.accountConfig);

  if (effectiveMode === "off") return false;

  // 仅在命令结束且成功时注入
  if (params.phase && params.phase !== "end") return false;
  if (params.exitCode !== undefined && params.exitCode !== null && params.exitCode !== 0) {
    return false;
  }

  const parsed = parseDwsSendCommand(params.commandText);
  if (!parsed) {
    // 不是 dws send 命令：静默（避免刷屏）
    return false;
  }

  // 无明确 target 时，仅 source 模式才写
  if (!parsed.target && effectiveMode === "target") {
    alwaysLog(
      "warn",
      `解析到 dws ${parsed.kind} 但无 --group/--user 目标，跳过 target 注入。cmd=${parsed.command.slice(0, 160)}`,
    );
    return false;
  }

  try {
    const oc = await loadOutboundRuntime();
    if (!oc?.append) {
      return false;
    }

    let targetRoute: any = null;
    const targetTo = parsed.target;
    if (targetTo && typeof oc.resolveRoute === "function") {
      try {
        targetRoute = await oc.resolveRoute({
          cfg: params.cfg,
          channel: CHANNEL_ID,
          agentId: params.agentId,
          accountId: params.accountId,
          target: targetTo,
          currentSessionKey: params.sourceSessionKey,
        });
        if (targetRoute && typeof oc.ensureEntry === "function") {
          await oc.ensureEntry({
            cfg: params.cfg,
            channel: CHANNEL_ID,
            accountId: params.accountId,
            route: targetRoute,
          });
        }
      } catch (err: any) {
        alwaysLog("warn", `resolveOutboundSessionRoute 失败: ${err?.message || err}`);
        log?.warn?.(
          `[DingTalk][dwsDeliveryContext] resolveOutboundSessionRoute 失败: ${err?.message || err}`,
        );
      }
    }

    if (effectiveMode === "target" && !targetRoute?.sessionKey) {
      alwaysLog(
        "warn",
        `target 模式但未解析到 sessionKey，无法写入目标会话。targetTo=${targetTo} via=${oc.via}`,
      );
      return false;
    }

    // target 模式但路由失败 → 仍可写 source（若 both/source）
    const action =
      parsed.kind === "bot-send"
        ? "dws.chat.message.send-by-bot"
        : parsed.kind === "webhook-send"
          ? "dws.chat.message.send-by-webhook"
          : parsed.kind === "reply"
            ? "dws.chat.message.reply"
            : "dws.chat.message.send";

    const actionParams: Record<string, unknown> = {
      action: "send",
      via: "dws",
      dwsKind: parsed.kind,
      message: parsed.message ?? "",
      title: parsed.title,
      target: targetTo,
      to: parsed.rawTarget,
      channel: CHANNEL_ID,
      accountId: params.accountId,
      atAll: parsed.atAll || undefined,
      atUserIds: parsed.atUserIds,
      atOpenDingTalkIds: parsed.atOpenDingTalkIds,
      atMobiles: parsed.atMobiles,
      robotCode: parsed.robotCode,
      command: parsed.command,
    };

    const idempotencyKey =
      params.toolCallId?.trim() ||
      `dws:${params.sourceSessionKey}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;

    await oc.append({
      cfg: params.cfg,
      mode: effectiveMode,
      agentId: params.agentId,
      sourceSessionKey: params.sourceSessionKey,
      sourceAccountId: params.accountId,
      invokerId: params.invokerId,
      invokerName: params.invokerName,
      targetTo: targetTo || params.sourceSessionKey,
      targetChannel: CHANNEL_ID,
      targetAccountId: params.accountId,
      targetRoute,
      actionParams,
      action,
      idempotencyKey,
    });

    alwaysLog(
      "info",
      `已注入 outbound_message mode=${effectiveMode} kind=${parsed.kind} target=${targetTo || "-"} route=${targetRoute?.sessionKey || "-"} via=${oc.via}`,
    );
    log?.info?.(
      `[DingTalk][dwsDeliveryContext] 已注入 outbound_message mode=${effectiveMode} kind=${parsed.kind} target=${targetTo || "-"} route=${targetRoute?.sessionKey || "-"}`,
    );
    return true;
  } catch (err: any) {
    alwaysLog("warn", `注入失败（已忽略，不影响发消息）: ${err?.message || err}`);
    log?.warn?.(
      `[DingTalk][dwsDeliveryContext] 注入失败（已忽略，不影响发消息）: ${err?.message || err}`,
    );
    return false;
  }
}

// 类型定义
interface ClawdbotConfig {
  [key: string]: any;
}

interface RuntimeEnv {
  log?: (...args: any[]) => void;
  error?: (...args: any[]) => void;
  warn?: (...args: any[]) => void;
  debug?: (...args: any[]) => void;
  info?: (...args: any[]) => void;
  [key: string]: any;
}

interface ReplyPayload {
  text?: string;
  [key: string]: any;
}

// ✅ 动态导入 channel-runtime 模块
const channelRuntimeModule = await import("openclaw/plugin-sdk/channel-runtime") as any;

const {
  createReplyPrefixOptions,
  createTypingCallbacks,
  logTypingFailure,
} = channelRuntimeModule;

import { createLoggerFromConfig } from "./utils/logger.ts";
import { CHANNEL_ID } from "./channel.ts";
import { resolveDingtalkAccount } from "./config/accounts.ts";
import { getDingtalkRuntime } from "./runtime.ts";
import type { DingtalkConfig } from "./types/index.ts";
import {
  createAICardForTarget,
  finishAICard,
  streamAICard,
  isQpsLimitError,
  registerActiveCard,
  unregisterActiveCard,
  ANSWER_CARD_TEMPLATE_ID,
  type AICardInstance,
  type AICardTarget,
} from "./services/messaging/card.ts";
import { sendMessage, sendTextMessage, sendMarkdownMessage } from "./services/messaging.ts";
import { getOapiAccessToken } from "./utils/token.ts";
import {
  processLocalImages,
  processVideoMarkers,
  processAudioMarkers,
  uploadAndReplaceFileMarkers,
} from "./services/media/index.ts";
import { getGlobalHookRunner } from "openclaw/plugin-sdk/plugin-runtime";
import { PROCESS_TAG, FINAL_TAG, extractFinal, finalClean, displayClean, estimateTokens } from "./services/reply-markers.ts";


export type CreateDingtalkReplyDispatcherParams = {
  cfg: ClawdbotConfig;
  agentId: string;
  runtime: RuntimeEnv;
  conversationId: string;
  senderId: string;
  isDirect: boolean;
  accountId?: string;
  messageCreateTimeMs?: number;
  sessionWebhook: string;
  asyncMode?: boolean;
  /** 队列繁忙时预先创建的 AI Card，startStreaming 时直接复用而非新建 */
  preCreatedCard?: AICardInstance;
};

export function createDingtalkReplyDispatcher(params: CreateDingtalkReplyDispatcherParams) {
  const core = getDingtalkRuntime();
  const {
    cfg,
    agentId,
    conversationId,
    senderId,
    isDirect,
    accountId,
    sessionWebhook,
    asyncMode = false,
    preCreatedCard,
  } = params;

  const account = resolveDingtalkAccount({ cfg, accountId });
  const { onModelSelected, ...prefixOptions } = createReplyPrefixOptions({
    cfg,
    agentId,
    channel: CHANNEL_ID,
    accountId,
  });

  // ✅ 读取 debug 配置
  const log = createLoggerFromConfig(account.config, `DingTalk:${accountId}`);

  // AI Card 状态管理
  let currentCardTarget: AICardTarget | null = null;
  let accumulatedText = "";
  const deliveredFinalTexts = new Set<string>();
  // 防止 startStreaming 在 closeStreaming 之后重新创建新卡片（会导致多余 AI Card）
  let sessionClosed = false;
  
  // 异步模式：累积完整响应
  let asyncModeFullResponse = "";

  // 工具输出累积（用于写入卡片的 cardToolVar）
  let accumulatedToolOutput = "";

  // ===== 回复标记 / 最终答案认定 =====
  // finalMarkedText：见到 [-final-] 后捕获其后内容（marker 模式的权威最终答案）。
  // lastAnswerText：最近一段非 reasoning 的正式答案（无标记兜底，靠 openclaw 的 isReasoning 标签）。
  let finalMarkedText: string | null = null;
  let lastAnswerText = "";
  // 仅用于日志去重：每轮回复对"检测到过程/最终标记"各只打一次。
  let processMarkerLogged = false;
  let finalMarkerLogged = false;

  // 观察每段到达的文本，更新标记认定状态。
  //   含 [-final-]（任意位置）→ 最终答案 = 剥光所有标记的完整正文，跳过 OpenClaw 兜底
  //   含 [-process-]（无 [-final-]）→ 过程段，激活标记系统抑制 OpenClaw 兜底
  //   无标记 → 走 OpenClaw 默认兜底
  let markerSystemActive = false;

    // 非正式答案 payload（工具失败/状态通知/压缩/兜底通知）→ 不参与最终答案认定。
    // 修复：工具调用失败的结果（带 isError/isStatusNotice）以前被当成 lastAnswerText，
    // 偶发地被当最终答案、提前停渲染。与 OpenClaw 官方判定一致：!isError && !isReasoning && !isStatusNotice。
  const isNonAnswerPayload = (p: any): boolean =>
    Boolean(p) && Boolean(p.isError || p.isStatusNotice || p.isCompactionNotice || p.isFallbackNotice);

  const observeReply = (raw: string | undefined, payload?: any) => {
    const text = raw ?? "";
    if (!text) return;
    if (isNonAnswerPayload(payload)) return; // 工具失败/状态通知不认定为答案
    const isReasoning = payload?.isReasoning;

    // [-final-] 出现 → 最终答案（剥光所有标记的完整正文），跳过 OpenClaw 兜底
    const fin = extractFinal(text);
    if (fin !== null) {
      if (!finalMarkerLogged) {
        finalMarkerLogged = true;
        log.info(`[DingTalk][marker] 检测到 ${FINAL_TAG}，最终答案=剥光标记的完整正文，跳过 OpenClaw 兜底`);
      }
      finalMarkedText = fin;
      markerSystemActive = true;
      return;
    }

    // 只有 [-process-]（无 [-final-]）→ 过程段，激活标记系统抑制兜底
    if (text.includes(PROCESS_TAG)) {
      if (!processMarkerLogged) {
        processMarkerLogged = true;
        log.info(`[DingTalk][marker] 检测到 ${PROCESS_TAG}（过程段），抑制 OpenClaw 默认兜底`);
      }
      markerSystemActive = true;
      return;
    }

    // 无标记：标记系统未激活时走 OpenClaw 兜底；已激活则沉默，让标记系统独占判定
    if (!markerSystemActive && !isReasoning && text.trim()) lastAnswerText = text;
  };

  // 选定本轮最终答案：
  //   标记系统激活 → finalMarkedText（最终段）优先，accumulatedText 流式兜底（跳过 OpenClaw）
  //   未激活（无标记）→ lastAnswerText（OpenClaw isReasoning 兜底），accumulatedText 兜底
  const pickFinalText = (): string =>
    markerSystemActive ? (finalMarkedText ?? accumulatedText) : (lastAnswerText || accumulatedText);

  // 对最终答案套用 prompt-rewriter 的固定模板（跑 reply_payload_sending 钩子）。失败不阻断投递。
  const applyReplyTemplate = async (text: string): Promise<string> => {
    try {
      const runner = getGlobalHookRunner?.();
      if (!runner?.hasHooks?.("reply_payload_sending")) return text;
      const res = await runner.runReplyPayloadSending(
        { payload: { text }, kind: "final", channel: CHANNEL_ID } as any,
        { channelId: CHANNEL_ID, accountId, conversationId, senderId } as any,
      );
      if (res?.cancel) return text;
      const out = res?.payload?.text;
      return typeof out === "string" && out ? out : text;
    } catch (e: any) {
      log.warn(`[DingTalk] 套用回复模板失败（忽略）：${e?.message || String(e)}`);
      return text;
    }
  };

  // ===== 养成系统: 通过 onCommandOutput 监听 dws 命令执行 =====
  // 记录当前回复周期内 onCommandOutput 回调检测到的 dws 产品名（如 "aitable"、"calendar"），
  // 在 closeStreaming 时用于触发降妖逻辑，每轮结束后清空。
  const detectedDwsProducts = new Set<string>();
  // 匹配 shell 命令中的 dws 子命令（如 `dws aitable list`），提取产品名用于养成系统掉落判定。
  const DWS_PRODUCT_PATTERN = /\bdws\s+(aitable|calendar|chat|contact|todo|approval|attendance|report|ding|workbench|devdoc)\b/;
  
  // ✅ 节流控制：避免频繁调用钉钉 API 导致 QPS 限流
  // 全局令牌桶限流器已在 streamAICard 内部实现（card.ts），此处的 updateInterval
  // 作为单实例级别的前置过滤，减少不必要的 streamAICard 调用
  let lastUpdateTime = 0;
  const updateInterval = 800; // 最小更新间隔 800ms（配合 card.ts 全局限流器，降低单实例发送频率）

  // ✅ 错误兜底：防止重复发送错误消息
  const deliveredErrorTypes = new Set<string>();
  let lastErrorTime = 0;
  const ERROR_COOLDOWN = 60000; // 错误消息冷却时间 1 分钟

  // ============ 错误兜底函数 ============

  /**
   * 发送兜底错误消息，确保用户始终能收到反馈
   */
  const sendFallbackErrorMessage = async (
    errorType: 'mediaProcess' | 'sendMessage' | 'unknown',
    originalError?: string,
    forceSend: boolean = false
  ) => {
    const now = Date.now();
    const errorKey = `${errorType}:${conversationId}:${senderId}`;
    
    // 防止重复发送相同类型的错误消息
    if (!forceSend && deliveredErrorTypes.has(errorKey)) {
      log.debug(`[DingTalk][Fallback] 跳过重复错误消息：${errorType}`);
      return;
    }
    
    // 冷却时间控制
    if (!forceSend && now - lastErrorTime < ERROR_COOLDOWN) {
      log.debug(`[DingTalk][Fallback] 冷却时间内，跳过错误消息`);
      return;
    }

    const errorMessages = {
      mediaProcess: '⚠️ 媒体文件处理失败，已发送文字回复',
      sendMessage: '⚠️ 消息发送失败，请稍后重试',
      unknown: '⚠️ 抱歉，处理您的请求时出错，请稍后重试',
    };
    
    const errorMessage = errorMessages[errorType];
    log.warn(`[DingTalk][Fallback] ${errorMessage}, error: ${originalError}`);
    
    try {
      await sendMessage(
        account.config as DingtalkConfig,
        sessionWebhook,
        errorMessage,
        {
          useMarkdown: false,
          log: params.runtime.log,
        }
      );
      deliveredErrorTypes.add(errorKey);
      lastErrorTime = now;
      log.info(`[DingTalk][Fallback] ✅ 错误消息发送成功`);
    } catch (fallbackErr: any) {
      log.error(`[DingTalk][Fallback] ❌ 错误消息发送失败：${fallbackErr.message}`);
    }
  };

  // 打字指示器回调（钉钉暂不支持，预留接口）
  const typingCallbacks = createTypingCallbacks({
    start: async () => {
      // 钉钉暂不支持打字指示器
    },
    stop: async () => {
      // 钉钉暂不支持打字指示器
    },
    onStartError: (err: any) =>
      logTypingFailure({
        log: (message: any) => params.runtime.log?.(message),
        channel: CHANNEL_ID,
        action: "start",
        error: err,
      }),
    onStopError: (err: any) =>
      logTypingFailure({
        log: (message: any) => params.runtime.log?.(message),
        channel: CHANNEL_ID,
        action: "stop",
        error: err,
      }),
  });

  const textChunkLimit = core.channel.text.resolveTextChunkLimit(
    cfg,
    CHANNEL_ID,
    accountId,
    { fallbackLimit: 4000 }
  );
  const chunkMode = core.channel.text.resolveChunkMode(cfg, CHANNEL_ID);

  // ✅ 群聊回复模式：当 groupReplyMode 为 text/markdown 时，群聊禁用 AI Card
  const groupReplyMode = (account.config as any)?.groupReplyMode || 'aicard';
  const isTextMode = !isDirect && (groupReplyMode === 'text' || groupReplyMode === 'markdown');
  if (isTextMode) {
    log.info(`[DingTalk] 群聊回复模式: ${groupReplyMode}，禁用 AI Card，使用 ${groupReplyMode} 发送`);
  }

  // 流式 AI Card 支持（text/markdown 模式强制禁用流式）
  const streamingEnabled = !isTextMode && (account.config as any)?.streaming !== false;
  // 用 Promise 保存 AI Card 的创建过程，避免 final 消息到达时轮询等待
  let cardCreationPromise: Promise<void> | null = null;

  const startStreaming = (): Promise<void> => {
    // 如果已经有创建中的 Promise，直接复用，避免并发创建
    if (cardCreationPromise) {
      return cardCreationPromise;
    }
    // 如果 AI Card 已存在，直接返回已完成的 Promise
    if (currentCardTarget) {
      return Promise.resolve();
    }

    cardCreationPromise = (async () => {
      // 异步模式下禁用流式 AI Card
      if (asyncMode) {
        log.info(`[DingTalk][startStreaming] 异步模式，跳过 AI Card 创建`);
        return;
      }
      if (!streamingEnabled) {
        log.info(`[DingTalk][startStreaming] 流式功能被禁用，跳过 AI Card 创建`);
        return;
      }
      // 本次对话会话已关闭（closeStreaming 已执行），禁止重新创建 AI Card。
      // 防止 humanDelay 延迟的 block 在 final 交付后触发 startStreaming 创建多余卡片。
      if (sessionClosed) {
        log.info(`[DingTalk][startStreaming] 会话已关闭，跳过 AI Card 创建`);
        return;
      }

      // 若队列繁忙时已预先创建了 Card（显示排队 ACK 文案），直接复用，无需新建
      // 这样用户看到的是同一条消息从 ACK 文案更新为最终结果，而不是多出一条消息
      if (preCreatedCard) {
        log.info(`[DingTalk][startStreaming] 复用预创建 AI Card，cardInstanceId=${preCreatedCard.cardInstanceId}`);
        currentCardTarget = preCreatedCard as any;
        accumulatedText = "";
        // preCreatedCard 路径也要注册，确保 outbound.sendText 拦截器能找到此卡片
        if (!isDirect) {
          registerActiveCard(conversationId, preCreatedCard);
        }
        return;
      }

      log.info(`[DingTalk][startStreaming] 开始创建 AI Card...`);

      try {
        const target: AICardTarget = isDirect
          ? { type: 'user', userId: senderId }
          : { type: 'group', openConversationId: conversationId };

        log.info(`[DingTalk][startStreaming] 目标：${JSON.stringify(target)}`);

        const card = await createAICardForTarget(
          account.config as DingtalkConfig,
          target,
          log
        );
        currentCardTarget = card as any;
        accumulatedText = "";

        if (card) {
          // 注册到全局注册表，让 outbound.sendText（AI 的 message 工具）
          // 能感知到当前会话有活跃 AI Card，并将消息路由到卡片更新而非独立气泡
          if (!isDirect) {
            registerActiveCard(conversationId, card);
          }
          log.info(`[DingTalk][startStreaming] ✅ AI Card 创建成功`);
        } else {
          log.warn(`[DingTalk][startStreaming] AI Card 创建返回 null，静默降级到普通消息模式`);
        }
      } catch (error: any) {
        log.error(`[DingTalk][startStreaming] ❌ AI Card 创建失败：${error?.message || String(error)}，静默降级到普通消息模式`);
        currentCardTarget = null;
      } finally {
        // 创建完成后清空 Promise，允许下次重新创建
        cardCreationPromise = null;
      }
    })();

    return cardCreationPromise;
  };

  const closeStreaming: () => Promise<void> = async () => {
    // 立即捕获并清空，防止并发调用重复执行（竞争条件保护）
    // closeStreaming 可能被 onIdle 和 onError 同时触发，若不在此处清空，
    // 第一次调用的 finally 块会将 currentCardTarget 置 null，
    // 导致第二次调用的 finishAICard 收到 null 参数而崩溃
    const cardSnapshot = currentCardTarget;
    if (!cardSnapshot) {
      log.info(`[DingTalk][closeStreaming] 无 AI Card，跳过关闭`);
      return;
    }
    currentCardTarget = null;
    sessionClosed = true;
    // 从全局注册表中移除，确保关闭后 outbound.sendText 不再向此 Card 路由
    if (!isDirect) {
      unregisterActiveCard(conversationId);
    }

    log.info(`[DingTalk][closeStreaming] 开始关闭 AI Card...`);

    try {
      // 选定最终答案：marker 优先 → 最近非 reasoning 答案 → accumulatedText 兜底，并剥离尾标记
      let finalText = finalClean(pickFinalText());
      // 是否有真实对话答案（在套兜底文案之前判断）。纯工具进度/无回复时为 false，
      // 用于 answerCard 模式下决定"不另建无文本输出答案卡"。
      const hadRealAnswer = finalText.trim().length > 0;
      log.info(
        `[DingTalk][closeStreaming] 最终答案来源=${finalMarkedText !== null ? "marker[-final-]" : (lastAnswerText ? "非reasoning答案" : "accumulatedText兜底")}，长度=${finalText.length}`
      );

      // ✅ 如果累积的文本为空，使用默认提示文案
      if (!finalText.trim()) {
        finalText = '✅ 任务执行完成（无文本输出）';
        log.info(`[DingTalk][closeStreaming] 累积文本为空，使用默认提示文案`);
      }
      
      // 获取 oapiToken 用于媒体处理
      const oapiToken = await getOapiAccessToken(account.config as DingtalkConfig);
      
      // ✅ 构建正确的 target（单聊用 senderId，群聊用 conversationId）
      const target: AICardTarget = isDirect
        ? { type: 'user', userId: senderId }
        : { type: 'group', openConversationId: conversationId };
      
      log.info(`[DingTalk][closeStreaming] 开始处理媒体文件，target=${JSON.stringify(target)}`);
      
      if (oapiToken) {
        // 处理本地图片
        finalText = await processLocalImages(finalText, oapiToken, log);
        
        // ✅ 先处理 Markdown 标记格式的媒体文件
        finalText = await processVideoMarkers(
          finalText,
          '',
          account.config as DingtalkConfig,
          oapiToken,
          log,
          true,  // ✅ 使用主动 API 模式
          target
        );
        finalText = await processAudioMarkers(
          finalText,
          '',
          account.config as DingtalkConfig,
          oapiToken,
          log,
          true,  // ✅ 使用主动 API 模式
          target
        );
        finalText = await uploadAndReplaceFileMarkers(
          finalText,
          '',
          account.config as DingtalkConfig,
          oapiToken,
          log,
          true,  // ✅ 使用主动 API 模式
          target
        );
        
        // ✅ 处理裸露的本地文件路径（绕过 OpenClaw SDK 的 bug）
        log.info(`[DingTalk][closeStreaming] 准备调用 processRawMediaPaths`);
        const { processRawMediaPaths } = await import('./services/media');
        finalText = await processRawMediaPaths(
          finalText,
          account.config as DingtalkConfig,
          oapiToken,
          log,
          target
        );
        log.info(`[DingTalk][closeStreaming] processRawMediaPaths 处理完成`);
      } else {
        log.warn(`[DingTalk][closeStreaming] oapiToken 为空，跳过媒体处理`);
      }

      // ===== 养成系统：基于 onCommandOutput 检测到的 dws 产品触发降妖 =====
      // 优先使用 onCommandOutput 监听到的产品（精准），兜底用正则匹配回复文本
      try {
        const productsToProcess = new Set<string>(detectedDwsProducts);

        // 兜底：如果 onCommandOutput 没捕获到，尝试从回复文本中正则匹配
        if (productsToProcess.size === 0) {
          const dwsProductMatch = finalText.match(/(?:^|\n)\s*(?:>?\s*)?(?:`\s*)?dws\s+(aitable|calendar|chat|contact|todo|approval|attendance|report|ding|workbench|devdoc)\b/m);
          if (dwsProductMatch && !finalText.includes('command not found: dws') && !finalText.includes('请先执行 dws login')) {
            productsToProcess.add(dwsProductMatch[1]);
            log.info(`[DingTalk][closeStreaming] 养成系统：正则兜底匹配到产品=${dwsProductMatch[1]}`);
          }
        } else {
          log.info(`[DingTalk][closeStreaming] 养成系统：onCommandOutput 监听到 ${productsToProcess.size} 个 dws 产品: ${[...productsToProcess].join(', ')}`);
        }

        if (productsToProcess.size > 0) {
          const { GamificationEngine } = await import('./game-xiyou/index.ts');
          const engine = GamificationEngine.getInstanceForUser(senderId);
          if (engine.isEnabled()) {
            // 一次任务只触发一次降妖，取第一个产品作为代表
            const primaryProduct = [...productsToProcess][0];
            const allProducts = [...productsToProcess].join('+');
            const gamificationBlock = engine.onDwsCommandResult(primaryProduct, true, `dws ${allProducts}`);
            if (gamificationBlock) {
              finalText += '\n' + gamificationBlock;
              log.info(`[DingTalk][closeStreaming] ✅ 养成系统渲染已追加，主产品=${primaryProduct}，涉及产品=${allProducts}`);
            }
          }
        }

        // 清空本轮检测记录
        detectedDwsProducts.clear();
      } catch (gamErr: any) {
        log.warn(`[DingTalk][closeStreaming] 养成系统处理失败（不影响主流程）: ${gamErr?.message || gamErr}`);
      }

      // 套用 prompt-rewriter 的固定回复模板（只对最终答案）
      finalText = await applyReplyTemplate(finalText);

      // ===== 答案专用卡模式（answerCard=true）=====
      // 规避钉钉流式卡 FINISHED 后仍抖动/继续渲染的官方 bug：
      //   1. 原流式卡 → 定格"✅ 思考完成"
      //   2. 另建一张「答案专用卡」（静态文本模板）→ 投放最终答案（content 字段）
      // 代价：多一条消息，但渲染正确、更快。
      // answerCard 默认开启：不写或非 false 都视为开（显式设 false 才关）。
      const useAnswerCard = (account.config as any)?.answerCard !== false;
      if (useAnswerCard) {
        // 原卡定格"思考完成"。必须用流式端点 streamAICard 覆盖可见内容——
        // FINISHED(/card/instances) 不会刷新已流式过的内容（钉钉 bug），先 streamAICard 盖文本再 FINISHED。
        const finalizeOriginalToDone = async () => {
          try {
            await streamAICard(cardSnapshot as any, "✅ 思考完成", true, account.config as DingtalkConfig, log);
            await finishAICard(cardSnapshot as any, "✅ 思考完成", account.config as DingtalkConfig, log);
          } catch (e: any) {
            log.warn(`[DingTalk][closeStreaming] 原卡定格思考完成失败（忽略）：${e?.message || e}`);
          }
        };

        // 答案卡模板（可配置 answerCardTemplateId，不填用硬编码默认）+ 触发阈值（answerActToken，默认600）
        const answerTplId = ((account.config as any)?.answerCardTemplateId as string)?.trim() || ANSWER_CARD_TEMPLATE_ID;
        const answerActToken = Number((account.config as any)?.answerActToken) || 600;
        const answerTokens = estimateTokens(finalText);

        if (!hadRealAnswer) {
          // 只有工具进度 / 没真实对话答案 → 只把原卡定格"思考完成"，不另建"无文本输出"答案卡。
          log.info(`[DingTalk][closeStreaming] answerCard 模式：无真实答案，仅定格原卡思考完成（不建答案卡）`);
          await finalizeOriginalToDone();
        } else if (answerTokens <= answerActToken) {
          // 小答案（≤阈值）→ 直接在原卡定稿，不另建答案卡（避免简单任务也多一张卡，体验更好）。
          // 用 streamAICard 覆盖可见内容（FINISHED-instances 不刷新已流式内容），再 FINISHED。
          log.info(`[DingTalk][closeStreaming] answerCard 模式：答案约 ${answerTokens} token ≤ ${answerActToken}，原卡直接定稿（不建答案卡）`);
          try {
            await streamAICard(cardSnapshot as any, finalText, true, account.config as DingtalkConfig, log);
          } catch (e: any) {
            if (!isQpsLimitError(e)) log.warn(`[DingTalk][closeStreaming] 原卡流式覆盖最终答案失败（忽略，继续 FINISHED）：${e?.message || e}`);
          }
          await finishAICard(cardSnapshot as any, finalText, account.config as DingtalkConfig, log);
        } else {
          // 大答案（>阈值）→ 原卡定格"思考完成" + 新建答案卡投放最终答案。
          log.info(`[DingTalk][closeStreaming] answerCard 模式：答案约 ${answerTokens} token > ${answerActToken}，原卡思考完成 + 新建答案卡（模板=${answerTplId}）`);
          await finalizeOriginalToDone();
          const answerCard = await createAICardForTarget(
            account.config as DingtalkConfig,
            target,
            log,
            answerTplId,
          );
          if (answerCard) {
            await finishAICard(answerCard, finalText, account.config as DingtalkConfig, log);
            log.info(`[DingTalk][closeStreaming] ✅ 答案卡投放成功`);
          } else {
            // 答案卡建失败 → 降级直接定稿原卡，保证用户能看到回复
            log.warn(`[DingTalk][closeStreaming] 答案卡创建失败，降级定稿原卡`);
            await finishAICard(cardSnapshot as any, finalText, account.config as DingtalkConfig, log);
          }
        }
      } else {
        log.info(`[DingTalk][closeStreaming] 准备调用 finishAICard，文本长度=${finalText.length}`);
        await finishAICard(
          cardSnapshot as any,
          finalText,
          account.config as DingtalkConfig,
          log
        );
      }
      log.info(`[DingTalk][closeStreaming] ✅ AI Card 关闭成功`);
    } catch (error: any) {
      log.error(`[DingTalk][closeStreaming] ❌ AI Card 关闭失败：${error?.message || String(error)}`);
      // ✅ 媒体处理或关闭失败时，降级发送普通消息
      await sendFallbackErrorMessage('mediaProcess', error?.message || String(error));
      
      // 尝试用普通消息发送累积的文本（剥离尾标记防泄漏）
      const fallbackText = finalClean(finalMarkedText ?? accumulatedText);
      if (fallbackText.trim()) {
        try {
          log.info(`[DingTalk][closeStreaming] 降级发送普通消息`);
          await sendMessage(
            account.config as DingtalkConfig,
            sessionWebhook,
            fallbackText,
            {
              useMarkdown: true,
              log: params.runtime.log,
            }
          );
          log.info(`[DingTalk][closeStreaming] ✅ 降级发送成功`);
        } catch (sendErr: any) {
          log.error(`[DingTalk][closeStreaming] ❌ 降级发送失败：${sendErr.message}`);
        }
      }
    } finally {
      // currentCardTarget 已在函数开头清空，此处只需重置累积文本
      accumulatedText = "";
    }
  };

  const { dispatcher, replyOptions, markDispatchIdle } =
    core.channel.reply.createReplyDispatcherWithTyping({
      ...prefixOptions,
      humanDelay: core.channel.reply.resolveHumanDelayConfig(cfg, agentId),
      onReplyStart: () => {
        log.info(`[DingTalk][onReplyStart] 开始回复，流式 enabled=${streamingEnabled}`);
        // 每次 onReplyStart 都是全新的回复周期，清空去重集合 + 标记认定状态
        deliveredFinalTexts.clear();
        finalMarkedText = null;
        lastAnswerText = "";
        processMarkerLogged = false;
        finalMarkerLogged = false;
        markerSystemActive = false;
        // 延迟建卡：不在 onReplyStart 抢先建卡，改由第一段真正的对话内容（onPartialReply /
        // deliver block/final）按需创建。否则纯 message 工具轮次（无对话回复，deliver 计数全 0）
        // 会留下一张没人喂的孤儿卡，收尾兜底成"无文本输出"。
        typingCallbacks.onActive?.();
      },
      deliver: async (payload, info) => {
        let text = payload.text ?? "";

        log.debug(`[DingTalk][deliver] kind=${info?.kind}, textLength=${text.length}`);

        // 观察标记：更新最终答案认定（marker / 非 reasoning 兜底）
        observeReply(payload.text, payload);

        // 工具失败/状态通知 payload：流式时可短暂展示，但绝不计入最终答案（不设 accumulatedText / 不当 final）。
        // 修复：dws 等工具调用失败的结果偶发被当成最终答案、提前停渲染。
        if (isNonAnswerPayload(payload)) {
          if (streamingEnabled && currentCardTarget && !asyncMode && finalMarkedText === null) {
            const now = Date.now();
            if (now - lastUpdateTime >= updateInterval) {
              lastUpdateTime = now;
              try {
                await streamAICard(currentCardTarget as any, displayClean(text), false, account.config as DingtalkConfig, log, (account.config as DingtalkConfig)?.cardContentVar as string || "msgContent");
              } catch (e: any) {
                if (!isQpsLimitError(e)) log.warn(`[DingTalk][deliver] 状态/错误 payload 写卡失败：${e?.message || e}`);
              }
            }
          }
          log.info(`[DingTalk][deliver] 非答案 payload（isError=${(payload as any).isError},isStatusNotice=${(payload as any).isStatusNotice}），仅展示不计入最终答案`);
          return;
        }

        // ✅ 在 final 响应时，先处理裸露的文件路径
        if (info?.kind === "final" && text.trim()) {
          const target: AICardTarget = isDirect
            ? { type: 'user', userId: senderId }
            : { type: 'group', openConversationId: conversationId };
          
          try {
            const oapiToken = await getOapiAccessToken(account.config as DingtalkConfig);
            if (oapiToken) {
              log.info(`[DingTalk][deliver] 检测到 final 响应，准备处理裸露文件路径`);
              const { processRawMediaPaths } = await import('./services/media');
              text = await processRawMediaPaths(
                text,
                account.config as DingtalkConfig,
                oapiToken,
                log,
                target
              );
              log.info(`[DingTalk][deliver] 裸露文件路径处理完成`);
            }
          } catch (err: any) {
            log.error(`[DingTalk][deliver] 处理裸露文件路径失败：${err.message}`);
          }
        }
        
        const hasText = Boolean(text.trim());
        const skipTextForDuplicateFinal =
          info?.kind === "final" && hasText && deliveredFinalTexts.has(text);
        
        // ✅ 如果是 final 响应且没有文本，使用默认提示文案
        if (info?.kind === "final" && !hasText) {
          text = '✅ 任务执行完成（无文本输出）';
          log.info(`[DingTalk][deliver] final 响应无文本，使用默认提示文案`);
        }
        
        const shouldDeliverText = Boolean(text.trim()) && !skipTextForDuplicateFinal;

        if (!shouldDeliverText) {
          log.info(`[DingTalk][deliver] 跳过发送：hasText=${hasText}, skipTextForDuplicateFinal=${skipTextForDuplicateFinal}`);
          return;
        }

        // 异步模式：只累积响应，不发送（剥离标记防泄漏；固定模板由消费方按需套）
        if (asyncMode) {
          log.info(`[DingTalk][deliver] 异步模式，累积响应`);
          asyncModeFullResponse = finalClean(finalMarkedText ?? text);
          return;
        }

        // block 消息：Agent 的中间 status update
        // 追加到同一张流式 AI Card 里（delta 模式），不单独创建新卡片
        // 如果流式 AI Card 未启用，直接丢弃 block（不发送）
        if (info?.kind === "block") {
          if (!streamingEnabled) {
            log.info(`[DingTalk][deliver] block 消息，流式未启用，丢弃`);
            return;
          }
          log.info(`[DingTalk][deliver] block 消息，追加到流式 AI Card，文本长度=${text.length}`);
          // 确保 AI Card 已创建（startStreaming 内部会复用已有的 cardCreationPromise）
          await startStreaming();
          // AI Card 已就绪，用 streamAICard 更新内容（仅展示当前 block 文本，不累积到 accumulatedText）
          // accumulatedText 专门给 onPartialReply 的流式更新使用，block 不能污染它
          if (currentCardTarget) {
            // 若 onPartialReply 已开始流式传输最终文本（accumulatedText 非空），
            // 则跳过 block 更新，避免因 humanDelay 延迟交付的旧状态消息覆盖正在流式中的最终回复内容。
            // （humanDelay 会在 block 之间插入 800-2500ms 延迟，导致 block 在 final 流式开始后才到达）
            if (accumulatedText) {
              log.info(`[DingTalk][deliver] block 消息：最终回复已在流式中（${accumulatedText.length}字），跳过以防覆盖流式内容`);
              return;
            }
            const now = Date.now();
            if (now - lastUpdateTime >= updateInterval) {
              // ✅ 乐观更新：防止并发回调在 await 期间通过节流检查
              lastUpdateTime = now;
              try {
                await streamAICard(
                  currentCardTarget as any,
                  displayClean(text),
                  false,
                  account.config as DingtalkConfig,
                  log
                );
                log.info(`[DingTalk][deliver] ✅ block 更新到 AI Card 成功`);
              } catch (streamErr: any) {
                log.error(`[DingTalk][deliver] ❌ block 更新 AI Card 失败：${streamErr.message}`);
              }
            }
          } else {
            log.warn(`[DingTalk][deliver] block 消息：AI Card 创建失败，丢弃该 block`);
          }
          return;
        }

        // 流式模式的 final 处理
        if (info?.kind === "final" && streamingEnabled) {
          log.info(`[DingTalk][deliver] final 响应，流式模式`);
          // await startStreaming() 确保 AI Card 创建完成后再处理 final
          await startStreaming();

          if (currentCardTarget) {
            // 多轮 Agent 模式：每轮 final 仅更新 accumulatedText，不调用 streamAICard
            // 卡片内容由 onPartialReply 实时流式更新；此处调用 streamAICard 会用旧轮次文本
            // 覆盖 onPartialReply 已写入的新内容，导致卡片在完成后快速倒放中间状态。
            // onIdle → closeStreaming() → finishAICard() 是唯一的卡片最终确认路径。
            accumulatedText = text;
            log.info(`[DingTalk][deliver] 多轮 Agent 模式：仅更新 accumulatedText（len=${text.length}），不触发卡片更新`);
            deliveredFinalTexts.add(text);
            return;
          } else {
            log.warn(`[DingTalk][deliver] ⚠️ AI Card 创建失败，降级到非流式发送`);
          }
        }

        // 流式模式但没有 card target：降级到非流式发送
        // 或者非流式模式：使用普通消息发送
        if (info?.kind === "final") {
          // 非流式最终发送：选定最终答案（marker 优先）+ 剥离尾标记 + 套固定模板
          text = await applyReplyTemplate(finalClean(finalMarkedText ?? text));
          log.info(`[DingTalk][deliver] 降级到非流式发送，文本长度=${text.length}, isTextMode=${isTextMode}, groupReplyMode=${groupReplyMode}`);
          try {
            for (const chunk of core.channel.text.chunkTextWithMode(
              text,
              textChunkLimit,
              chunkMode
            )) {
              if (isTextMode) {
                if (groupReplyMode === 'markdown') {
                  await sendMarkdownMessage(
                    account.config as DingtalkConfig,
                    sessionWebhook,
                    chunk.split('\n')[0]?.replace(/^[#*\s\->]+/, '').slice(0, 20) || 'Message',
                    chunk,
                    { cfg, detectBareAliases: true },
                  );
                } else {
                  await sendTextMessage(
                    account.config as DingtalkConfig,
                    sessionWebhook,
                    chunk,
                    { cfg, detectBareAliases: true },
                  );
                }
              } else {
                await sendMessage(
                  account.config as DingtalkConfig,
                  sessionWebhook,
                  chunk,
                  {
                    useMarkdown: true,
                    log: params.runtime.log,
                    cfg,
                    detectBareAliases: true,
                  }
                );
              }
            }
            log.info(`[DingTalk][deliver] ✅ 非流式发送成功`);
            deliveredFinalTexts.add(text);
          } catch (error: any) {
            log.error(`[DingTalk][deliver] ❌ 非流式发送失败：${error.message}`);
            params.runtime.error?.(
              `dingtalk[${account.accountId}]: non-streaming delivery failed: ${String(error)}`
            );
            // ✅ 发送兜底错误消息
            await sendFallbackErrorMessage('sendMessage', error.message);
          }
          return;
        }
      },
      onError: async (error, info) => {
        log.error(`[DingTalk][onError] ${info.kind} reply failed: ${String(error)}`);
        params.runtime.error?.(
          `dingtalk[${account.accountId}] ${info.kind} reply failed: ${String(error)}`
        );
        await closeStreaming();
        typingCallbacks.onIdle?.();
      },
      onIdle: async () => {
        log.info(`[DingTalk][onIdle] 回复空闲，关闭 AI Card`);
        typingCallbacks.onIdle?.();
        await closeStreaming();
      },
      onCleanup: () => {
        log.info(`[DingTalk][onCleanup] 清理回调`);
        typingCallbacks.onCleanup?.();
      },
    });

  // 构建完整的 replyOptions：replyOptions 只包含 onReplyStart、onTypingController、onTypingCleanup
  // deliver、onError、onIdle、onCleanup 等回调已经在 createReplyDispatcherWithTyping 的参数中定义
  return {
    dispatcher,
    replyOptions: {
      ...replyOptions,  // ✅ 包含 onReplyStart、onTypingController、onTypingCleanup
      onModelSelected,
      // 让 onToolStart 在"工具摘要隐藏"时仍回调（否则被 requiresToolSummaryVisibility 闸住，dispatch:1655）。
      // 同时抑制 OpenClaw 默认的工具进度消息——工具进度由本连接器自己渲染到卡片。
      allowToolLifecycleWhenProgressHidden: true,
      suppressDefaultToolProgressMessages: true,
      ...(streamingEnabled && {
        onPartialReply: async (payload: ReplyPayload) => {
        // 注意：本回调每个 token 都触发，严禁逐次打日志（会刷屏）。只在真正发生卡片更新/出错时记。
        if (!payload.text) return;

        // 观察标记：更新最终答案认定（marker / 非 reasoning 兜底）
        observeReply(payload.text, payload);

        // 非答案 payload（工具失败/状态通知）→ 不累积、不当最终答案，直接跳过
        if (isNonAnswerPayload(payload)) return;

        // 异步模式下禁用流式更新（剥离标记防泄漏）
        if (asyncMode) {
          asyncModeFullResponse = finalClean(finalMarkedText ?? payload.text);
          return;
        }

        // 检测到 [-final-] → 最终答案不再逐字流式，停止刷卡，
        // 改由 onIdle → closeStreaming → finishAICard 一次性定稿（无打字、无假流式回放）。
        // 其余（过程段 [-process-]、以及无标记走 OpenClaw 默认）照常逐字流式刷卡。
        if (finalMarkedText !== null) {
          accumulatedText = payload.text;
          return;
        }

        // await startStreaming() 确保 AI Card 创建完成后再更新
        // startStreaming 内部会复用已有的 cardCreationPromise，不会重复创建
        await startStreaming();

        if (currentCardTarget) {
          accumulatedText = payload.text;

          const now = Date.now();
          if (now - lastUpdateTime >= updateInterval) {
            const { FILE_MARKER_PATTERN, VIDEO_MARKER_PATTERN, AUDIO_MARKER_PATTERN } = await import('./services/media/common.ts');
            // 此处只会是过程段（finalMarkedText 非空已在上面 return）：展示当前累积文本，剥尾部完整/半截标记。
            const displayContent = displayClean(accumulatedText)
              .replace(FILE_MARKER_PATTERN, '')
              .replace(VIDEO_MARKER_PATTERN, '')
              .replace(AUDIO_MARKER_PATTERN, '')
              .trim();
            
            // ✅ 乐观更新：在发起 HTTP 请求前立即更新 lastUpdateTime，
            // 防止并发的 onPartialReply 回调在 await 期间通过节流检查，
            // 导致多个请求同时打到同一张卡片触发服务端 403 并发保护
            lastUpdateTime = now;
            try {
              await streamAICard(
                currentCardTarget as any,
                displayContent,
                false,
                account.config as DingtalkConfig,
                log,
                (account.config as DingtalkConfig)?.cardContentVar as string || "msgContent"
              );
            } catch (err: any) {
              // QPS 限流是瞬时错误：streamAICard 内部已自动退避+重试，
              // 退避期过后下一次 partial 更新会把 AI Card 内容覆盖补齐，
              // 因此不应把 QPS 限流展示为用户可见的「消息发送失败」提示，
              // 否则用户会同时看到正常的 AI Card 回复和一条误报错误。
              // 真正无法恢复的错误（finalize 仍失败）会在 closeStreaming
              // 的降级路径里通过 sendFallbackErrorMessage 兜底。
              if (isQpsLimitError(err)) {
                log.warn(
                  `[DingTalk][onPartialReply] AI Card 流式更新遇到 QPS 限流，已在内部退避重试；本次跳过，等待下一次 partial 更新补齐内容`,
                );
              } else {
                log.error(`[DingTalk][onPartialReply] ❌ AI Card 更新失败：${err.message}`);
                await sendFallbackErrorMessage('sendMessage', err.message);
              }
            }
          }
          // 节流跳过：不打日志（高频，会刷屏）
        }
      },
      }),
      // ===== 工具调用进度：开始调用工具时，往原卡流式显示"正在调用工具：工具名" =====
      // OpenClaw 的 onToolStart 带干净的工具名（payload.name）。已进入最终答案 / 异步 / 非流式则跳过。
      onToolStart: async (payload: { name?: string; phase?: string; args?: Record<string, unknown> }) => {
        const toolName = (payload?.name || "").trim();
        if (!toolName) return;
        if (payload?.phase === "end" || payload?.phase === "complete") return;
        if (!streamingEnabled || asyncMode || finalMarkedText !== null) return;
        try {
          await startStreaming();
          if (!currentCardTarget) return;
          const now = Date.now();
          if (now - lastUpdateTime < updateInterval) return;
          lastUpdateTime = now;
          await streamAICard(
            currentCardTarget as any,
            `🔧 正在调用工具：${toolName}`,
            false,
            account.config as DingtalkConfig,
            log,
            (account.config as DingtalkConfig)?.cardContentVar as string || "msgContent",
          );
          log.debug(`[DingTalk][onToolStart] 工具进度写卡：${toolName}（phase=${payload?.phase}）`);
        } catch (e: any) {
          if (!isQpsLimitError(e)) log.warn(`[DingTalk][onToolStart] 工具进度写卡失败：${e?.message || e}`);
        }
      },
      // ===== 养成系统：监听 dws 命令执行 =====
      onCommandOutput: (payload: {
        itemId?: string;
        phase?: string;
        title?: string;
        toolCallId?: string;
        name?: string;
        output?: string;
        status?: string;
        exitCode?: number | null;
        durationMs?: number;
        cwd?: string;
      }) => {
        const commandText = payload.title || payload.name || '';
        const dwsMatch = commandText.match(DWS_PRODUCT_PATTERN) || payload.output?.match(DWS_PRODUCT_PATTERN);
        if (dwsMatch) {
          const product = dwsMatch[1];
          // 只记录成功执行的命令（exitCode 为 0 或 phase 不是 end 时还不知道结果）
          const isFailure = payload.phase === 'end' && payload.exitCode !== null && payload.exitCode !== 0;
          if (!isFailure) {
            detectedDwsProducts.add(product);
            log.info(`[DingTalk][onCommandOutput] 检测到 dws 产品: ${product}，phase=${payload.phase}, exitCode=${payload.exitCode}`);
          } else {
            log.info(`[DingTalk][onCommandOutput] dws 命令执行失败，跳过: ${product}，exitCode=${payload.exitCode}`);
          }
        }

        // 工具输出写入 AI Card 卡片变量（cardToolVar）
        const toolVar = (account.config as DingtalkConfig)?.cardToolVar as string;
        if (toolVar && payload.output && currentCardTarget) {
          accumulatedToolOutput = payload.output;
          const now = Date.now();
          if (now - lastUpdateTime >= updateInterval) {
            lastUpdateTime = now;
            void streamAICard(
              currentCardTarget as any,
              payload.output,
              false,
              account.config as DingtalkConfig,
              log,
              toolVar
            ).then(() => {
              log.debug(`[DingTalk][onCommandOutput] ✅ 工具输出写入 AI Card（${toolVar}）`);
            }).catch((err: any) => {
              log.error(`[DingTalk][onCommandOutput] ❌ 工具输出写入失败：${err.message}`);
            });
          }
        }
      },
    },
    markDispatchIdle,
    getAsyncModeResponse: () => asyncModeFullResponse,
  };
}
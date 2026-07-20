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

/**
 * OpenClaw rawError → 钉钉中文提示。
 *
 * 对齐 OpenClaw FailoverReason + formatAssistantErrorText / sanitize-user-facing-text
 * 的固定用户文案与 failover-matches 分类语义，而不是随意拍关键词。
 *
 * 数据流：
 * - OpenClaw 内部有 FailoverReason（auth/rate_limit/overloaded/billing/...）
 * - 到达 channel 的 payload.rawError 常为「规范化英文」或「上游透传原文」
 * - deliver 仅在 rawError 非空时匹配；onError 用 String(error)
 *
 * 规则顺序：更具体的 OpenClaw 字面量 / 上游固定句式 → FailoverReason 语义 → 兜底
 */
const MODEL_ERROR_GENERIC =
  "⚠️ 模型请求异常，请检查其他人是否也弹出此提示，如果都弹此提示，那么就是模型欠费了，等待恢复即可。如果别人没报错只有你报错，那么很可能是在对话中存在工具调用失败的历史污染了会话记录，可以尝试更换模型，或发送 /clear 清空本会话内容，开启新会话尝试";

const MODEL_ERROR_RULES: [RegExp, string][] = [
  // ═══════════════════════════════════════════════════════════
  // A. OpenClaw 固定用户文案（formatAssistantErrorText / sanitize 产出）
  // ═══════════════════════════════════════════════════════════

  // billing — BILLING_ERROR_USER_MESSAGE
  [
    /returned a billing error|run out of credits|insufficient balance|plans\s*&\s*billing/i,
    "⚠️ 模型余额不足或订阅/用量受限，请充值、检查订阅后重试",
  ],

  // rate_limit — RATE_LIMIT_ERROR_USER_MESSAGE
  [
    /API rate limit reached\.?\s*Please try again later/i,
    "⚠️ 模型 token 用量上限或限流，请充钱加模型或等待模型用量重置",
  ],

  // overloaded / capacity — MODEL_CAPACITY / OVERLOADED_ERROR_USER_MESSAGE
  [
    /Selected model is at capacity/i,
    "⚠️ 当前模型已满载，请切换其他模型或稍后重试",
  ],
  [
    /AI service is temporarily overloaded/i,
    "⚠️ 模型服务暂时过载，请切换其他模型或稍后重试",
  ],

  // context_overflow
  [
    /Context overflow:\s*prompt too large/i,
    "⚠️ 上下文过长，超出模型处理限制，请发送 /clear 或 /new 清空会话后重试",
  ],

  // model_not_found — MODEL_NOT_FOUND_USER_TEXT
  [
    /selected model was not found by the provider/i,
    "⚠️ 指定的模型不存在，请检查模型 ID 是否正确",
  ],

  // format / schema — PROVIDER_SCHEMA_REJECTION_USER_TEXT
  [
    /provider rejected the request schema or tool payload/i,
    "⚠️ 模型请求被拒绝（schema/工具参数异常），可能是工具参数格式不正确或会话被工具历史污染，可尝试更换模型或发送 /clear 清空对话后重试",
  ],
  [
    /LLM request rejected:/i,
    "⚠️ 请求被拒绝，请更换模型或发送 /clear 后重试",
  ],

  // auth — AUTH_INVALID_TOKEN_USER_TEXT 等
  [
    /Authentication failed \(provider returned HTTP 401\)|Authentication failed at the provider|Authentication refresh failed|re-authenticate this provider/i,
    "⚠️ 认证失败，请检查模型密钥是否正确或已过期",
  ],

  // transport / proxy / html
  [
    /proxy or tunnel configuration blocked/i,
    "⚠️ 网络请求被代理拦截，请检查网络配置",
  ],
  [
    /provider returned an HTML error page|CDN or gateway \(e\.g\. Cloudflare\)/i,
    "⚠️ 模型服务返回异常页面（可能被 CDN/网关拦截），请稍后重试",
  ],
  [
    /LLM request timed out\.|LLM request failed: (?:connection refused|network connection|DNS lookup|provider endpoint is unreachable|network connection error|provider reported a network error)/i,
    "⚠️ 模型响应超时或网络异常，请稍后重试",
  ],
  [
    /invalid streaming response|malformed fragment/i,
    "⚠️ 模型流式响应异常，请稍后重试",
  ],
  [
    /Message ordering conflict|Session history looks corrupted|Session history or replay state is invalid|Reasoning is required for this model/i,
    "⚠️ 会话状态异常，请发送 /new 或 /clear 开启新会话后重试",
  ],

  // OpenClaw 通用兜底原文
  [
    /^LLM request failed\.?$/i,
    MODEL_ERROR_GENERIC,
  ],
  [
    /Something went wrong while processing your request|The agent run failed before producing a reply|\[assistant turn failed before producing content\]/i,
    MODEL_ERROR_GENERIC,
  ],

  // ═══════════════════════════════════════════════════════════
  // B. 上游固定句式（非 OpenClaw 枚举，但常见透传）
  // ═══════════════════════════════════════════════════════════

  // 分发网关：无可用线路（≠ 模型服务器满载）
  // e.g. "503 No available channel for model auto-1Mt under group … (distributor)"
  [
    /no available channel for model|no available channel\b.*\b(?:distributor|group)\b|\bdistributor\b.*\bno available channel\b/i,
    "⚠️ 当前模型暂无可用通道/线路，请切换其他模型或检查上游分组配置后重试",
  ],

  // ═══════════════════════════════════════════════════════════
  // C. FailoverReason 语义（对齐 failover-matches.ts，补 raw 上游原文）
  // ═══════════════════════════════════════════════════════════

  // billing（在 rate_limit 前：OpenClaw 亦优先 billing）
  [
    /\bbilling error\b|\bpayment required\b|\bHTTP\s*402\b|\binsufficient[_\s]?(?:credits?|quota|balance)\b|\brun out of credits\b|\bcredit balance\b|\bspend(?:ing)?\s*limit\b|余额不足|账户已欠费|\b欠费\b/i,
    "⚠️ 模型余额不足，请充值后重试",
  ],

  // rate_limit（含 API rate limit / usage limit / 429；不含裸 "reached" 以免过宽）
  [
    /\brate[_\s-]?limit(?:ed|ing)?\b|\btoo many (?:concurrent )?requests\b|\bHTTP\s*429\b|\bRESOURCE_EXHAUSTED\b|\bresource has been exhausted\b|\bquota exceeded\b|\busage limit\b|\btoken(?:s)? limit\b|\btokens?\s+per\s+(?:minute|day|hour)\b|\bTPM\b|\bthrottl(?:ed|ing)\b|\bmodel_cooldown\b|请求过于频繁|调用频率|频率限制|配额不足|配额已用尽|额度不足|额度已用尽/i,
    "⚠️ 模型 token 用量上限或限流，请充钱加模型或等待模型用量重置",
  ],
  // reached/hit + (usage|token|rate|quota) limit — 保留「用量已达」语义，但不匹配无 limit 的 reached
  [
    /(?:reached|hit|breached).{0,48}(?:usage|token|tokens|rate|quota|credit).{0,16}limit|(?:usage|token|tokens|rate|quota|credit).{0,16}limit.{0,16}(?:reached|hit|exceeded|exhausted)/i,
    "⚠️ 模型 token 用量上限或限流，请充钱加模型或等待模型用量重置",
  ],

  // context_overflow
  [
    /\bcontext overflow\b|\bprompt too large\b|\bcontext length exceeded\b|\bmaximum context length\b|\btoo many tokens per request\b|\brequest_too_large\b|上下文过长/i,
    "⚠️ 上下文过长，超出模型处理限制，请发送 /clear 清空对话后重试",
  ],

  // model_not_found
  [
    /\bmodel_not_found\b|\bselected model was not found\b|\binvalid model\b|\bmodel\b.{0,24}\bnot found\b/i,
    "⚠️ 指定的模型不存在，请检查模型 ID 是否正确",
  ],

  // overloaded（严格对齐 OpenClaw：不含 no available channel）
  [
    /\boverloaded(?:_error)?\b|\b(?:selected\s+)?model\s+(?:is\s+)?at capacity\b|\bhigh (?:demand|load)\b|服务过载|当前负载过高|访问量过大/i,
    "⚠️ 当前模型负载过高，请切换其他模型或稍后重试",
  ],

  // format / tool
  [
    /\brejected the request schema\b|\binvalid request format\b|\bunknown tool\b|\btool[_ ]?use[_ ]?id\b|\btool_use\.id\b|\btool\b.{0,40}(?:not found|is not available)|\bdoes not support assistant message prefill\b|\bconversation must end with a user message\b/i,
    "⚠️ 模型请求被拒绝，可能是工具参数格式不正确或会话被工具历史污染，可尝试更换模型或发送 /clear 清空对话后重试",
  ],

  // auth（在 rate_limit 之后；api_key 需 word boundary）
  [
    /\binvalid[_ ]?api[_ ]?key\b|\bincorrect api key\b|\bapi[_ ]?key[_ ]?(?:revoked|deactivated|deleted)\b|\bauthentication failed\b|\bunauthorized\b|\bHTTP\s*401\b|\bpermission_error\b|\baccess denied\b|\bforbidden\b|\bHTTP\s*403\b|\boauth token refresh failed\b|\btoken has expired\b|\bno (?:credentials|api key) found\b|无权访问|认证失败|鉴权失败|密钥无效/i,
    "⚠️ 认证失败，请检查模型密钥是否正确或已过期",
  ],

  // timeout / transport / server_error（OpenClaw 对裸 503 多归 transient/server，非 overload）
  [
    /\btimed?\s*out\b|\btimeout\b|\bdeadline exceeded\b|\bsocket hang up\b|\bfetch failed\b|\bECONN(?:REFUSED|RESET|ABORTED)\b|\bETIMEDOUT\b|\bENOTFOUND\b|\bnetwork (?:error|request failed)\b|\bbad gateway\b|\bgateway timeout\b|\binternal[_ ]server[_ ]error\b|\bHTTP\s*50[0-4]\b|\bservice[_ ](?:temporarily[_ ])?unavailable\b|网络错误|请求超时|连接超时/i,
    "⚠️ 模型响应超时或服务暂时不可用，请稍后重试",
  ],

  // content filter（上游常见，OpenClaw 未单独 FailoverReason，单独收口）
  [
    /\bcontent[_ ]?filter\b|\bcontent[_ ]?policy\b|\bsafety[_ ]?(?:system|filter)\b|\bresponsibleai\b/i,
    "⚠️ 内容被安全策略拦截，请修改提问后重试",
  ],
];

/** 仅错误流使用的万能兜底 */
const MODEL_ERROR_CATCH_ALL: [RegExp, string] = [/.{20,}/, MODEL_ERROR_GENERIC];

/**
 * @param source 上游原始错误文案（deliver 用 payload.rawError；onError 用 String(error)）
 * @param opts.includeCatchAll 为 true 时启用万能兜底
 * @returns 命中则返回中文提示，未命中返回 null
 */
function matchModelErrorText(
  source: string,
  opts?: { includeCatchAll?: boolean },
): string | null {
  if (!source) return null;
  for (const [pattern, msg] of MODEL_ERROR_RULES) {
    if (pattern.test(source)) {
      return msg;
    }
  }
  if (opts?.includeCatchAll && MODEL_ERROR_CATCH_ALL[0].test(source)) {
    return MODEL_ERROR_CATCH_ALL[1];
  }
  return null;
}

/** 读取 OpenClaw 透传的原始错误；空串视为无错误 */
function readPayloadRawError(payload: unknown): string {
  const raw = (payload as { rawError?: unknown } | null | undefined)?.rawError;
  return typeof raw === "string" ? raw.trim() : "";
}

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

  // 当前工具调用行（嵌入流式文本下方的单行旋转文本）
  let currentToolLine = "";
  /**
   * 是否已出现过「模型真正的流式正文」。
   * 若尚未出现就先 onToolStart，卡片会先用固定占位正文「大模型已收到需求」+ 工具行，
   * 结构与后续「文字 + 正在调用工具」一致，避免只有空荡荡的工具行。
   * 占位仅用于展示，不写入 accumulatedText，不影响终稿。
   */
  let hasModelStreamText = false;
  /** 纯工具打头时的固定首段正文（展示用） */
  const MODEL_RECEIPT_PLACEHOLDER = "🤖 大模型已收到需求";

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
  //   未激活（无标记）→ 在 lastAnswerText 与 accumulatedText 中取更长者
  //   （避免 lastAnswerText 停在中间 block，而 accumulatedText 已是全文时终态被截断）
  const pickFinalText = (): string => {
    if (markerSystemActive) {
      return finalMarkedText ?? accumulatedText;
    }
    const a = lastAnswerText || "";
    const b = accumulatedText || "";
    if (a.length === 0) return b;
    if (b.length === 0) return a;
    // 若一方是另一方前缀，取更长；否则优先 accumulatedText（流式累积最新）
    if (b.startsWith(a) || a.startsWith(b)) {
      return b.length >= a.length ? b : a;
    }
    return b.length >= a.length ? b : a;
  };

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
  
  // ✅ 流式写卡：串行队列 + 尾随合并，避免
  //   1) 节流直接丢更新导致卡面落后网关
  //   2) 并发 HTTP 乱序（用「序号 + 执行时读 latest」而非「禁止变短」）
  //   3) 定稿时卡面仍停在中间态
  //
  // 注意：绝不能用「内容长度只能变长」过滤——合法下一帧完全可以更短
  // （final 比 process 短、新轮更短、定格「思考完成」、工具行切换等）。
  let lastUpdateTime = 0;
  const updateInterval = 500; // 合并窗口（ms）；尾随 flush 保证窗口内最后一帧必达
  let latestCardContent = "";
  /** 单调递增：每次 enqueue 分配；写卡完成时仅当仍是最新意图才更新 lastAppliedSeq */
  let streamEnqueueSeq = 0;
  let lastAppliedSeq = 0;
  let streamWriteChain: Promise<void> = Promise.resolve();
  let trailingFlushTimer: ReturnType<typeof setTimeout> | null = null;

  const clearTrailingFlush = () => {
    if (trailingFlushTimer) {
      clearTimeout(trailingFlushTimer);
      trailingFlushTimer = null;
    }
  };

  /**
   * 串行推送卡片内容。force=true 时忽略节流（定稿/final 必达）。
   * 非 force 时：窗口内合并，到期尾随刷「最新全文」一次。
   *
   * 乱序防护：队列执行时始终写 latestCardContent（合并为最新意图），
   * 并用 enqueue 序号避免过期 in-flight 逻辑干扰；允许内容变短。
   */
  const enqueueCardStream = (
    content: string,
    opts?: {
      force?: boolean;
      /** 定稿时传入 snapshot；过程中不传则用 currentCardTarget */
      card?: AICardInstance | null;
      contentVar?: string;
    },
  ): Promise<void> => {
    const force = Boolean(opts?.force);
    const cleaned = (content ?? "").trimEnd();
    // 允许变短：始终接受调用方给出的最新意图
    if (cleaned.length > 0 || force) {
      latestCardContent = cleaned;
    }
    const mySeq = ++streamEnqueueSeq;

    const explicitCard = opts?.card;
    const contentVar =
      opts?.contentVar ||
      ((account.config as DingtalkConfig)?.cardContentVar as string) ||
      "msgContent";

    const runWrite = async (writeForce: boolean) => {
      // 定稿用 explicitCard；过程中 sessionClosed 后不再写过程帧
      const targetCard = explicitCard ?? (sessionClosed ? null : currentCardTarget);
      if (!targetCard) return;

      // 若排队期间已有更新的 enqueue，本任务只需保证最终会写到最新即可：
      // 读 latestCardContent（可能已被更新），不要求 mySeq === streamEnqueueSeq 才写
      // （否则中间任务直接 return 会丢尾随前的合并写）。
      const text = latestCardContent;
      if (!text && !writeForce) return;

      const now = Date.now();
      if (!writeForce && now - lastUpdateTime < updateInterval) {
        // 已有更新的 enqueue 时，只靠最新那次的尾随即可
        if (mySeq !== streamEnqueueSeq) return;
        clearTrailingFlush();
        const wait = Math.max(updateInterval - (now - lastUpdateTime), 20);
        trailingFlushTimer = setTimeout(() => {
          trailingFlushTimer = null;
          void enqueueCardStream(latestCardContent, {
            force: true,
            contentVar,
          });
        }, wait);
        return;
      }

      // 过期任务：若更新的 force/写已应用，可跳过（减少无意义重复 PUT）
      if (!writeForce && mySeq < lastAppliedSeq) return;

      lastUpdateTime = Date.now();
      try {
        await streamAICard(
          targetCard as any,
          text,
          false,
          account.config as DingtalkConfig,
          log,
          contentVar,
        );
        // 仅当本次写的仍是当前最新意图时推进 applied（避免旧请求完成后抬高序号挡住新写）
        if (mySeq >= lastAppliedSeq && text === latestCardContent) {
          lastAppliedSeq = mySeq;
        } else if (streamEnqueueSeq > lastAppliedSeq) {
          // 写完后发现 latest 已变：立刻再排一次 force，把最新内容补上
          void enqueueCardStream(latestCardContent, {
            force: true,
            card: explicitCard,
            contentVar,
          });
        }
      } catch (err: any) {
        if (isQpsLimitError(err)) {
          log.warn(
            `[DingTalk][stream] QPS 限流，稍后尾随重试（latestLen=${latestCardContent.length}）`,
          );
          clearTrailingFlush();
          trailingFlushTimer = setTimeout(() => {
            trailingFlushTimer = null;
            void enqueueCardStream(latestCardContent, {
              force: true,
              card: explicitCard,
              contentVar,
            });
          }, 400);
        } else {
          log.error(`[DingTalk][stream] 写卡失败：${err?.message || err}`);
          throw err;
        }
      }
    };

    streamWriteChain = streamWriteChain
      .then(() => runWrite(force))
      .catch((e) => {
        log.warn(`[DingTalk][stream] 队列任务失败（不中断后续）：${e?.message || e}`);
      });
    return streamWriteChain;
  };

  /** 定稿前：取消尾随定时器，强制推送全文并等待队列排空 */
  const flushCardStream = async (
    content: string,
    card: AICardInstance,
  ): Promise<void> => {
    clearTrailingFlush();
    latestCardContent = content;
    await enqueueCardStream(content, { force: true, card });
    await streamWriteChain;
  };

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

  /** 组合当前卡片显示内容：流式文本 + 工具行（如有）。
   *  Markdown 变量中单个 \n 不渲染换行，需用 \n\n 段落分隔。
   *  若尚无模型正文却已有工具行 → 用固定占位「大模型已收到需求」，与后续「正文+工具」结构一致。 */
  const buildCardContent = (): string => {
    const textPart = accumulatedText.trim();
    const body =
      textPart ||
      (currentToolLine && !hasModelStreamText ? MODEL_RECEIPT_PLACEHOLDER : "");
    if (currentToolLine) {
      return body ? `${body}\n\n${currentToolLine}` : currentToolLine;
    }
    return body;
  };

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
      // 先排空过程中的串行写卡队列，避免定稿时仍有旧短文在途
      clearTrailingFlush();
      await streamWriteChain;

      // 选定最终答案：marker 优先 → lastAnswerText/accumulatedText 取更长 → 剥离尾标记
      let finalText = finalClean(pickFinalText());
      // 是否有真实对话答案（在套兜底文案之前判断）。纯工具进度/无回复时为 false，
      // 用于 answerCard 模式下决定"不另建无文本输出答案卡"。
      const hadRealAnswer = finalText.trim().length > 0;
      log.info(
        `[DingTalk][closeStreaming] 最终答案来源=${finalMarkedText !== null ? "marker[-final-]" : (lastAnswerText ? "非reasoning/累积取长" : "accumulatedText兜底")}，长度=${finalText.length}，lastAnswerLen=${lastAnswerText.length}，accLen=${accumulatedText.length}`,
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
      
      // 始终输出（不依赖 debug），便于排查本地图灰图
      console.log(
        `[DingTalk][LocalImage] closeStreaming 开始媒体处理 | target=${JSON.stringify(target)} hasToken=${!!oapiToken} textLen=${finalText.length}`,
      );
      // 预览正文中是否含 ![](
      const mdImgCount = (finalText.match(/!\[[^\]]*\]\([^)]+\)/g) || []).length;
      console.log(
        `[DingTalk][LocalImage] closeStreaming 正文 markdown 图数量=${mdImgCount} preview=${JSON.stringify(finalText.slice(0, 200))}`,
      );
      
      if (oapiToken) {
        // 处理本地图片（含 /mnt 共享盘；失败会 /tmp 重试，避免留下本地路径灰图）
        const beforeImg = finalText;
        finalText = await processLocalImages(finalText, oapiToken, log);
        if (beforeImg !== finalText) {
          console.log(
            `[DingTalk][LocalImage] closeStreaming 图片处理 | ${beforeImg.length}→${finalText.length}`,
          );
        }
        // 仅统计代码块外的本地 ![]——示例 JSON/参数说明里的路径不算灰图风险
        try {
          const { hasResidualLocalMdImagesOutsideCode } = await import("./services/media.ts");
          if (hasResidualLocalMdImagesOutsideCode(finalText)) {
            console.warn(
              `[DingTalk][LocalImage] closeStreaming 定稿后仍有代码块外的本地 MD 图未上传，钉钉可能灰图`,
            );
          }
        } catch {
          // ignore
        }
        
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

      // ===== 答案专用卡模式（answerCard + answerActToken）=====
      // 设计目的（请勿破坏）：
      //   钉钉流式卡按固定速度渲染，网关早已完成时卡还在「慢慢打字」。
      //   - token 少（≤ answerActToken，默认 500）：仍在原流式卡上定稿，日常聊天不拆双卡
      //   - token 多（> answerActToken）：原卡定格"✅ 思考完成"，另建静态答案卡一次投全文，快速可读
      // answerCard 默认开启（显式 false 才关）。answerCardTemplateId 可配答案卡模板。
      //
      // 与「终态截断修复」的关系：
      //   - 小答案：flush 全文 → finish（finish 内再 stream 覆盖，防 FINISHED 不刷新）
      //   - 大答案：原卡只 flush「思考完成」，全文只进新答案卡（skipInputingWalk，不走流式假回放）
      const useAnswerCard = (account.config as any)?.answerCard !== false;
      if (useAnswerCard) {
        /** 原流式卡收尾为思考完成（大答案 / 无答案路径专用，勿写入终稿全文） */
        const finalizeOriginalToDone = async () => {
          try {
            await flushCardStream("✅ 思考完成", cardSnapshot as any);
            await finishAICard(
              cardSnapshot as any,
              "✅ 思考完成",
              account.config as DingtalkConfig,
              log,
              undefined,
              undefined,
              conversationId,
            );
          } catch (e: any) {
            log.warn(`[DingTalk][closeStreaming] 原卡定格思考完成失败（忽略）：${e?.message || e}`);
          }
        };

        const answerTplId = ((account.config as any)?.answerCardTemplateId as string)?.trim() || ANSWER_CARD_TEMPLATE_ID;
        // token 阈值：少 → 单卡正常聊；多 → 双卡快速出全文
        const answerActToken = Number((account.config as any)?.answerActToken) || 500;
        const answerTokens = estimateTokens(finalText);

        if (!hadRealAnswer) {
          log.info(`[DingTalk][closeStreaming] answerCard 模式：无真实答案，仅定格原卡思考完成（不建答案卡）`);
          await finalizeOriginalToDone();
        } else if (answerTokens <= answerActToken) {
          // 小答案：单卡定稿（不新建答案卡）
          log.info(`[DingTalk][closeStreaming] answerCard 模式：答案约 ${answerTokens} token ≤ ${answerActToken}，原卡直接定稿（不建答案卡）`);
          try {
            await flushCardStream(finalText, cardSnapshot as any);
          } catch (e: any) {
            log.warn(`[DingTalk][closeStreaming] 原卡终稿 flush 失败（继续 FINISH）：${e?.message || e}`);
          }
          await finishAICard(
            cardSnapshot as any,
            finalText,
            account.config as DingtalkConfig,
            log,
            undefined,
            undefined,
            conversationId,
          );
        } else {
          // 大答案：原卡思考完成 + 新建答案卡投全文（双卡机制，保留）
          log.info(`[DingTalk][closeStreaming] answerCard 模式：答案约 ${answerTokens} token > ${answerActToken}，原卡思考完成 + 新建答案卡（模板=${answerTplId}）`);
          // 注意：此处故意不把 finalText flush 到原卡，避免长文在原卡慢速流式，再被思考完成盖掉
          await finalizeOriginalToDone();
          const answerCard = await createAICardForTarget(
            account.config as DingtalkConfig,
            target,
            log,
            answerTplId,
          );
          if (answerCard) {
            // 静态答案卡：一次性 FINISHED 全文，不走 INPUTING/流式
            await finishAICard(
              answerCard,
              finalText,
              account.config as DingtalkConfig,
              log,
              undefined,
              /*skipInputingWalk*/ true,
              conversationId,
            );
            log.info(`[DingTalk][closeStreaming] ✅ 答案卡投放成功`);
          } else {
            // 答案卡建失败 → 降级：全文定稿到原卡，保证用户能看到
            log.warn(`[DingTalk][closeStreaming] 答案卡创建失败，降级定稿原卡`);
            try {
              await flushCardStream(finalText, cardSnapshot as any);
            } catch { /* ignore */ }
            await finishAICard(
              cardSnapshot as any,
              finalText,
              account.config as DingtalkConfig,
              log,
              undefined,
              undefined,
              conversationId,
            );
          }
        }
      } else {
        log.info(`[DingTalk][closeStreaming] 准备 finishAICard，文本长度=${finalText.length}`);
        try {
          await flushCardStream(finalText, cardSnapshot as any);
        } catch (e: any) {
          log.warn(`[DingTalk][closeStreaming] 终稿 flush 失败（继续 FINISH）：${e?.message || e}`);
        }
        await finishAICard(
          cardSnapshot as any,
          finalText,
          account.config as DingtalkConfig,
          log,
          undefined,
          undefined,
          conversationId,
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
        currentToolLine = "";
        hasModelStreamText = false;
        // 重置流式写卡状态（新轮序号从 0 计，允许内容比上轮更短）
        clearTrailingFlush();
        latestCardContent = "";
        streamEnqueueSeq = 0;
        lastAppliedSeq = 0;
        lastUpdateTime = 0;
        // 延迟建卡：不在 onReplyStart 抢先建卡，改由第一段真正的对话内容（onPartialReply /
        // deliver block/final）按需创建。否则纯 message 工具轮次（无对话回复，deliver 计数全 0）
        // 会留下一张没人喂的孤儿卡，收尾兜底成"无文本输出"。
        typingCallbacks.onActive?.();
      },
      deliver: async (payload, info) => {
        let text = payload.text ?? "";
        // 仅当 OpenClaw 透传了非空 rawError 时做关键词匹配 → 中文提示。
        // rawError 为空 = 正常回复 / 无原始错误，绝不匹配，避免误伤。
        const rawError = readPayloadRawError(payload);
        if (rawError) {
          const matchedErrorText = matchModelErrorText(rawError, {
            includeCatchAll: true,
          });
          if (matchedErrorText) {
            log.warn(
              `[DingTalk][deliver] 检测到上游 rawError，替换为中文提示（raw=${rawError.slice(0, 120)}）`,
            );
            text = matchedErrorText;
          }
        }

        log.debug(`[DingTalk][deliver] kind=${info?.kind}, textLength=${text.length}, textPreview=${text.slice(0, 80)}`);

        // 观察标记：更新最终答案认定（marker / 非 reasoning 兜底）
        observeReply(payload.text, payload);

        // ✅ 确保 AI Card 已就绪——在上游模型异常 payload 到达时，
        // startStreaming 可能尚未被调用（无 onPartialReply 触发），
        // 导致 currentCardTarget 为空，错误提示无法写入卡片。
        await startStreaming();

        // 工具失败/状态通知 payload：流式时可短暂展示，但绝不计入最终答案（不设 accumulatedText / 不当 final）。
        // 修复：dws 等工具调用失败的结果偶发被当成最终答案、提前停渲染。
        if (isNonAnswerPayload(payload)) {
          if (streamingEnabled && currentCardTarget && !asyncMode && finalMarkedText === null) {
            try {
              await enqueueCardStream(displayClean(text));
            } catch (e: any) {
              if (!isQpsLimitError(e)) log.warn(`[DingTalk][deliver] 状态/错误 payload 写卡失败：${e?.message || e}`);
            }
          }
          // ✅ 当上游模型异常通过 deliver(final) 到达时，将错误文本存入 accumulatedText，
          // 防止 onIdle 的兜底覆盖为通用错误文案，并确保 closeStreaming 能读到正确的错误提示。
          if ((payload as any).isError && !accumulatedText.trim() && text.trim()) {
            accumulatedText = text;
            log.info(`[DingTalk][deliver] 将上游异常 payload 文本存入 accumulatedText（len=${text.length}），防止 onIdle 覆盖`);
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
            currentToolLine = "";  // block 到来，工具行消失
            // 若 onPartialReply 已开始流式传输最终文本（accumulatedText 非空），
            // 则跳过 block 更新，避免旧状态消息覆盖正在流式中的最终回复。
            if (accumulatedText) {
              log.info(`[DingTalk][deliver] block 消息：最终回复已在流式中（${accumulatedText.length}字），跳过以防覆盖流式内容`);
              return;
            }
            try {
              await enqueueCardStream(displayClean(text));
              log.info(`[DingTalk][deliver] ✅ block 已入写卡队列，文本长度=${text.length}`);
            } catch (streamErr: any) {
              log.error(`[DingTalk][deliver] ❌ block 更新 AI Card 失败：${streamErr.message}`);
            }
          } else {
            log.warn(`[DingTalk][deliver] block 消息：AI Card 创建失败，丢弃该 block`);
          }
          return;
        }

        // 流式模式的 final 处理
        if (info?.kind === "final" && streamingEnabled) {
          log.info(`[DingTalk][deliver] final 响应，流式模式`);
          await startStreaming();

          if (currentCardTarget) {
            // 终稿必须进内存（供 closeStreaming / pickFinalText）
            accumulatedText = text;
            lastAnswerText =
              text.length >= lastAnswerText.length ? text : lastAnswerText;
            deliveredFinalTexts.add(text);

            // 是否会走「大答案 → 新建答案卡」：若会，则不要把全文 force 刷到原流式卡
            // （否则长文在原卡慢速渲染，随后又被定格成思考完成，浪费且破坏双卡机制）
            const useAnswerCard = (account.config as any)?.answerCard !== false;
            const answerActToken = Number((account.config as any)?.answerActToken) || 500;
            const approxTokens = estimateTokens(text);
            const willSpawnAnswerCard = useAnswerCard && approxTokens > answerActToken;

            if (willSpawnAnswerCard) {
              log.info(
                `[DingTalk][deliver] final 约 ${approxTokens} token > ${answerActToken}，仅更新内存，等 closeStreaming 建答案卡（不强制刷原卡全文）`,
              );
            } else {
              // 小答案 / 单卡：立即 force 刷全文，降低终态截断
              try {
                await enqueueCardStream(displayClean(buildCardContent() || text), {
                  force: true,
                });
                log.info(
                  `[DingTalk][deliver] final 已强制刷卡（len=${text.length}），closeStreaming 将定稿`,
                );
              } catch (e: any) {
                log.warn(
                  `[DingTalk][deliver] final 强制刷卡失败（closeStreaming 仍会定稿）：${e?.message || e}`,
                );
              }
            }
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
        const errorMsg = String(error);
        log.error(`[DingTalk][onError] ${info.kind} reply failed: ${errorMsg}`);
        params.runtime.error?.(
          `dingtalk[${account.accountId}] ${info.kind} reply failed: ${errorMsg}`
        );

        // 确保卡片已就绪（错误可能在 startStreaming 之前发生）
        await startStreaming();

        // 上游模型异常：按错误类型匹配中文提示（与 deliver 共用完整规则表）
        const errorText =
          matchModelErrorText(errorMsg, { includeCatchAll: true }) ??
          "⚠️ 模型请求异常，请稍后重试";
        log.warn(`[DingTalk][onError] 错误提示: ${errorText.slice(0, 80)}`);

        // 始终写入 accumulatedText（即使 currentCardTarget 已被 onIdle 清空）
        if (!accumulatedText.trim()) {
          accumulatedText = errorText;
        }

        // 卡片还活着 → closeStreaming 会用 accumulatedText 定稿到卡片。
        // 卡片已关（onIdle 先触发且已复用 preCreatedCard 关闭了会话）→ 跳过，
        // 避免对同一张卡片重复调用 closeStreaming 导致钉钉 API 报错。
        // 仅当会话尚未被关闭且卡片引用已丢失时才尝试恢复卡片引用。
        if (!currentCardTarget && !sessionClosed) {
          if (preCreatedCard) {
            // 即时建卡已创建但 startStreaming 未调用（或失败），直接复用
            try {
              currentCardTarget = preCreatedCard as any;
              if (!isDirect) {
                registerActiveCard(conversationId, preCreatedCard);
              }
              log.info(`[DingTalk][onError] 复用即时建卡显示错误（cardInstanceId=${preCreatedCard.cardInstanceId}）`);
            } catch (cardErr: any) {
              log.warn(`[DingTalk][onError] 复用即时建卡失败：${cardErr.message}，降级发送普通消息`);
              try {
                await sendMessage(
                  account.config as DingtalkConfig,
                  sessionWebhook,
                  accumulatedText,
                  { useMarkdown: false, log: params.runtime.log }
                );
              } catch (sendErr: any) {
                log.error(`[DingTalk][onError] 降级发送普通消息失败：${sendErr.message}`);
              }
            }
          } else {
            log.warn(`[DingTalk][onError] 卡片已关闭且无即时建卡，降级发送普通消息`);
            try {
              await sendMessage(
                account.config as DingtalkConfig,
                sessionWebhook,
                accumulatedText,
                { useMarkdown: false, log: params.runtime.log }
              );
            } catch (sendErr: any) {
              log.error(`[DingTalk][onError] 降级发送普通消息失败：${sendErr.message}`);
            }
          }
        }

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

        // 检测到 [-final-] → 内存更新 + 强制刷最新全文，定稿仍由 onIdle 负责 FINISHED
        if (finalMarkedText !== null) {
          accumulatedText = payload.text;
          if (payload.text?.trim()) hasModelStreamText = true;
          currentToolLine = "";
          await startStreaming();
          if (currentCardTarget) {
            try {
              const { FILE_MARKER_PATTERN, VIDEO_MARKER_PATTERN, AUDIO_MARKER_PATTERN } =
                await import("./services/media/common.ts");
              const displayContent = buildCardContent()
                .replace(FILE_MARKER_PATTERN, "")
                .replace(VIDEO_MARKER_PATTERN, "")
                .replace(AUDIO_MARKER_PATTERN, "")
                .trim();
              await enqueueCardStream(displayContent, { force: true });
            } catch (err: any) {
              if (!isQpsLimitError(err)) {
                log.error(`[DingTalk][onPartialReply] final-marker 刷卡失败：${err.message}`);
              }
            }
          }
          return;
        }

        await startStreaming();

        if (currentCardTarget) {
          accumulatedText = payload.text;
          if (payload.text?.trim()) hasModelStreamText = true;
          currentToolLine = "";

          try {
            const { FILE_MARKER_PATTERN, VIDEO_MARKER_PATTERN, AUDIO_MARKER_PATTERN } =
              await import("./services/media/common.ts");
            const displayContent = buildCardContent()
              .replace(FILE_MARKER_PATTERN, "")
              .replace(VIDEO_MARKER_PATTERN, "")
              .replace(AUDIO_MARKER_PATTERN, "")
              .trim();
            // 串行 + 尾随合并：不丢最后一帧，也不并发短盖长
            await enqueueCardStream(displayContent);
          } catch (err: any) {
            if (isQpsLimitError(err)) {
              log.warn(
                `[DingTalk][onPartialReply] QPS 限流，已排队尾随重试 latestLen=${latestCardContent.length}`,
              );
            } else {
              log.error(`[DingTalk][onPartialReply] ❌ AI Card 更新失败：${err.message}`);
              await sendFallbackErrorMessage("sendMessage", err.message);
            }
          }
        }
      },
      }),
      // ===== 工具调用进度：开始调用工具时，在流式文本下方显示工具行 =====
      // OpenClaw 的 onToolStart 带干净的工具名（payload.name）。已进入最终答案 / 异步 / 非流式则跳过。
      // 工具行嵌入在流式文本下方，单行旋转替换；流式文本恢复时由 onPartialReply 清掉。
      // 若此前尚无模型正文（纯工具打头）：展示固定首段「大模型已收到需求」+ 工具行，结构与后续一致。
      onToolStart: async (payload: { name?: string; phase?: string; args?: Record<string, unknown> }) => {
        const toolName = (payload?.name || "").trim();
        if (!toolName) return;
        if (payload?.phase === "end" || payload?.phase === "complete") return;
        if (!streamingEnabled || asyncMode || finalMarkedText !== null) return;
        try {
          await startStreaming();
          if (!currentCardTarget) return;
          currentToolLine = `🔧 正在调用：${toolName}`;
          // buildCardContent：无正文时自动垫「🤖 大模型已收到需求」
          const cardText = buildCardContent();
          await enqueueCardStream(cardText, { force: true });
          log.info(
            `[DingTalk][onToolStart] 工具进度写卡：${toolName}（phase=${payload?.phase}，hasModelStreamText=${hasModelStreamText}，preview=${cardText.slice(0, 80)}）`,
          );
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
        // 工具进度改由 onToolStart + 正文同一 cardContentVar 展示，不再写独立 cardToolVar 字段
      },
    },
    markDispatchIdle,
    getAsyncModeResponse: () => asyncModeFullResponse,
  };
}
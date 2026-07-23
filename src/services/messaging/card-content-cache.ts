/**
 * AI / 交互卡片正文缓存
 *
 * 钉钉「引用 AI 卡片」时，回调里的 repliedMsg 经常是：
 *   { msgType: "interactiveCard", content: {} 或仅有 templateId }
 * 不带可读正文 → 模型侧只看到 `[引用] [interactiveCard消息]`。
 *
 * 对策：我们在 finishAICard / 定稿时把 outTrackId → 正文 记下来；
 * 引用时仅用载荷里的 outTrackId / msgId 等精确回填。
 * 默认不做「会话最近一条」兜底（会把错误卡片正文当成用户引用的内容）。
 *
 * 内存 LRU + TTL，进程重启后清空（可接受）。
 */

export type CardContentCacheEntry = {
  text: string;
  at: number;
  conversationId?: string;
  outTrackId?: string;
  msgId?: string;
};

const MAX_ENTRIES = 300;
/** 默认保留 7 天（引用历史卡片） */
const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const byKey = new Map<string, CardContentCacheEntry>();
/** 每个会话最近若干条（新→旧） */
const byConversation = new Map<string, string[]>();

function pruneExpired(now = Date.now(), ttlMs = DEFAULT_TTL_MS): void {
  for (const [k, v] of byKey) {
    if (now - v.at > ttlMs) byKey.delete(k);
  }
  // 简单容量控制：超限时删最旧
  if (byKey.size <= MAX_ENTRIES) return;
  const sorted = [...byKey.entries()].sort((a, b) => a[1].at - b[1].at);
  const drop = sorted.length - MAX_ENTRIES;
  for (let i = 0; i < drop; i++) {
    byKey.delete(sorted[i][0]);
  }
}

function normalizeKey(kind: string, id: string): string {
  return `${kind}:${id.trim()}`;
}

/**
 * 记住一张卡的终稿正文
 */
export function rememberCardContent(params: {
  text: string;
  outTrackId?: string;
  msgId?: string;
  conversationId?: string;
}): void {
  const text = (params.text || "").trim();
  if (!text) return;
  // 无意义的占位不记（原卡「思考完成」仍记录，引用时至少有上下文）
  const entry: CardContentCacheEntry = {
    text,
    at: Date.now(),
    conversationId: params.conversationId,
    outTrackId: params.outTrackId,
    msgId: params.msgId,
  };

  pruneExpired();

  if (params.outTrackId) {
    byKey.set(normalizeKey("outTrack", params.outTrackId), entry);
  }
  if (params.msgId) {
    byKey.set(normalizeKey("msgId", params.msgId), entry);
  }
  if (params.conversationId) {
    const cid = params.conversationId;
    const list = byConversation.get(cid) || [];
    // 用 outTrackId 或时间戳作 list 内 key
    const ref = params.outTrackId || params.msgId || `t${entry.at}`;
    const next = [ref, ...list.filter((x) => x !== ref)].slice(0, 20);
    byConversation.set(cid, next);
    byKey.set(normalizeKey("convRef", `${cid}|${ref}`), entry);
  }

  try {
    console.log(
      `[DingTalk][CardCache] 已缓存 | outTrack=${params.outTrackId || "-"} conv=${params.conversationId || "-"} len=${text.length}`,
    );
  } catch {
    // ignore
  }
}

/**
 * 从引用载荷里可能出现的字段收集候选 id
 */
export function collectCardLookupIds(repliedMsg: any, contentObj: any): string[] {
  const ids: string[] = [];
  const push = (v: unknown) => {
    if (typeof v === "string" && v.trim()) ids.push(v.trim());
  };

  push(contentObj?.outTrackId);
  push(contentObj?.outTrackID);
  push(contentObj?.cardInstanceId);
  push(contentObj?.cardInstanceID);
  push(contentObj?.trackId);
  push(contentObj?.bizId);
  push(contentObj?.cardBizId);
  push(contentObj?.instanceId);
  push(repliedMsg?.outTrackId);
  push(repliedMsg?.cardInstanceId);
  push(repliedMsg?.msgId);
  push(repliedMsg?.msgID);
  push(repliedMsg?.messageId);

  // 嵌套 cardData
  const nests = [contentObj?.cardData, contentObj?.data, contentObj?.bizData];
  for (const n of nests) {
    if (!n || typeof n !== "object") continue;
    push((n as any).outTrackId);
    push((n as any).cardInstanceId);
    push((n as any).trackId);
  }

  return [...new Set(ids)];
}

/**
 * 查找缓存正文
 */
export function lookupCardContent(params: {
  ids?: string[];
  conversationId?: string;
  /**
   * 是否允许用「会话最近一张卡」兜底。
   * 默认 false：只按 ids（outTrackId / msgId 等）精确命中，避免张冠李戴。
   */
  allowConversationRecent?: boolean;
}): string | null {
  pruneExpired();
  const ids = params.ids || [];

  for (const id of ids) {
    const a = byKey.get(normalizeKey("outTrack", id));
    if (a?.text) return a.text;
    const b = byKey.get(normalizeKey("msgId", id));
    if (b?.text) return b.text;
  }

  // 仅显式开启时才回退会话最近卡（默认关闭）
  if (params.allowConversationRecent === true && params.conversationId) {
    const list = byConversation.get(params.conversationId) || [];
    for (const ref of list) {
      // 优先非「思考完成」的条目
      const e =
        byKey.get(normalizeKey("outTrack", ref)) ||
        byKey.get(normalizeKey("msgId", ref)) ||
        byKey.get(normalizeKey("convRef", `${params.conversationId}|${ref}`));
      if (e?.text && e.text !== "✅ 思考完成") return e.text;
    }
    // 再退回任意最近一条
    for (const ref of list) {
      const e =
        byKey.get(normalizeKey("outTrack", ref)) ||
        byKey.get(normalizeKey("msgId", ref)) ||
        byKey.get(normalizeKey("convRef", `${params.conversationId}|${ref}`));
      if (e?.text) return e.text;
    }
  }

  return null;
}

/** 测试用：清空缓存 */
export function clearCardContentCache(): void {
  byKey.clear();
  byConversation.clear();
}

/** 测试用：条目数 */
export function cardContentCacheSize(): number {
  return byKey.size;
}

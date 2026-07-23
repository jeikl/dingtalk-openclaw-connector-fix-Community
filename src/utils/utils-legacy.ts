/**
 * 钉钉插件工具函数
 */

import type { DingtalkConfig, ResolvedDingtalkAccount } from '../types/index.ts';

// SessionContext 和 buildSessionContext 统一由 session.ts 维护
export type { SessionContext } from './session.ts';
export { buildSessionContext } from './session.ts';

// ============ 常量 ============

/** 默认账号 ID，用于标记单账号模式（无 accounts 配置）时的内部标识 */
export const DEFAULT_ACCOUNT_ID = '__default__';

/** 新会话触发命令 */
export const NEW_SESSION_COMMANDS = ['/new', '/reset', '/clear', '新会话', '重新开始', '清空对话'];

/** 钉钉 API 常量 */
export const DINGTALK_API = 'https://api.dingtalk.com';
export const DINGTALK_OAPI = 'https://oapi.dingtalk.com';

// ============ 会话管理 ============

/**
 * 检查消息是否是新会话命令
 */
export function normalizeSlashCommand(text: string): string {
  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();
  if (NEW_SESSION_COMMANDS.some((cmd) => lower === cmd.toLowerCase())) {
    return '/new';
  }
  return text;
}

// ============ Access Token 缓存 ============

type CachedToken = {
  token: string;
  expiryMs: number;
};

// 注意：这里仍被部分新逻辑引用（如 message-handler），必须支持多账号，不能用全局单例缓存
const apiTokenCache = new Map<string, CachedToken>();
const oapiTokenCache = new Map<string, CachedToken>();

function cacheKey(config: DingtalkConfig): string {
  const clientId = String((config as any)?.clientId ?? '').trim();
  
  // 添加校验
  if (!clientId) {
    throw new Error(
      'Invalid DingtalkConfig: clientId is required for token caching. ' +
      'Please ensure your configuration includes a valid clientId.'
    );
  }
  
  return clientId;
}

/**
 * 获取钉钉 Access Token（新版 API）
 */
export async function getAccessToken(config: DingtalkConfig): Promise<string> {
  const now = Date.now();
  const key = cacheKey(config);
  const cached = apiTokenCache.get(key);
  if (cached && cached.expiryMs > now + 60_000) {
    return cached.token;
  }

  const { dingtalkHttp } = await import('./http-client.ts');
  const response = await dingtalkHttp.post(`${DINGTALK_API}/v1.0/oauth2/accessToken`, {
    appKey: config.clientId,
    appSecret: config.clientSecret,
  });

  const token = response.data.accessToken as string;
  const expireInSec = Number(response.data.expireIn ?? 0);
  apiTokenCache.set(key, { token, expiryMs: now + expireInSec * 1000 });
  return token;
}

/**
 * 获取钉钉 OAPI Access Token（旧版 API，用于媒体上传等）
 */
export async function getOapiAccessToken(config: DingtalkConfig): Promise<string | null> {
  try {
    const now = Date.now();
    const key = cacheKey(config);
    const cached = oapiTokenCache.get(key);
    if (cached && cached.expiryMs > now + 60_000) {
      return cached.token;
    }

    const { dingtalkOapiHttp } = await import('./http-client.ts');
    const resp = await dingtalkOapiHttp.get(`${DINGTALK_OAPI}/gettoken`, {
      params: { appkey: config.clientId, appsecret: config.clientSecret },
    });
    if (resp.data?.errcode === 0 && resp.data?.access_token) {
      const token = String(resp.data.access_token);
      const expiresInSec = Number(resp.data.expires_in ?? 7200);
      oapiTokenCache.set(key, { token, expiryMs: now + expiresInSec * 1000 });
      return token;
    }
    return null;
  } catch {
    return null;
  }
}

// ============ 用户资料（真名 / unionId） ============

/** staffId → 通讯录资料缓存（带过期时间的 LRU） */
const MAX_USER_PROFILE_CACHE_SIZE = 1000;
const USER_PROFILE_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 小时

export type DingtalkUserProfile = {
  /** 企业通讯录姓名（通常是真名 / 花名配置的「姓名」字段） */
  name?: string;
  unionId?: string;
  /** 通讯录里的别名（若有） */
  alias?: string;
  /** 职位 / 岗位 title */
  title?: string;
  /** 入职时间（毫秒时间戳） */
  hiredDateMs?: number;
  /** 是否老板 */
  boss?: boolean;
  /** 是否部门主管 */
  leader?: boolean;
};

interface UserProfileCacheEntry {
  profile: DingtalkUserProfile;
  timestamp: number;
}

const userProfileCache = new Map<string, UserProfileCacheEntry>();

function pruneUserProfileCache(): void {
  if (userProfileCache.size < MAX_USER_PROFILE_CACHE_SIZE) return;
  let oldestKey: string | null = null;
  let oldestTime = Date.now();
  for (const [key, entry] of userProfileCache.entries()) {
    if (entry.timestamp < oldestTime) {
      oldestTime = entry.timestamp;
      oldestKey = key;
    }
  }
  if (oldestKey) userProfileCache.delete(oldestKey);
}

/**
 * 解析 user/get 类响应里的核心字段（兼容 topapi/v2 的 result.* 与旧版扁平字段）。
 */
function parseUserProfilePayload(data: any): DingtalkUserProfile | null {
  if (!data || typeof data !== "object") return null;
  if (data.errcode !== undefined && data.errcode !== 0) return null;
  const result = data.result && typeof data.result === "object" ? data.result : data;
  const name =
    (typeof result.name === "string" && result.name.trim()) ||
    (typeof data.name === "string" && data.name.trim()) ||
    undefined;
  const unionId =
    (typeof result.unionid === "string" && result.unionid.trim()) ||
    (typeof data.unionid === "string" && data.unionid.trim()) ||
    undefined;
  const alias =
    (typeof result.alias === "string" && result.alias.trim()) ||
    (typeof data.alias === "string" && data.alias.trim()) ||
    undefined;
  const title =
    (typeof result.title === "string" && result.title.trim()) ||
    (typeof data.title === "string" && data.title.trim()) ||
    undefined;

  let hiredDateMs: number | undefined;
  const hiredRaw = result.hired_date ?? result.hiredDate ?? data.hired_date;
  if (typeof hiredRaw === "number" && Number.isFinite(hiredRaw) && hiredRaw > 0) {
    hiredDateMs = hiredRaw;
  } else if (typeof hiredRaw === "string" && hiredRaw.trim()) {
    const n = Number(hiredRaw);
    if (Number.isFinite(n) && n > 0) hiredDateMs = n;
  }

  const boss = Boolean(result.boss ?? data.boss);
  const leader = Boolean(result.leader ?? data.leader);

  if (!name && !unionId && !title) return null;
  return {
    name,
    unionId,
    alias,
    title,
    hiredDateMs,
    boss: boss || undefined,
    leader: leader || undefined,
  };
}

/**
 * 入职时间毫秒 → Asia/Shanghai 的 `YYYY-MM-DD HH:mm:ss`
 */
export function formatHiredDateShanghai(ms?: number | null): string | undefined {
  if (ms == null || !Number.isFinite(ms) || ms <= 0) return undefined;
  const SH_OFFSET_MS = 8 * 60 * 60 * 1000;
  const d = new Date(Number(ms) + SH_OFFSET_MS);
  const y = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  const h = String(d.getUTCHours()).padStart(2, "0");
  const mi = String(d.getUTCMinutes()).padStart(2, "0");
  const s = String(d.getUTCSeconds()).padStart(2, "0");
  return `${y}-${mo}-${day} ${h}:${mi}:${s}`;
}

/**
 * 角色展示：仅老板 / 主管（不含管理员、专属账号）。
 */
export function formatSenderRoles(params: {
  boss?: boolean | null;
  leader?: boolean | null;
}): string | undefined {
  const parts: string[] = [];
  if (params.boss) parts.push("老板");
  if (params.leader) parts.push("主管");
  return parts.length ? parts.join("、") : undefined;
}

/**
 * 通过通讯录接口按 userid 拉取用户详情（真名等）。
 *
 * 首选：POST `https://oapi.dingtalk.com/topapi/v2/user/get?access_token=...`
 * body: `{ userid, language: "zh_CN" }` → `result.name` / `result.unionid`
 *
 * 鉴权：优先新版 oauth2 accessToken，失败再试 oapi gettoken。
 * 依赖应用「通讯录只读」等权限；外部成员 / 无权限时失败，调用方回退 senderNick。
 */
export async function getUserProfile(
  staffId: string,
  config: DingtalkConfig,
  log?: any,
): Promise<DingtalkUserProfile | null> {
  const id = String(staffId || "").trim();
  if (!id) return null;

  const cached = userProfileCache.get(id);
  if (cached && Date.now() - cached.timestamp < USER_PROFILE_CACHE_TTL) {
    return cached.profile;
  }

  try {
    // 1) 新版 oauth2 accessToken；2) 旧版 oapi gettoken —— 均可作为 oapi query access_token
    let token: string | null = null;
    try {
      token = await getAccessToken(config);
    } catch {
      token = null;
    }
    if (!token) {
      token = await getOapiAccessToken(config);
    }
    if (!token) {
      log?.warn?.("[DingTalk] getUserProfile: 无法获取 access_token");
      return null;
    }

    const { dingtalkOapiHttp } = await import("./http-client.ts");

    // 首选：topapi/v2/user/get（官方「按 userid 获取用户详情」）
    let data: any;
    try {
      const resp = await dingtalkOapiHttp.post(
        `${DINGTALK_OAPI}/topapi/v2/user/get`,
        { userid: id, language: "zh_CN" },
        {
          params: { access_token: token },
          headers: { "Content-Type": "application/json" },
          timeout: 10_000,
        },
      );
      data = resp.data || {};
    } catch (e: any) {
      log?.warn?.(
        `[DingTalk] getUserProfile: topapi/v2/user/get 请求失败，尝试旧版 /user/get: ${e?.message || e}`,
      );
      data = null;
    }

    let profile = data ? parseUserProfilePayload(data) : null;
    if (!profile && data && data.errcode !== undefined && data.errcode !== 0) {
      log?.warn?.(
        `[DingTalk] getUserProfile: topapi/v2 errcode=${data.errcode} errmsg=${data.errmsg || ""} staffId=${id}`,
      );
    }

    // 兜底：旧版 GET /user/get（扁平 name/unionid）
    if (!profile) {
      try {
        const resp = await dingtalkOapiHttp.get(`${DINGTALK_OAPI}/user/get`, {
          params: { access_token: token, userid: id },
          timeout: 10_000,
        });
        data = resp.data || {};
        profile = parseUserProfilePayload(data);
        if (!profile && data.errcode !== undefined && data.errcode !== 0) {
          log?.warn?.(
            `[DingTalk] getUserProfile: /user/get errcode=${data.errcode} errmsg=${data.errmsg || ""} staffId=${id}`,
          );
        }
      } catch (e: any) {
        log?.warn?.(`[DingTalk] getUserProfile: 旧版 /user/get 失败: ${e?.message || e}`);
      }
    }

    if (!profile) {
      log?.warn?.(
        `[DingTalk] getUserProfile: 无法解析用户资料 staffId=${id} raw=${JSON.stringify(data || {}).slice(0, 300)}`,
      );
      return null;
    }

    pruneUserProfileCache();
    userProfileCache.set(id, { profile, timestamp: Date.now() });
    log?.info?.(
      `[DingTalk] getUserProfile: ${id} → name=${profile.name || "-"} unionId=${profile.unionId || "-"}`,
    );
    return profile;
  } catch (err: any) {
    log?.warn?.(`[DingTalk] getUserProfile 失败: ${err?.message || err}`);
    return null;
  }
}

/**
 * 通过 oapi 旧版接口将 staffId 转换为 unionId
 */
export async function getUnionId(
  staffId: string,
  config: DingtalkConfig,
  log?: any,
): Promise<string | null> {
  const profile = await getUserProfile(staffId, config, log);
  return profile?.unionId || null;
}

/**
 * 拼发送人展示名：优先通讯录真名，可附带昵称。
 * - 真名+昵称且不同 → `真名（昵称）`
 * - 仅有其一 → 用有的那个
 */
export function formatSenderDisplayLabel(params: {
  realName?: string | null;
  nickName?: string | null;
}): string {
  const real = String(params.realName || "").trim();
  const nick = String(params.nickName || "").trim();
  if (real && nick && real !== nick) return `${real}（${nick}）`;
  return real || nick || "未知";
}

// ============ 消息去重 ============

/** 消息去重缓存 Map<messageId, timestamp> - 防止同一消息被重复处理 */
const processedMessages = new Map<string, number>();

/** 消息去重缓存过期时间（5分钟） */
const MESSAGE_DEDUP_TTL = 5 * 60 * 1000;

/** 定时清理器 */
let cleanupTimer: NodeJS.Timeout | null = null;

/**
 * 清理过期的消息去重缓存
 */
export function cleanupProcessedMessages(): void {
  const now = Date.now();
  for (const [msgId, timestamp] of processedMessages.entries()) {
    if (now - timestamp > MESSAGE_DEDUP_TTL) {
      processedMessages.delete(msgId);
    }
  }
}

/**
 * 启动定时清理机制
 */
export function startMessageCleanup(): void {
  if (cleanupTimer) return; // 防止重复启动
  
  // 每 5 分钟清理一次
  cleanupTimer = setInterval(() => {
    cleanupProcessedMessages();
  }, 5 * 60 * 1000);
}

/**
 * 停止定时清理机制
 */
export function stopMessageCleanup(): void {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
}

/**
 * 检查消息是否已处理过（去重）
 */
export function isMessageProcessed(messageId: string): boolean {
  if (!messageId) return false;
  return processedMessages.has(messageId);
}

/**
 * 标记消息为已处理
 */
export function markMessageProcessed(messageId: string): void {
  if (!messageId) return;
  processedMessages.set(messageId, Date.now());
  // 定期清理（每处理100条消息清理一次）
  if (processedMessages.size >= 100) {
    cleanupProcessedMessages();
  }
}

/**
 * 对钉钉 Stream 消息做双层去重检查，并在首次处理时标记。
 *
 * 背景：钉钉 Stream 模式存在两套消息 ID：
 *   - headers.messageId：WebSocket 协议层的投递 ID，每次重发都会生成新值
 *   - data.msgId：业务层的用户消息 ID，重发时保持不变
 *
 * 因此必须同时检查两个 ID，才能可靠地拦截钉钉服务端的重发消息：
 *   1. 协议层去重（headers.messageId）：拦截同一次投递的重复回调
 *   2. 业务层去重（data.msgId）：拦截 ~60 秒后服务端因未收到业务回复而触发的重发
 *
 * 重要：key 必须带 accountId 前缀，避免多账号（多机器人）场景下，
 * 同一条群消息 @多个机器人时，不同机器人收到相同 msgId 导致误判为重复消息。
 *
 * @param accountId         - 当前账号 ID（用于命名空间隔离，防止多账号误判）
 * @param protocolMessageId - res.headers.messageId（WebSocket 协议层投递 ID）
 * @param businessMsgId     - data.msgId（钉钉业务层消息 ID，来自 JSON.parse(res.data).msgId）
 * @returns true 表示消息已处理过（应跳过），false 表示首次处理（已标记为已处理）
 */
export function checkAndMarkDingtalkMessage(
  accountId: string,
  protocolMessageId: string | undefined,
  businessMsgId: string | undefined,
): boolean {
  // 加 accountId 前缀，确保不同机器人账号的去重缓存互相隔离
  // 场景：群聊 @多个机器人时，钉钉推送给每个机器人的消息 msgId 相同，
  // 若不隔离，第二个机器人会被误判为重复消息而跳过处理。
  const scopedProtocolId = protocolMessageId ? `${accountId}:${protocolMessageId}` : undefined;
  const scopedBusinessId = businessMsgId ? `${accountId}:${businessMsgId}` : undefined;

  // 先完整检查两个 ID，再决定是否标记
  // 不能提前 return，否则命中去重的那条路径会漏掉对另一个 ID 的标记
  const isProtocolDuplicate = scopedProtocolId ? isMessageProcessed(scopedProtocolId) : false;
  const isBusinessDuplicate = scopedBusinessId ? isMessageProcessed(scopedBusinessId) : false;

  if (isProtocolDuplicate || isBusinessDuplicate) {
    return true;
  }

  // 首次处理：同时标记两个 ID，确保后续任意一个 ID 都能命中去重
  if (scopedProtocolId) markMessageProcessed(scopedProtocolId);
  if (scopedBusinessId) markMessageProcessed(scopedBusinessId);

  return false;
}

// ============ 配置工具 ============

/**
 * 获取钉钉配置
 */
export function getDingtalkConfig(cfg: any): DingtalkConfig {
  return (cfg?.channels as any)?.['dingtalk-connector'] || {};
}

/**
 * 检查是否已配置
 */
export function isDingtalkConfigured(cfg: any): boolean {
  const config = getDingtalkConfig(cfg);
  return Boolean(config.clientId && config.clientSecret);
}

/**
 * 构建媒体系统提示词
 */
export function buildMediaSystemPrompt(): string {
  return `## 钉钉图片和文件显示规则

你正在钉钉中与用户对话。

### 一、图片显示

显示图片时，直接使用本地文件路径，系统会自动上传处理。

**正确方式**：
\`\`\`markdown
![描述](file:///path/to/image.jpg)
![描述](/tmp/screenshot.png)
![描述](/Users/xxx/photo.jpg)
\`\`\`

**禁止**：
- 不要自己执行 curl 上传
- 不要猜测或构造 URL
- **不要对路径进行转义（如使用反斜杠 \\ ）**

直接输出本地路径即可，系统会自动上传到钉钉。

### 二、视频分享

**何时分享视频**：
- ✅ 用户明确要求**分享、发送、上传**视频时
- ❌ 仅生成视频保存到本地时，**不需要**分享

**视频标记格式**：
当需要分享视频时，在回复**末尾**添加：

\`\`\`
[DINGTALK_VIDEO]{"path":"<本地视频路径>"}[/DINGTALK_VIDEO]
\`\`\`

**支持格式**：mp4（最大 20MB）

**重要**：
- 视频大小不得超过 20MB，超过限制时告知用户
- 仅支持 mp4 格式
- 系统会自动提取视频时长、分辨率并生成封面

### 三、音频分享

**何时分享音频**：
- ✅ 用户明确要求**分享、发送、上传**音频/语音文件时
- ❌ 仅生成音频保存到本地时，**不需要**分享

**音频标记格式**：
当需要分享音频时，在回复**末尾**添加：

\`\`\`
[DINGTALK_AUDIO]{"path":"<本地音频路径>"}[/DINGTALK_AUDIO]
\`\`\`

**支持格式**：ogg、amr（最大 20MB）

**重要**：
- 音频大小不得超过 20MB，超过限制时告知用户
- 系统会自动提取音频时长

### 四、文件分享

**何时分享文件**：
- ✅ 用户明确要求**分享、发送、上传**文件时
- ❌ 仅生成文件保存到本地时，**不需要**分享

**文件标记格式**：
当需要分享文件时，在回复**末尾**添加：

\`\`\`
[DINGTALK_FILE]{"path":"<本地文件路径>","fileName":"<文件名>","fileType":"<扩展名>"}[/DINGTALK_FILE]
\`\`\`

**支持的文件类型**：几乎所有常见格式

**重要**：文件大小不得超过 20MB，超过限制时告知用户文件过大。`;
}

// ============ 消息表情回复 ============

/**
 * 在用户消息上贴 🤔思考中 表情，表示正在处理
 */
export async function addEmotionReply(config: DingtalkConfig, data: any, log?: any): Promise<void> {
  if (!data.msgId || !data.conversationId) return;
  try {
    const token = await getAccessToken(config);
    const { dingtalkHttp } = await import('./http-client.ts');
    await dingtalkHttp.post(`${DINGTALK_API}/v1.0/robot/emotion/reply`, {
      robotCode: data.robotCode ?? config.clientId,
      openMsgId: data.msgId,
      openConversationId: data.conversationId,
      emotionType: 2,
      emotionName: '🤔思考中',
      textEmotion: {
        emotionId: '2659900',
        emotionName: '🤔思考中',
        text: '🤔思考中',
        backgroundId: 'im_bg_1',
      },
    }, {
      headers: { 'x-acs-dingtalk-access-token': token, 'Content-Type': 'application/json' },
      timeout: 5_000,
    });
    log?.info?.(`[DingTalk][Emotion] 贴表情成功: msgId=${data.msgId}`);
  } catch (err: any) {
    log?.warn?.(`[DingTalk][Emotion] 贴表情失败（不影响主流程）: ${err.message}`);
  }
}

/**
 * 撤回用户消息上的 🤔思考中 表情
 */
export async function recallEmotionReply(config: DingtalkConfig, data: any, log?: any): Promise<void> {
  if (!data.msgId || !data.conversationId) return;
  try {
    const token = await getAccessToken(config);
    const { dingtalkHttp } = await import('./http-client.ts');
    await dingtalkHttp.post(`${DINGTALK_API}/v1.0/robot/emotion/recall`, {
      robotCode: data.robotCode ?? config.clientId,
      openMsgId: data.msgId,
      openConversationId: data.conversationId,
      emotionType: 2,
      emotionName: '🤔思考中',
      textEmotion: {
        emotionId: '2659900',
        emotionName: '🤔思考中',
        text: '🤔思考中',
        backgroundId: 'im_bg_1',
      },
    }, {
      headers: { 'x-acs-dingtalk-access-token': token, 'Content-Type': 'application/json' },
      timeout: 5_000,
    });
    log?.info?.(`[DingTalk][Emotion] 撤回表情成功: msgId=${data.msgId}`);
  } catch (err: any) {
    log?.warn?.(`[DingTalk][Emotion] 撤回表情失败（不影响主流程）: ${err.message}`);
  }
}

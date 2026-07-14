// 钉钉安装向导的配置操作 —— 纯函数（不碰 IO/process），便于单测。
// channelId 由调用方传入（= "dingtalk-connector"）。
//
// 配置结构（openclaw.json）：
//   channels.<id>.accounts.<accountId> = { enabled, name, clientId, clientSecret, cardTemplateId?, cardContentVar? }
//   bindings[] = { agentId, match: { channel, accountId } }
// 早期向导写过“扁平单机器人”结构（channels.<id>.clientId 直接挂在渠道上），这里会按需迁成 accounts 结构。

/** 列出现有非空的钉钉机器人账号（accounts 结构 + 兼容扁平结构）。返回 [{id, clientId, flat?}]。 */
export function dingtalkAccountSummaries(cfg, channelId) {
  const ch = cfg?.channels?.[channelId];
  const out = [];
  if (!ch || typeof ch !== "object") return out;
  const accounts = ch.accounts && typeof ch.accounts === "object" ? ch.accounts : {};
  for (const [id, a] of Object.entries(accounts)) {
    if (a && String(a.clientId || "").trim()) out.push({ id, clientId: String(a.clientId) });
  }
  if (String(ch.clientId || "").trim()) {
    out.push({ id: ch.name || deriveAccountIdBase(ch.clientId), clientId: String(ch.clientId), flat: true });
  }
  return out;
}

/** 确保插件条目启用。 */
export function ensurePluginEnabled(cfg, channelId) {
  cfg.plugins ??= {};
  cfg.plugins.entries ??= {};
  cfg.plugins.entries[channelId] ??= {};
  cfg.plugins.entries[channelId].enabled = true;
}

/**
 * 从 clientId 推导 accountId 基名（非固定 apibot）。
 * 例：dingxxxxABCDEF12 → bot-abcdef12
 */
export function deriveAccountIdBase(clientId) {
  const s = String(clientId || "").trim();
  const safe = s.replace(/[^a-zA-Z0-9]/g, "");
  if (safe.length >= 4) {
    return "bot-" + safe.slice(-8).toLowerCase();
  }
  return "dingbot";
}

function usedAccountIds(ch) {
  const used = new Set(Object.keys(ch.accounts || {}));
  if (ch.name) used.add(String(ch.name));
  return used;
}

/** 在渠道内生成不冲突的 accountId。 */
export function uniqueAccountId(ch, base) {
  const used = usedAccountIds(ch);
  const b = String(base || "dingbot").trim() || "dingbot";
  if (!used.has(b)) return b;
  let i = 2;
  while (used.has(`${b}-${i}`)) i++;
  return `${b}-${i}`;
}

/** 按 clientId 查找已有账号 id（同一应用重复安装时复用，不另开 apibot）。 */
export function findAccountIdByClientId(ch, clientId) {
  const want = String(clientId || "").trim();
  if (!want) return null;
  const accounts = ch?.accounts && typeof ch.accounts === "object" ? ch.accounts : {};
  for (const [id, a] of Object.entries(accounts)) {
    if (a && String(a.clientId || "").trim() === want) return id;
  }
  return null;
}

/** 把可选的卡片字段折进账号对象（只折用户实际提供的）。 */
function pickCardFields(input) {
  const out = {};
  if (input && typeof input.cardTemplateId === "string" && input.cardTemplateId.trim()) {
    out.cardTemplateId = input.cardTemplateId.trim();
  }
  if (input && typeof input.cardContentVar === "string" && input.cardContentVar.trim()) {
    out.cardContentVar = input.cardContentVar.trim();
  }
  return out;
}

/**
 * 维护 bindings：同一 channel + agentId 只保留一条，不重复 push。
 * - 已有完全相同 (channel, accountId, agentId) → 跳过
 * - 已有同 channel + agentId 但 accountId 不同 → 更新为新 accountId
 * - 否则新增
 * @returns {"exists"|"updated"|"added"}
 */
export function upsertDingTalkBinding(cfg, channelId, agentId, accountId) {
  const agent = String(agentId || "main").trim() || "main";
  const acc = String(accountId || "").trim();
  if (!acc) throw new Error("upsertDingTalkBinding: accountId required");
  cfg.bindings = Array.isArray(cfg.bindings) ? cfg.bindings : [];

  const exact = cfg.bindings.find(
    (b) =>
      String(b?.match?.channel) === channelId &&
      String(b?.match?.accountId) === acc &&
      String(b?.agentId || "main") === agent,
  );
  if (exact) return "exists";

  const byAgent = cfg.bindings.find(
    (b) => String(b?.match?.channel) === channelId && String(b?.agentId || "main") === agent,
  );
  if (byAgent) {
    byAgent.agentId = agent;
    byAgent.match = { ...(byAgent.match || {}), channel: channelId, accountId: acc };
    return "updated";
  }

  cfg.bindings.push({ agentId: agent, match: { channel: channelId, accountId: acc } });
  return "added";
}

/** 把旧的“扁平单机器人”结构迁成 accounts 结构（保留凭证，并给它补一条 binding 默认 main，避免新增后路由丢失）。 */
export function migrateFlatToAccounts(cfg, channelId) {
  const ch = cfg?.channels?.[channelId];
  if (!ch) return;
  ch.accounts ??= {};
  if (String(ch.clientId || "").trim()) {
    const id = ch.name || deriveAccountIdBase(ch.clientId);
    ch.accounts[id] ??= {
      enabled: true,
      name: id,
      clientId: ch.clientId,
      clientSecret: ch.clientSecret,
      ...(ch.cardTemplateId ? { cardTemplateId: ch.cardTemplateId } : {}),
      ...(ch.cardContentVar ? { cardContentVar: ch.cardContentVar } : {}),
    };
    // 仅当本渠道尚无任何 binding 时补默认 main，避免与已有 agent 绑定重复
    cfg.bindings ??= [];
    const hasChannelBinding = cfg.bindings.some((b) => String(b?.match?.channel) === channelId);
    if (!hasChannelBinding) {
      upsertDingTalkBinding(cfg, channelId, "main", id);
    }
    delete ch.clientId;
    delete ch.clientSecret;
    delete ch.cardTemplateId;
    delete ch.cardContentVar;
  }
}

/**
 * 新增或更新机器人账号。
 * - 同一 clientId 已存在 → 复用其 accountId，只更新凭证/卡片字段
 * - 否则 accountId = bot-<clientId 后缀>，冲突则 -2/-3…
 * - bindings：同 channel+agentId 不重复，已有则更新 accountId
 * @returns 使用的 accountId
 */
export function addBotAccount(cfg, channelId, { clientId, clientSecret, agentId, cardTemplateId, cardContentVar }) {
  cfg.channels ??= {};
  cfg.channels[channelId] ??= {};
  const ch = cfg.channels[channelId];
  ch.enabled = true;
  migrateFlatToAccounts(cfg, channelId);
  ch.accounts ??= {};

  const existingId = findAccountIdByClientId(ch, clientId);
  const id = existingId || uniqueAccountId(ch, deriveAccountIdBase(clientId));
  const prev = ch.accounts[id] && typeof ch.accounts[id] === "object" ? ch.accounts[id] : {};
  ch.accounts[id] = {
    ...prev,
    enabled: true,
    name: id,
    clientId,
    clientSecret,
    ...pickCardFields({ cardTemplateId, cardContentVar }),
  };

  upsertDingTalkBinding(cfg, channelId, agentId || "main", id);
  ensurePluginEnabled(cfg, channelId);
  return id;
}

/**
 * 覆盖：钉钉渠道重置为单个机器人 + 单条 binding（清掉本渠道其它账号/绑定，其它渠道 binding 保留）。
 * accountId 由 clientId 推导，不再写死 apibot。
 */
export function overwriteWithSingleBot(cfg, channelId, { clientId, clientSecret, agentId, cardTemplateId, cardContentVar }) {
  const id = deriveAccountIdBase(clientId);
  cfg.channels ??= {};
  cfg.channels[channelId] = {
    enabled: true,
    accounts: {
      [id]: {
        enabled: true,
        name: id,
        clientId,
        clientSecret,
        ...pickCardFields({ cardTemplateId, cardContentVar }),
      },
    },
  };
  const others = (Array.isArray(cfg.bindings) ? cfg.bindings : []).filter(
    (b) => String(b?.match?.channel) !== channelId,
  );
  cfg.bindings = [
    ...others,
    { agentId: agentId || "main", match: { channel: channelId, accountId: id } },
  ];
  ensurePluginEnabled(cfg, channelId);
  return id;
}

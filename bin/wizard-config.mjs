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
    out.push({ id: ch.name || "apibot", clientId: String(ch.clientId), flat: true });
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

function uniqueAccountId(ch, base = "apibot") {
  const used = new Set(Object.keys(ch.accounts || {}));
  if (ch.name) used.add(ch.name);
  if (!used.has(base)) return base;
  let i = 2;
  while (used.has(base + i)) i++;
  return base + i;
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

/** 把旧的“扁平单机器人”结构迁成 accounts 结构（保留凭证，并给它补一条 binding 默认 main，避免新增后路由丢失）。 */
export function migrateFlatToAccounts(cfg, channelId) {
  const ch = cfg?.channels?.[channelId];
  if (!ch) return;
  ch.accounts ??= {};
  if (String(ch.clientId || "").trim()) {
    const id = ch.name || "apibot";
    ch.accounts[id] ??= {
      enabled: true,
      name: id,
      clientId: ch.clientId,
      clientSecret: ch.clientSecret,
      ...(ch.cardTemplateId ? { cardTemplateId: ch.cardTemplateId } : {}),
      ...(ch.cardContentVar ? { cardContentVar: ch.cardContentVar } : {}),
    };
    cfg.bindings ??= [];
    const bound = cfg.bindings.some((b) => String(b?.match?.channel) === channelId);
    if (!bound) cfg.bindings.push({ agentId: "main", match: { channel: channelId, accountId: id } });
    delete ch.clientId;
    delete ch.clientSecret;
    delete ch.cardTemplateId;
    delete ch.cardContentVar;
  }
}

/** 新增一个机器人账号（不动现有账号），自动补一条 binding 到指定 agent。返回新账号 id。
 *  cardTemplateId/cardContentVar 可选——提供则写入账号块（增强版 AI Card）。 */
export function addBotAccount(cfg, channelId, { clientId, clientSecret, agentId, cardTemplateId, cardContentVar }) {
  cfg.channels ??= {};
  cfg.channels[channelId] ??= {};
  const ch = cfg.channels[channelId];
  ch.enabled = true;
  migrateFlatToAccounts(cfg, channelId);
  ch.accounts ??= {};
  const id = uniqueAccountId(ch);
  ch.accounts[id] = { enabled: true, name: id, clientId, clientSecret, ...pickCardFields({ cardTemplateId, cardContentVar }) };
  cfg.bindings ??= [];
  cfg.bindings.push({ agentId: agentId || "main", match: { channel: channelId, accountId: id } });
  ensurePluginEnabled(cfg, channelId);
  return id;
}

/** 覆盖：把钉钉渠道重置为单个机器人 + 单条 binding（清掉本渠道其它账号/绑定，其它渠道的 binding 保留）。
 *  cardTemplateId/cardContentVar 可选。 */
export function overwriteWithSingleBot(cfg, channelId, { clientId, clientSecret, agentId, cardTemplateId, cardContentVar }) {
  cfg.channels ??= {};
  cfg.channels[channelId] = {
    enabled: true,
    accounts: {
      apibot: { enabled: true, name: "apibot", clientId, clientSecret, ...pickCardFields({ cardTemplateId, cardContentVar }) },
    },
  };
  const others = (Array.isArray(cfg.bindings) ? cfg.bindings : []).filter(
    (b) => String(b?.match?.channel) !== channelId,
  );
  cfg.bindings = [...others, { agentId: agentId || "main", match: { channel: channelId, accountId: "apibot" } }];
  ensurePluginEnabled(cfg, channelId);
}

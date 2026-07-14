// 安装向导配置操作自检。跑法：node tests/wizard-config.test.mjs
import { strict as assert } from "node:assert";
import {
  dingtalkAccountSummaries,
  addBotAccount,
  overwriteWithSingleBot,
  migrateFlatToAccounts,
  deriveAccountIdBase,
  upsertDingTalkBinding,
  findAccountIdByClientId,
} from "../bin/wizard-config.mjs";

const CH = "dingtalk-connector";

// deriveAccountIdBase：不固定 apibot
{
  assert.equal(deriveAccountIdBase("dingABCDEF12"), "bot-abcdef12");
  assert.equal(deriveAccountIdBase("1234567890abcdef"), "bot-90abcdef");
  assert.ok(deriveAccountIdBase("ab").startsWith("ding") || deriveAccountIdBase("ab") === "dingbot");
}

// 检测：accounts 结构
{
  const cfg = { channels: { [CH]: { accounts: { "bot-abc": { clientId: "id1" } } } } };
  const s = dingtalkAccountSummaries(cfg, CH);
  assert.equal(s.length, 1);
  assert.equal(s[0].id, "bot-abc");
}
// 检测：扁平结构
{
  const cfg = { channels: { [CH]: { clientId: "idflat", name: "bot" } } };
  const s = dingtalkAccountSummaries(cfg, CH);
  assert.equal(s.length, 1);
  assert.equal(s[0].flat, true);
}
// 检测：空
assert.equal(dingtalkAccountSummaries({}, CH).length, 0);
assert.equal(dingtalkAccountSummaries({ channels: { [CH]: { accounts: { x: {} } } } }, CH).length, 0);

// 新增账号：accountId 来自 clientId，不动现有，加 binding
{
  const cfg = {
    channels: {
      [CH]: {
        enabled: true,
        accounts: { "bot-oldold01": { enabled: true, name: "bot-oldold01", clientId: "id1", clientSecret: "s1" } },
      },
    },
    bindings: [{ agentId: "main", match: { channel: CH, accountId: "bot-oldold01" } }],
  };
  const newId = addBotAccount(cfg, CH, { clientId: "suiteXXXXNEWSALE", clientSecret: "s2", agentId: "sales" });
  assert.equal(newId, "bot-" + "suiteXXXXNEWSALE".slice(-8).toLowerCase());
  assert.ok(cfg.channels[CH].accounts["bot-oldold01"]);
  assert.equal(cfg.channels[CH].accounts[newId].clientId, "suiteXXXXNEWSALE");
  assert.equal(cfg.bindings.length, 2);
  assert.deepEqual(cfg.bindings[1], {
    agentId: "sales",
    match: { channel: CH, accountId: newId },
  });
}

// 同一 agentId 已绑定：不再 push 重复 binding，只更新 accountId
{
  const cfg = {
    channels: {
      [CH]: {
        enabled: true,
        accounts: { "bot-aaaa1111": { clientId: "oldapp", clientSecret: "s1" } },
      },
    },
    bindings: [{ agentId: "main", match: { channel: CH, accountId: "bot-aaaa1111" } }],
  };
  const newId = addBotAccount(cfg, CH, { clientId: "newappZZZZ9999", clientSecret: "s2", agentId: "main" });
  assert.equal(newId, "bot-" + "newappZZZZ9999".slice(-8).toLowerCase());
  // 仍只有 1 条 dingtalk main binding
  const dingMain = cfg.bindings.filter(
    (b) => b.match.channel === CH && (b.agentId || "main") === "main",
  );
  assert.equal(dingMain.length, 1);
  assert.equal(dingMain[0].match.accountId, newId);
}

// 同一 clientId 再装：复用 accountId，不新增账号
{
  const cfg = {
    channels: {
      [CH]: {
        accounts: { "bot-fixedid": { clientId: "sameClient99", clientSecret: "old" } },
      },
    },
    bindings: [{ agentId: "main", match: { channel: CH, accountId: "bot-fixedid" } }],
  };
  const id = addBotAccount(cfg, CH, { clientId: "sameClient99", clientSecret: "newsec", agentId: "main" });
  assert.equal(id, "bot-fixedid");
  assert.equal(Object.keys(cfg.channels[CH].accounts).length, 1);
  assert.equal(cfg.channels[CH].accounts["bot-fixedid"].clientSecret, "newsec");
  assert.equal(cfg.bindings.filter((b) => b.match.channel === CH).length, 1);
}

// 扁平 + 新增：自动迁移；同 agent main 不重复 binding
{
  const cfg = { channels: { [CH]: { enabled: true, name: "legacy", clientId: "idflat", clientSecret: "sflat" } } };
  const newId = addBotAccount(cfg, CH, { clientId: "id2ABCDEF", clientSecret: "s2", agentId: "main" });
  assert.equal(cfg.channels[CH].clientId, undefined);
  assert.equal(cfg.channels[CH].accounts.legacy.clientId, "idflat");
  assert.ok(cfg.channels[CH].accounts[newId]);
  // migrate 若无 binding 会补 main→legacy，随后 add 同 agent 会 update 到 newId，仍 1 条
  const dingBindings = cfg.bindings.filter((b) => b.match.channel === CH);
  assert.equal(dingBindings.length, 1);
  assert.equal(dingBindings[0].match.accountId, newId);
}

// 覆盖：accountId 由 clientId 推导，他渠道 binding 保留
{
  const cfg = {
    channels: { [CH]: { accounts: { a: { clientId: "x" }, b: { clientId: "y" } } } },
    bindings: [
      { agentId: "m1", match: { channel: CH, accountId: "a" } },
      { agentId: "m2", match: { channel: "telegram", accountId: "t" } },
    ],
  };
  const id = overwriteWithSingleBot(cfg, CH, { clientId: "brandNEW99", clientSecret: "ns", agentId: "main" });
  assert.equal(id, "bot-" + "brandNEW99".slice(-8).toLowerCase());
  assert.deepEqual(Object.keys(cfg.channels[CH].accounts), [id]);
  assert.equal(cfg.channels[CH].accounts[id].clientId, "brandNEW99");
  assert.equal(cfg.bindings.filter((b) => b.match.channel === CH).length, 1);
  assert.ok(cfg.bindings.some((b) => b.match.channel === "telegram"));
}

// upsertDingTalkBinding 去重
{
  const cfg = { bindings: [] };
  assert.equal(upsertDingTalkBinding(cfg, CH, "main", "bot-a"), "added");
  assert.equal(upsertDingTalkBinding(cfg, CH, "main", "bot-a"), "exists");
  assert.equal(upsertDingTalkBinding(cfg, CH, "main", "bot-b"), "updated");
  assert.equal(cfg.bindings.length, 1);
  assert.equal(cfg.bindings[0].match.accountId, "bot-b");
}

// 迁移幂等
{
  const cfg = {
    channels: { [CH]: { accounts: { apibot: { clientId: "x" } } } },
    bindings: [{ agentId: "main", match: { channel: CH, accountId: "apibot" } }],
  };
  migrateFlatToAccounts(cfg, CH);
  assert.equal(cfg.bindings.length, 1);
}

console.log("✅ wizard-config 自检通过");

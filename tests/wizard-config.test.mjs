// 安装向导配置操作自检。跑法：node tests/wizard-config.test.mjs
import { strict as assert } from "node:assert";
import {
  dingtalkAccountSummaries,
  addBotAccount,
  overwriteWithSingleBot,
  migrateFlatToAccounts,
} from "../bin/wizard-config.mjs";

const CH = "dingtalk-connector";

// 检测：accounts 结构
{
  const cfg = { channels: { [CH]: { accounts: { apibot: { clientId: "id1" } } } } };
  const s = dingtalkAccountSummaries(cfg, CH);
  assert.equal(s.length, 1);
  assert.equal(s[0].id, "apibot");
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

// 新增账号：不动现有，加 binding
{
  const cfg = {
    channels: { [CH]: { enabled: true, accounts: { apibot: { enabled: true, name: "apibot", clientId: "id1", clientSecret: "s1" } } } },
    bindings: [{ agentId: "main", match: { channel: CH, accountId: "apibot" } }],
  };
  const newId = addBotAccount(cfg, CH, { clientId: "id2", clientSecret: "s2", agentId: "sales" });
  assert.equal(newId, "apibot2");                                   // 自动避重名
  assert.ok(cfg.channels[CH].accounts.apibot);                      // 原账号还在
  assert.equal(cfg.channels[CH].accounts.apibot2.clientId, "id2");
  assert.equal(cfg.bindings.length, 2);                            // 原 binding 保留 + 新增
  assert.deepEqual(cfg.bindings[1], { agentId: "sales", match: { channel: CH, accountId: "apibot2" } });
}

// 扁平 + 新增：自动迁移成 accounts 并给旧账号补 binding
{
  const cfg = { channels: { [CH]: { enabled: true, name: "apibot", clientId: "idflat", clientSecret: "sflat" } } };
  const newId = addBotAccount(cfg, CH, { clientId: "id2", clientSecret: "s2", agentId: "main" });
  assert.equal(cfg.channels[CH].clientId, undefined);              // 扁平字段已清
  assert.equal(cfg.channels[CH].accounts.apibot.clientId, "idflat"); // 旧账号迁入 accounts
  assert.ok(cfg.channels[CH].accounts[newId]);                     // 新账号
  // 旧账号补了 binding + 新账号 binding = 2 条
  assert.equal(cfg.bindings.filter((b) => b.match.channel === CH).length, 2);
}

// 覆盖：只保留这一个，本渠道其它绑定清掉，他渠道绑定保留
{
  const cfg = {
    channels: { [CH]: { accounts: { a: { clientId: "x" }, b: { clientId: "y" } } } },
    bindings: [
      { agentId: "m1", match: { channel: CH, accountId: "a" } },
      { agentId: "m2", match: { channel: "telegram", accountId: "t" } },
    ],
  };
  overwriteWithSingleBot(cfg, CH, { clientId: "new", clientSecret: "ns", agentId: "main" });
  assert.deepEqual(Object.keys(cfg.channels[CH].accounts), ["apibot"]);
  assert.equal(cfg.channels[CH].accounts.apibot.clientId, "new");
  assert.equal(cfg.bindings.filter((b) => b.match.channel === CH).length, 1);
  assert.ok(cfg.bindings.some((b) => b.match.channel === "telegram")); // 他渠道保留
}

// 迁移幂等：已是 accounts 结构再迁不报错、不变
{
  const cfg = { channels: { [CH]: { accounts: { apibot: { clientId: "x" } } } }, bindings: [{ agentId: "main", match: { channel: CH, accountId: "apibot" } }] };
  migrateFlatToAccounts(cfg, CH);
  assert.equal(cfg.bindings.length, 1);
}

console.log("✅ wizard-config 自检通过");

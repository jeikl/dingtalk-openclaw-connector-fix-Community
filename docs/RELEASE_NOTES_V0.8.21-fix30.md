# Release Notes — v0.8.21-fix30（2026-07-14）

生产稳定版 / Production-stable community build of `@jeik/dingtalk-connector`.

## 安装 / Install

```bash
# 推荐：fix 通道（指向 0.8.21-fix30）
openclaw plugins install @jeik/dingtalk-connector@fix --force
openclaw gateway restart

# 或钉死版本
openclaw plugins install @jeik/dingtalk-connector@0.8.21-fix30 --force
openclaw gateway restart

# 一键扫码
npx -y @jeik/dingtalk-connector@fix install
```

本地 tgz：

```bash
npm install && npm run build && npm pack
openclaw plugins install ./jeik-dingtalk-connector-0.8.21-fix30.tgz --force
openclaw gateway restart
```

## 本版要点 / Highlights

| 领域 | 说明 |
|------|------|
| 流式过程 | 串行队列 + 尾随合并；允许后盖前；每枪完整快照；防半截/乱序 |
| 终态 | flush + FINISHED 前 stream 全量覆盖；`pickFinalText` 取更长文本 |
| 双卡 | **保留** `answerActToken`：短单卡 / 长答案卡 + 原卡思考完成 |
| 错误 | OpenClaw 对齐中文映射；分发「无可用通道」不再误报负载过高 |
| 首响 | `🦸 正在召唤大模型…` |
| 纯工具打头 | `🤖 大模型已收到需求` + `🔧 正在调用：name` |
| 安装向导 | accountId=`bot-<clientId后缀>`（非 apibot）；同 agent 不重复 bindings |
| 配置清理 | **已删除** `cardToolVar` / `cardProcessVar`（统一 `cardContentVar`） |

## 升级注意 / Upgrade notes

- 必须 **重启 gateway** 后新 dist 才生效。
- 与官方同 channel id，`--force` 覆盖即可，无需卸载。
- OpenClaw ≥ **2026.4.9**。
- 若配置里仍有 `cardToolVar`/`cardProcessVar`，可手动删掉，已忽略不再使用。

## 文档

- 中文：`README.md` / `FIXES.md` / `CHANGELOG.md`
- English：`README.en.md` / `FIXES.en.md` / `CHANGELOG.md`（双语段落）

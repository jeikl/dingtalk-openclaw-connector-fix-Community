# Bug 修复日志

本文件记录社区维护版相对于官方版本的所有修复内容。

---

## v0.8.20-fix1（2026-05-11）

基于官方 `v0.8.20` 拉取。

### 修复：群聊 @Agent 回复显示"✅ 任务执行完成（无文本输出）"

**问题描述**

在钉钉群聊中 @Agent 发送消息后，网关面板显示 AI 已正常生成回复，但群聊内 AI Card 最终展示的是"✅ 任务执行完成（无文本输出）"，而非实际回复内容。私聊场景不受影响。

**根因**

OpenClaw 对群聊默认使用 `sourceReplyDeliveryMode = "message_tool_only"` 交付模式（见 OpenClaw 源码 `source-reply-delivery-mode.ts`）。在该模式下：

- `suppressAutomaticSourceDelivery = true`
- `onPartialReply` 回调被 `wrapProgressCallback` 静默拦截，不再传递给钉钉连接器
- AI Card 流式更新收不到任何文本，`accumulatedText` 始终为空
- `onIdle` 触发 → `closeStreaming()` → 兜底文案"任务执行完成（无文本输出）"

同时，AI 实际回复通过 `message` 工具走 `outbound.sendText` 另行发出，与 AI Card 流式通道完全脱节。

**修复方案**

在 `src/core/message-handler.ts` 的 `dispatchReplyFromConfig` 调用中，通过 `replyOptions` 强制指定 `sourceReplyDeliveryMode: "automatic"`，使群聊与私聊保持一致的直接流式交付行为，绕过 OpenClaw 对群聊的 `message_tool_only` 默认值。

**修复文件**

- `src/core/message-handler.ts`（`dispatchReplyFromConfig` 调用处）

---

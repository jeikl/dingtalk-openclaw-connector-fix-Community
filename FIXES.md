# Bug 修复日志

本文件记录社区维护版相对于官方版本的所有修复内容。
**[🇺🇸 English](FIXES.en.md)**

---

## v0.8.20-fix4（2026-05-14）

### ✨ Markdown 图片发送支持直链和本地路径，无需下载到本地

**来源**

来自 [PR #561](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/pull/561)（[新之助](https://github.com/spike-zwj) 提交）。

**功能说明**

- Markdown 语法 `![图片注释](直链URL)` 或 `![图片注释](本地路径)` 直接发送图片
- 兼容 mediaId 格式
- 直链图片或本地路径文件均可直接嵌入 markdown 发送，无需下载到本地
- 如本地路径含空格，先重命名去除空格再发送

**使用方式**

需使用提示词引导 Agent 创建图片发送 skill：

```
请你把以下发送图片的方式写成你的钉钉图片发送skill，当涉及到图片发送，则调用该技能：用markdown语法发送图片，支持添加图片注释实现图文并茂；直链图片或本地路径文件均可直接嵌入markdown发送，如本地路径含空格请先重命名去除空格再发送。
```

---

## v0.8.20-fix3（2026-05-11）

基于官方 `v0.8.20` 拉取。

### 🔧 修复 Agent 多轮循环完成后，中间过程消息重复发送到钉钉对话，造成刷屏和 AI Card 倒放重渲染

**问题描述**

在钉钉群聊中 @Agent 执行多轮 Agent 循环（每轮含工具调用）时，网关生成完整回复后，钉钉群聊中仍会一次性涌出多条消息气泡；AI Card 也会在最终回复展示完成后，快速从第一轮逐条覆盖内容到最后，然后再"假流式"重头生成一遍已完成的最终内容。

**根因**

OpenClaw Agent 循环每轮均向 sendChain 队列追加 `deliver` 调用。由于 AI 生成速度远快于 sendChain 的交付速度（block 消息带 humanDelay），所有轮次的 `onPartialReply` 流式回调先于任何 `deliver` 完成执行，AI Card 已正确展示最终回复。随后 sendChain 顺序处理各 `deliver`，触发多个问题：

1. **`deliver(kind="block")` 覆盖流式内容**：block 消息带 humanDelay 延迟交付，当 humanDelay 到期时，若 `onPartialReply` 已开始流式传输最终回复，`streamAICard()` 会用 block 的旧文本整体替换正在流式中的最终回复内容，导致 AI Card 回退到"搜索中...""找到资源..."等旧状态。

2. **多轮 `deliver(kind="final")` 逐次覆盖卡片**：每轮 final 均向 DingTalk 发送该轮文本，将卡片内容覆盖为各轮旧文本（第 1 轮 → 第 2 轮 → … → 末轮），形成"倒放"效果。

3. **`startStreaming` 在卡片关闭后重新建卡**：block 消息因 humanDelay 延迟在 `closeStreaming()` 之后才到达时，`startStreaming()` 因 `currentCardTarget === null` 重新创建新 AI Card，产生多余卡片。

4. **`preCreatedCard` 路径未注册全局表**：预创建卡片时未调用 `registerActiveCard`，导致 `outbound.sendText` 拦截器无法感知活跃卡片，后续拦截失效，多余消息绕过卡片直接发送到群聊。

5. **`finishAICard` 触发假流式**：`closeStreaming()` → `finishAICard()` 内部再次调用 `streamAICard(isFinalize=true)` 将完整文本写入，DingTalk 对此触发打字动画，在视觉上表现为"重头假流式生成"。

**修复方案**

1. **建立全局活跃 AI Card 注册表**（`_activeCardRegistry`）：卡片创建时 `registerActiveCard` 注册，关闭时 `unregisterActiveCard` 注销。`outbound.sendText` 检查注册表，若目标群聊有活跃卡片则静默丢弃，不发送独立气泡。

2. **新增 `sessionClosed` 标志**：`closeStreaming()` 置 `true`，`startStreaming()` 检测到后跳过，不再重复建卡。

3. **`deliver(kind="block")` 增加 `accumulatedText` 守卫**：若 `onPartialReply` 已开始流式传输最终回复（`accumulatedText` 非空），跳过 block 的卡片更新，避免旧状态覆盖新内容。

4. **`deliver(kind="final")` 完全不触碰 AI Card**：流式模式下仅更新 `accumulatedText`，不调用任何卡片 API。卡片内容的唯一更新路径为 `onPartialReply`（实时流式），`onIdle` 是唯一调用 `closeStreaming()` 的地方。

5. **`preCreatedCard` 路径补全 `registerActiveCard`**。

**卡片内容更新路径（修复后）**
1. `onPartialReply` → 每个 LLM token 到达时实时流式更新卡片（所有轮次均通过此路径）
2. `deliver(kind="block")` → 若最终回复已开始流式则跳过，否则更新卡片状态
3. `deliver(kind="final")` → 静默更新 `accumulatedText`，不写卡片
4. `onIdle` → `closeStreaming()` → `finishAICard()` → 以最终 `accumulatedText`（含媒体处理）一次性关闭卡片

**修复文件**

- `src/services/messaging/card.ts`（新增 `_activeCardRegistry` 注册表及增删查函数）
- `src/reply-dispatcher.ts`（`sessionClosed` 标志；`closeStreaming` 置标志；`startStreaming` 守卫；`preCreatedCard` 注册；`deliver(kind="block")` 守卫；`deliver(kind="final")` 改为仅更新 `accumulatedText`）
- `src/channel.ts`（`outbound.sendText` 检查注册表并静默丢弃）

---

## v0.8.20-fix2（2026-05-11）

基于官方 `v0.8.20` 拉取。

### 🐛 修复 OpenClaw 4.29+ 版本导致钉钉插件失效，群聊 @Agent 回复显示"✅ 任务执行完成（无文本输出）"

**问题描述**

在钉钉群聊中 @Agent 发送消息后，网关面板显示 AI 已正常生成回复，但群聊内 AI Card 最终展示的是"✅ 任务执行完成（无文本输出）"，而非实际回复内容。私聊场景不受影响。

**根因**

OpenClaw 对群聊默认使用 `sourceReplyDeliveryMode = "message_tool_only"` 交付模式。在该模式下 `suppressAutomaticSourceDelivery = true`，`onPartialReply` 回调被静默拦截，AI Card 流式更新收不到任何文本，`accumulatedText` 始终为空，`onIdle` 触发后兜底显示"任务执行完成（无文本输出）"。

**修复方案**

在 `src/core/message-handler.ts` 的 `dispatchReplyFromConfig` 调用中，通过 `replyOptions` 强制指定 `sourceReplyDeliveryMode: "automatic"`，使群聊与私聊保持一致的直接流式交付行为。

**修复文件**

- `src/core/message-handler.ts`

---

## v0.8.20-fix1（2026-05-08）

基于官方 `v0.8.20` 拉取。来源于 [PR #566](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/pull/566) `fix/websocket-phantom-reconnect`，由 [Majorshi](https://github.com/Majorshi) 提交。

### 🌐 修复未注册的 Pong 监听器导致的 WebSocket 幻影重连

**问题描述**

配置钉钉机器人固定 30 秒持续出现 'disconnected` ，并不断重连/断开循环。

日志特征：
```
connect success
Disconnecting.
[约30秒后]
connect success
```

**根因**

WebSocket 事件监听器（pong/message/close）在 `client.connect()` 之前注册，但此时 `client.socket` 尚未创建，导致监听器从未被添加到套接字上。`keepAlive` 定时器每 10 秒发送 ping，但由于 pong 监听器未生效，`lastSocketAvailableTime` 不更新，20 秒后触发重连。`doReconnect()` 成功后也未重新注册 listener，新 socket 同样没有 listener，形成无限循环。

**修复方案**

1. 删除 `connect()` 前的无效 listener 注册
2. 在 `client.connect()` 成功后注册 listener（此时 socket 已创建）
3. 在 `doReconnect()` 成功后重新注册 listener（新 socket 需要新的 listener）

**影响**

- 消除每 30 秒的幽灵重连
- 减少消息丢失窗口
- 减少不必要的 TLS 握手和钉钉 Stream 协议握手开销

**修复文件**

- `src/core/connection.ts`

---
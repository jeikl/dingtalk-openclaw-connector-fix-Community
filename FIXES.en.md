# Bug Fix Log

This file documents all bug fixes in the community maintained version relative to the official release.

---

## v0.8.20-fix3（2026-05-11）

Based on `v0.8.20-fix2`.

### 🔧 Fix AI Card Flashing and Repeated Re-rendering Caused by Duplicate Intermediate Messages

**Problem**

When @Agent is used in a DingTalk group with a multi-round Agent loop (each round includes tool calls), after the gateway completes its response, multiple message bubbles still burst into the group. Additionally, after the AI Card finishes displaying the final response, it rapidly rewinds through each round's content and then re-displays the completed response with a fake streaming animation.

**Root Cause**

OpenClaw's Agent loop appends one `deliver` call to the sendChain for each round. Since AI generation is much faster than sendChain delivery (block messages have humanDelay), all rounds' `onPartialReply` streaming callbacks finish before any `deliver` is processed — the AI Card correctly displays the final response. Then the sendChain sequentially processes each `deliver`, triggering multiple issues:

1. **`deliver(kind="block")` overwrites streaming content**: Block messages are delivered with humanDelay delay. When the delay expires, if `onPartialReply` has already started streaming the final response, `streamAICard()` overwrites the card with the old block text, causing the AI Card to regress to old states like "Searching..." "Found resources...".

2. **Multiple `deliver(kind="final")` calls overwrite the card sequentially**: Each round's final sends text to DingTalk, overwriting the card content with each round's old text (Round 1 → Round 2 → ... → Final), creating a "rewind" visual effect.

3. **`startStreaming` recreates cards after close**: When a block message is delayed past `closeStreaming()` due to humanDelay, `startStreaming()` creates a new AI Card because `currentCardTarget === null`, producing extra cards.

4. **`preCreatedCard` path not registered in global registry**: When using a pre-created AI Card, `registerActiveCard` was not called, causing the `outbound.sendText` interceptor to be unaware of the active card, allowing extra messages to bypass the card and send directly to the group.

5. **`finishAICard` triggers fake streaming**: `closeStreaming()` → `finishAICard()` internally calls `streamAICard(isFinalize=true)` again, which DingTalk interprets as typing animation, appearing as a "rewind and regenerate" fake streaming effect.

**Fix**

1. **Global active AI Card registry** (`_activeCardRegistry`): Register with `registerActiveCard` on creation, unregister with `unregisterActiveCard` on close. `outbound.sendText` checks the registry and silently drops messages if an active card exists for the target group.

2. **`sessionClosed` flag**: `closeStreaming()` sets `true`, `startStreaming()` skips card creation when this is set.

3. **`deliver(kind="block")` `accumulatedText` guard**: If `onPartialReply` has started streaming the final response (`accumulatedText` non-empty), skip the block's card update to prevent old content from overwriting new.

4. **`deliver(kind="final")` does not touch AI Card**: In streaming mode, only updates `accumulatedText`, calls no card APIs. Card content updates only through `onPartialReply` (real-time streaming); `onIdle` is the only place that calls `closeStreaming()`.

5. **`preCreatedCard` path registers with `registerActiveCard`**.

**Card Content Update Flow (after fix)**
1. `onPartialReply` → Real-time streaming update on each LLM token (all rounds go through this path)
2. `deliver(kind="block")` → Skip if final response is already streaming; otherwise update card state
3. `deliver(kind="final")` → Silently update `accumulatedText`, do not write to card
4. `onIdle` → `closeStreaming()` → `finishAICard()` → Close card with final `accumulatedText` (media-processed)

**Files Modified**

- `src/services/messaging/card.ts` (new `_activeCardRegistry` registry and add/remove/query functions)
- `src/reply-dispatcher.ts` (`sessionClosed` flag; `closeStreaming` sets flag; `startStreaming` guard; `preCreatedCard` registration; `deliver(kind="block")` guard; `deliver(kind="final")` changed to only update `accumulatedText`)
- `src/channel.ts` (`outbound.sendText` checks registry and silently drops)

---

## v0.8.20-fix2（2026-05-11）

Based on `v0.8.20-fix1`.

### 🐛 Fix OpenClaw 4.29+ Causing DingTalk Plugin to Show "✅ 任务执行完成（无文本输出）"

**Problem**

After @Agent in a DingTalk group chat, the gateway panel shows AI has correctly generated a response, but the AI Card in the group displays "✅ 任务执行完成（无文本输出）" instead of the actual reply content. Private chat is unaffected.

**Root Cause**

OpenClaw uses `sourceReplyDeliveryMode = "message_tool_only"` for group chats by default. In this mode `suppressAutomaticSourceDelivery = true`, `onPartialReply` callbacks are silently blocked, AI Card streaming receives no text, `accumulatedText` stays empty, and `onIdle` triggers the fallback message "任务执行完成（无文本输出）".

**Fix**

In `src/core/message-handler.ts`, at the `dispatchReplyFromConfig` call, force `sourceReplyDeliveryMode: "automatic"` via `replyOptions`, aligning group and private chat behavior for direct streaming delivery.

**Files Modified**

- `src/core/message-handler.ts`

---

## v0.8.20-fix1（2026-05-08）

Based on official `v0.8.20`. Sourced from [PR #566](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/pull/566) `fix/websocket-phantom-reconnect` by [Majorshi](https://github.com/Majorshi).

### 🌐 Fix WebSocket Phantom Reconnect Caused by Unregistered Pong Listener

**Problem**

DingTalk bot accounts experience continuous disconnect/reconnect cycles every ~30 seconds, with errors like `连接建立超时或失败`.

Log pattern:
```
connect success
Disconnecting.
[~30 seconds later]
connect success
```

**Root Cause**

WebSocket event listeners (pong/message/close) were registered before `client.connect()`, but `client.socket` had not been created yet — so the listeners were never attached to the socket. The `keepAlive` timer sends ping every 10 seconds, but since the pong listener never fires, `lastSocketAvailableTime` never updates. After 20 seconds, a reconnect is triggered. `doReconnect()` also never re-registers listeners after success, so the new socket also has no listeners — creating an infinite loop.

**Fix**

1. Remove invalid listener registration before `connect()`
2. Register listeners after `client.connect()` succeeds (socket is created at this point)
3. Re-register listeners after `doReconnect()` succeeds (new socket needs new listeners)

**Impact**

- Eliminates the ~30-second phantom reconnect loop
- Reduces message loss window
- Reduces unnecessary TLS handshakes and DingTalk Stream protocol handshake overhead

**Files Modified**

- `src/core/connection.ts`

---
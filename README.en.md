<div align="center">
  <img alt="DingTalk" src="https://raw.githubusercontent.com/DingTalk-Real-AI/dingtalk-openclaw-connector/main/docs/images/dingtalk.svg" width="72" height="72" />
  <h1>dingtalk-openclaw-connector（Community Maintained Fork）</h1>
  <p>Community maintained fork of the official <strong>v0.8.20</strong> release, tracking and fixing bugs the official team hasn't addressed.<br/>
  Identical to the official release in functionality — only community-critical fixes applied.</p>

  <p><strong>Current published release: <a href="https://www.npmjs.com/package/@jeik/dingtalk-connector">@jeik/dingtalk-connector</a> v0.8.21-fix20</strong> (on npm — see "Installation" below; `latest` still points to v0.8.21, install fix builds with `@fix` or an explicit version).</p>

  <p>
    <a href="https://www.npmjs.com/package/@jeik/dingtalk-connector"><img src="https://img.shields.io/npm/v/@jeik/dingtalk-connector.svg?style=flat&colorA=18181B&colorB=28CF8D" alt="npm version" /></a>
    <a href="https://www.npmjs.com/package/@jeik/dingtalk-connector"><img src="https://img.shields.io/npm/dm/@jeik/dingtalk-connector.svg?style=flat&colorA=18181B&colorB=28CF8D&cacheSeconds=0" alt="npm downloads" /></a>
    <a href="https://github.com/jeikl/dingtalk-openclaw-connector-fix-Community/blob/main/LICENSE"><img src="https://img.shields.io/github/license/jeikl/dingtalk-openclaw-connector-fix-Community.svg?style=flat&colorA=18181B&colorB=28CF8D" alt="license" /></a>
  </p>

  <p>
    <a href="README.md">🇨🇳 简体中文</a> •
    <a href="CHANGELOG.md">Changelog</a> •
    <a href="https://openclaw.ai/">OpenClaw Website</a>
  </p>
</div>

---

## 🔧 Recent Updates

| Date | Tag | Update |
|------|------|--------|
| 2026-06-29 | 🐛 | **Fixed message-tool cards rendering empty content**: `finishAICard` was simplified to PUT FINISHED directly. That works for the reply-dispatcher path (card already streamed, `inputingStarted=true`) but breaks the message-tool path (`createAICardForTarget` → `finishAICard` on a fresh card, `inputingStarted=false`) — skipping the INPUTING transition made DingTalk not render the `content` field (blank card). `finishAICard` now only triggers an extra `streamAICard(..., /*finished*/ false)` walk through INPUTING + content write when `!inputingStarted`; `finished=false` avoids "fake-stream replay" and the already-streamed path (`inputingStarted=true`) is unchanged. **Upgrade:** `npm install -g @jeik/dingtalk-connector@fix` |
| 2026-06-29 | ✨ | **Answer-card mode** (on by default): when the final answer exceeds `answerActToken` (default 600) tokens, the streaming card finalizes to "✅ Done thinking" and the full reply is delivered on a separate **static answer card**, sidestepping DingTalk's official bug where a FINISHED streaming card keeps flickering; short answers stay on the original card. Template/threshold configurable (`answerCardTemplateId` / `answerActToken`) |
| 2026-06-29 | ✨ | **Tool-call progress**: while a tool runs, the card streams `🔧 Calling tool: <name>`, then updates to the reply when done |
| 2026-06-29 | 🐛 | **Fixed tool failures being treated as the final answer**: failed tool results (carrying `isError`/`isStatusNotice`, e.g. dws) were occasionally taken as the final answer and stopped rendering early; now excluded per OpenClaw's own rule — shown transiently, never counted as the answer |
| 2026-06-29 | 🎯 | **Reply marker system**: works with prompt-rewriter's `[-process-]`/`[-final-]` markers — process segments stream token-by-token, `[-final-]` triggers one-shot finalize (no "fake-stream replay"); markers never shown to the user, and take priority over OpenClaw's default fallback |
| 2026-06-29 | 🔧 | Install wizard: `getInstallSpec` now pins the exact version (fixes "installing the fix build but getting the stable one"); asks whether to skip dws update when already installed; detects & can disable a local plugin copy shadowing the npm version |
| 2026-06-28 | ✨ | Install wizard now detects existing config: skip QR when a bot already exists; after QR, choose to overwrite or add a bot (bindings maintained automatically, other configs untouched) |
| 2026-06-28 | 📦 | Now published to npm (`@jeik/dingtalk-connector`) with one-command scan-to-install; `--force` overwrites for updates, no uninstall needed |
| 2026-06-28 | 🐛 | Fixed the connector mistaking an intermediate progress message for the final answer and ending AI Card rendering too early when the model emits multiple progress messages in one turn (card now finalized only at turn end) |
| 2026-05-14 | ✨ | Markdown image support for direct URLs and local paths, no download required |
| 2026-05-11 | 🔧 | AI Card flashing and repeated re-rendering caused by duplicate intermediate messages after Agent multi-round loop completes |
| 2026-05-11 | 🐛 | OpenClaw 4.29+ causing DingTalk plugin to show "✅ 任务执行完成（无文本输出）" in group chat @Agent |
| 2026-05-08 | 🌐 | WebSocket phantom reconnect caused by unregistered Pong listener, from [PR #566](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/pull/566) by [Majorshi](https://github.com/Majorshi) |

Full update log: [FIXES.md](FIXES.md)（[🇨🇳 中文](FIXES.en.md)）

---

## ✨ Enhanced Features

- 🔧 Markdown image support for direct URLs and local paths, no download required:
  - Markdown syntax `![](direct-url)` or `![](local-path)` sends images directly
  - Compatible with mediaId format
  - ⚠️ This plugin supports image messages, but DingTalk side won't trigger this feature automatically. Use the following prompt to guide the Agent:

    ```
    Please write a DingTalk image sending skill following this approach: use markdown to send images, with image captions for rich text; direct URLs or local paths can be embedded directly in markdown, and if local paths contain spaces, rename to remove spaces first before sending.
    ```

- 🎨 Custom AI Card template support for user-prebuilt cards (with copy button), uses official default card if not set:

```json
"channels": {
  "dingtalk-connector": {
    "enabled": true,
    "clientId": "your-clientId",
    "clientSecret": "your-clientSecret",
    "cardTemplateId": "your-card-template-id.schema",
    "cardContentVar": "content"
  }
}
```

| Parameter | Description |
|-----------|-------------|
| `cardTemplateId` | AI Card template ID, uses official default if not set |
| `cardContentVar` | Final response content variable, defaults to `msgContent` |
| `cardProcessVar` | Intermediate process (block status) variable, defaults to `cardContentVar` if not set |
| `cardToolVar` | Tool call output variable, not written to card if not set |
| `answerCard` | Answer-card mode switch, **on by default**; set `false` to disable |
| `answerActToken` | Answer-card trigger threshold (tokens), default `600`; final answer ≤ this stays on the original card, > this opens a separate answer card |
| `answerCardTemplateId` | Answer-card template ID, uses the built-in default if not set (must contain a `content` variable) |

> Card template must be created in [DingTalk Open Platform](https://open.dingtalk.com/) with matching variable fields.

---

## 🎯 Reply markers + Answer card + Tool progress (core enhancements)

These make the "process → final answer" rendering on DingTalk cleaner and more stable, working around DingTalk's official streaming AI Card bug:

- **Reply markers**: work with the `[-process-]` (process) / `[-final-]` (final) markers injected by [prompt-rewriter](https://www.npmjs.com/package/@jeik/prompt-rewriter).
  - Process segments stream token-by-token; once `[-final-]` appears, streaming stops and the card is **finalized in one shot** (no DingTalk "fake-stream replay").
  - Markers are **never visible to the user** (stripped before writing to the card) and take **priority over** OpenClaw's default fallback — preventing intermediate process text from being mistaken for the final answer and stopping rendering early.
  - With no markers, behavior follows OpenClaw's default entirely.
- **Answer-card mode** (on by default): when the final answer exceeds `answerActToken` (default 600) tokens, the **streaming card finalizes to "✅ Done thinking"** and a separate **static answer card** carries the full reply — avoiding DingTalk's bug where a FINISHED streaming card keeps flickering/re-rendering. Short answers stay on the original card, no extra card.
- **Tool-call progress**: while the Agent calls a tool, the card streams `🔧 Calling tool: <name>`, then updates to the reply when the tool finishes.
- **Tool failures no longer mis-rendered**: failed tool results (carrying `isError`/`isStatusNotice`) are shown transiently but **never treated as the final answer**.

> Markers require the prompt-rewriter plugin; answer card / tool progress are built into the connector and work out of the box.

---

## Why Fork?

Due to the sluggish pace of the official DingTalk connector's updates and bug fixes, this repository was forked to keep up with critical fixes.

**Bugs fixed using Claude Code (official AI model) to ensure maximum fix quality.**

Community contributions (features & bug fixes) are always welcome — submit a PR anytime!

---

## Differences from Official

| Item | Description |
|------|-------------|
| Base | Official v0.8.20, fully identical features |
| Fixes | Bugs the official team hasn't addressed (see recent fixes above) |
| Maintenance | Community maintained, continuously tracking official updates |

---

## Requirements & Installation

Before you start, make sure you have:

- **OpenClaw**: Installed and running properly. Visit the [OpenClaw website](https://openclaw.ai/) for details.
- **Version**: OpenClaw ≥ **2026.4.9**. Check with `openclaw -v`.

> If below this version, upgrade with: `npm install -g openclaw`

---

## Installation

> Same channel id as the official plugin (`dingtalk-connector`); `--force` overwrites in place, so **no need to uninstall** the official or an older version first.

### Option 1: npm (recommended)

This build is published to npm (`@jeik/dingtalk-connector`).

**One-command scan-to-install** (recommended — DingTalk QR scan handles: bot creation → credentials → plugin install → config write):

```bash
npx -y @jeik/dingtalk-connector install
```

**Or install the plugin only** (configure credentials yourself, see advanced docs below):

```bash
openclaw plugins install @jeik/dingtalk-connector --force
# or
npx openclaw@latest add @jeik/dingtalk-connector

openclaw gateway restart
```

### Option 2: Local build artifact (development / offline)

```bash
# 1. Clone repo
git clone https://github.com/jeikl/dingtalk-openclaw-connector-fix-Community.git
cd dingtalk-openclaw-connector-fix-Community

# 2. Install, build & pack (npm or pnpm)
npm install && npm run build && npm pack       # → jeik-dingtalk-connector-0.8.21.tgz
# pnpm install && pnpm run build && pnpm pack

# 3. Install to OpenClaw and restart
openclaw plugins install ./jeik-dingtalk-connector-0.8.21.tgz --force
openclaw gateway restart
```

---

## Usage Guide

[OpenClaw DingTalk Plugin User Guide](https://alidocs.dingtalk.com/i/nodes/2Amq4vjg89GEno0zfPqoPGqdV3kdP0wQ?utm_scene=team_space)

---

## Advanced Documentation

- [Manual Setup Guide](docs/DINGTALK_MANUAL_SETUP.md) — Configure credentials manually
- [DingTalk DEAP Agent Integration](docs/DEAP_AGENT_GUIDE.en.md) — Local device operation capabilities
- [Multi-Agent Routing](docs/MULTI_AGENT_SETUP.md) — Bind multiple bots to different Agents
- [Troubleshooting](docs/TROUBLESHOOTING.md) — Installation and usage issue resolution
- [Official README（中文）](README_DINGTALK_OFFICIAL.md)
- [Official README（English）](README_DINGTALK_OFFICIAL_en.md)

---

## Contributing

Community contributions are welcome! If you find a bug or have feature suggestions, please submit an [Issue](https://github.com/jeikl/dingtalk-openclaw-connector-fix-Community/issues) or Pull Request.

---

## License

This project is licensed under the [MIT](LICENSE) License.

---

## Support

- **Issues**: [GitHub Issues](https://github.com/jeikl/dingtalk-openclaw-connector-fix-Community/issues)
- **Changelog**: [CHANGELOG.md](CHANGELOG.md)
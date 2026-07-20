<div align="center">
  <img alt="DingTalk" src="https://raw.githubusercontent.com/DingTalk-Real-AI/dingtalk-openclaw-connector/main/docs/images/dingtalk.svg" width="72" height="72" />
  <h1>dingtalk-openclaw-connector（Community Maintained Fork）</h1>
  <p>Community maintained fork of the official <strong>v0.8.20</strong> release, tracking and fixing bugs the official team hasn't addressed.<br/>
  Identical to the official release in functionality — only community-critical fixes applied.</p>

  <p><strong>Current published release: <a href="https://www.npmjs.com/package/@jeik/dingtalk-connector">@jeik/dingtalk-connector</a> v0.8.21-fix48</strong> (production-stable; install: <code>npx -y @jeik/dingtalk-connector install</code>).</p>

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

### 🚀 v0.8.21-fix48 · 2026-07-21 (current)

**Theme: message tool answer card by default (toggle)**

| | Change |
|--|--------|
| ✨ **`messageAnswerCard`** | **Default `true`**: message body uses static answer card; set `false` for plain text/markdown |
| 🔧 **Registered** | `schema` + `openclaw.plugin.json` (channels / accounts / uiHints) |
| 📎 **Independent** | Separate from session-stream `answerCard`; media still uses normal APIs |

```bash
npx -y @jeik/dingtalk-connector install --force && openclaw gateway restart
```

### 📦 v0.8.21-fix47 · 2026-07-20

`file://` no longer misclassified as remote (grey-image fix).

### 📦 v0.8.21-fix46 · 2026-07-20

Always-on local MD image diagnostics.

### 📦 v0.8.21-fix45 · 2026-07-20

Image + download link one bubble · only `![]` · quote cache · residual false-positive fix.

### 📦 v0.8.21-fix38 · 2026-07-20

Remote `media` download-then-upload.

### 📦 v0.8.21-fix37 · 2026-07-20

Local images (incl. `/mnt`) · `messageImageMd` · LocalImage diagnostics.

---

### Earlier releases (summary)

| Date | Highlights |
|------|------------|
| 2026-07-14 | **fix31** — serial stream queue; dual-card threshold; error mapping; ACK UX; wizard accountId; drop `cardToolVar`/`cardProcessVar` |
| 2026-06-29 | Answer-card 500 fix; threshold 500; deferred card create; empty message-card fix; tool progress; wizard upgrades |
| 2026-06-28 | npm `@jeik/dingtalk-connector`; premature finalization fix |
| 2026-05 | MD images; multi-turn spam; 4.29 empty reply; WS phantom reconnect |

Full log: [CHANGELOG.md](CHANGELOG.md) · [FIXES.md](FIXES.md) · [Release fix48](docs/RELEASE_NOTES_V0.8.21-fix48.md)

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
    "cardContentVar": "content",
    "messageAnswerCard": true
  }
}
```

### DingTalk-specific config (`channels.dingtalk-connector`)

Only **this plugin’s DingTalk features** (not generic channel policy / session / logging).  
Top-level and `accounts.<id>` share these; account overrides inherit when omitted.

#### Credentials & multi-bot

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `clientId` | string \| number | — | DingTalk AppKey / Client ID |
| `clientSecret` | string \| SecretRef | — | AppSecret |
| `accounts` | object | — | Multi-bot map; keys are account IDs |
| `accounts.*.name` | string | — | Display name |
| `accounts.*.clientId` / `clientSecret` | — | — | Per-bot credentials |
| `accounts.*.chatbotUserId` | string | — | Encrypted bot id (for bots @-mentioning each other) |
| `accounts.*.chatbotCorpId` | string | — | Bot corp id |

#### AI card / answer card / message tool

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `groupReplyMode` | `"aicard"` \| `"text"` \| `"markdown"` | `"aicard"` | Group reply style; `text`/`markdown` skips streaming AI card (multi-bot @) |
| `cardTemplateId` | string | official stream template | Streaming AI Card template id |
| `cardContentVar` | string | `"msgContent"` | Stream card content variable |
| `answerCard` | boolean | **true** | **Session-stream** answer card; set `false` to disable |
| `answerActToken` | int | **500** | Token threshold: ≤ finalize on stream card; > open static answer card |
| `answerCardTemplateId` | string | built-in answer template | Static answer card template id |
| `messageAnswerCard` | boolean | **true** | **message tool** body via answer card; `false` = plain text/markdown. Independent of `answerCard`; media stays on normal APIs |
| `messageImageMd` | boolean | **false** | message images: `false` text then image; `true` merge multi-image+text markdown |
| `enableMediaUpload` | boolean | — | Enable media upload |

> Create/publish card templates in [DingTalk Open Platform](https://open.dingtalk.com/).  
> `answerCard` = conversation finalize; `messageAnswerCard` = message-tool outbound.

---

## 🎯 Reply markers + Answer card + Tool progress (core enhancements)

These make the "process → final answer" rendering on DingTalk cleaner and more stable, working around DingTalk's official streaming AI Card bug:

- **Reply markers**: work with the `[-process-]` (process) / `[-final-]` (final) markers injected by [prompt-rewriter](https://www.npmjs.com/package/@jeik/prompt-rewriter).
  - Process segments stream token-by-token; once `[-final-]` appears, streaming stops and the card is **finalized in one shot** (no DingTalk "fake-stream replay").
  - Markers are **never visible to the user** (stripped before writing to the card) and take **priority over** OpenClaw's default fallback — preventing intermediate process text from being mistaken for the final answer and stopping rendering early.
  - With no markers, behavior follows OpenClaw's default entirely.
- **Answer-card mode** (on by default): when the final answer exceeds `answerActToken` (default 500) tokens, the **streaming card finalizes to "✅ Done thinking"** and a separate **static answer card** carries the full reply — avoiding DingTalk's bug where a FINISHED streaming card keeps flickering/re-rendering. Short answers stay on the original card, no extra card.
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

> Same channel id as the official plugin (`dingtalk-connector`); `--force` overwrites in place — **no uninstall** needed.  
> **Current stable: `0.8.21-fix31`** (npm `latest`). Always run `openclaw gateway restart` after install/upgrade.

### Option 1: npm (recommended)

Package: [`@jeik/dingtalk-connector`](https://www.npmjs.com/package/@jeik/dingtalk-connector)

**1) One-command QR install** (bot → credentials → plugin → config):

```bash
npx -y @jeik/dingtalk-connector install

# force overwrite when a local dingtalk-connector already exists
npx -y @jeik/dingtalk-connector install --force
```

**2) Plugin only** (credentials already set / manual setup):

```bash
openclaw plugins install @jeik/dingtalk-connector --force
openclaw gateway restart
```

**3) Upgrade to latest:**

```bash
openclaw plugins install @jeik/dingtalk-connector --force
openclaw gateway restart
```

### Option 2: Local tgz / from source (dev / offline)

```bash
git clone https://github.com/jeikl/dingtalk-openclaw-connector-fix-Community.git
cd dingtalk-openclaw-connector-fix-Community
# optional: pin a release (this is a git tag, not a branch)
# git fetch --tags && git checkout v0.8.21-fix31

npm install && npm run build && npm pack
# → jeik-dingtalk-connector-0.8.21-fix31.tgz

openclaw plugins install ./jeik-dingtalk-connector-0.8.21-fix31.tgz --force
openclaw gateway restart
```

### Smoke check

```bash
openclaw -v
openclaw plugins list
# Send a DingTalk message — you should first see "🦸 正在召唤大模型…" then streaming reply
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
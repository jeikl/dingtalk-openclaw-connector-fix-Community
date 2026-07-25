<div align="center">
  <img alt="DingTalk" src="https://raw.githubusercontent.com/DingTalk-Real-AI/dingtalk-openclaw-connector/main/docs/images/dingtalk.svg" width="72" height="72" />
  <h1>dingtalk-openclaw-connector（Community Maintained Fork）</h1>
  <p>Community-enhanced fork based on official <strong>v0.8.24</strong>: adopts official long-connection improvements, plus stronger message delivery, queue feedback, and error-card UX.<br/>
  Keeps community extras (images, answer cards, first-response UX) and continues to fix issues not yet covered upstream.</p>

  <p><strong>Current release: <a href="https://www.npmjs.com/package/@jeik/dingtalk-connector">@jeik/dingtalk-connector</a> v0.8.28</strong> (recommended for production; install: <code>npx -y @jeik/dingtalk-connector@0.8.28 install --force</code>).</p>

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

### 🚀 v0.8.28 · 2026-07-25 (current)

**Theme: based on official 0.8.24 · steadier connection · fewer lost messages · clearer errors**

Built on community enhancements, aligned with official **0.8.24** connection work, and focused on real UX: “sent but no reply”, stuck error cards, and missing “queued” feedback.

#### From official 0.8.24

- More reliable long-connection setup and keepalive (fewer “connected but silent” cases)
- Long AI runs less likely to get cut mid-task by connection flapping
- Cleaner console logs for easier ops

#### Extra community improvements (what you’ll notice)

| Experience | Effect |
|------------|--------|
| 🔗 **Connection** | Marks “connected” only when the bot can actually receive messages; auto-retries instead of faking online |
| 📩 **Fewer lost messages** | Much better after errors, after a reply finishes, or when sending several messages quickly |
| ⏳ **Queue feedback** | While the previous message is still running, new messages more reliably show “queued / processing” + thinking reaction |
| ⚠️ **Model failures** | Billing / no channel / 503-style failures settle into clear Chinese error cards instead of spinning forever |
| 🃏 **Answer cards & images** | Existing community answer-card and full image-path fixes remain |

```bash
npx -y @jeik/dingtalk-connector@0.8.28 install --force && openclaw gateway restart
```

### 📦 v0.8.26 · 2026-07-25

Stricter outbound target ID rules (keep `==` suffixes and case).

### 📦 v0.8.25 · 2026-07-24

Sender role/title identity; bare DingTalk IDs as direct chat.

### 📦 v0.8.21-fix49 and earlier

Answer cards, image path fixes, streaming finalize, Chinese error mapping — see [CHANGELOG.md](CHANGELOG.md).

Full log: [CHANGELOG.md](CHANGELOG.md) · [FIXES.md](FIXES.md)

---

## ✨ Enhanced Features

### 🖼️ Image sending: full fix & upgrade

> 🔥 **No dead corners** · mixed send paths · far beyond the official’s weak image pipeline  
> ✅ Chat · ✅ message direct · ✅ markdown embed · ✅ split or merge layout

Full-path image fixes — every channel below renders correctly:

| | Path | Capability |
|--|------|------------|
| 💬 | **Normal chat reply** | Agent embeds `![alt](…)`; upload to mediaId before finalize |
| 📤 | **message · mediaUrl** | Proactive direct send (local / LAN / public) |
| 📝 | **message · markdown body** | Nested `![](…)` (local / `file://` / URL) with text |
| ⚙️ | **Configurable layout** | Default 📎 **separate**; `messageImageMd: true` → 🧩 **merge** one markdown |

#### 🌐 Source types covered

| | Type | Examples |
|--|------|----------|
| 🌍 | Public URL | `https://…` |
| 🏠 | Private / LAN URL | `http://intranet/…` |
| 📁 | Local absolute path | `/tmp/…` · `/root/…` |
| 💾 | **`/mnt` mounts** | Chinese paths · SMB shares |
| 🔗 | `file://` URI | `file:///mnt/…` · `file:///tmp/…` |
| 🆔 | Existing mediaId | `@lADP…` |

#### 🛡️ Extra safeguards

- 📦 Code-block / inline-code paths are **not** uploaded
- ⬇️ Remote: **download then upload**; local: **`/tmp` retry** on failure
- 🫧 Image + download link in **one bubble**: `![]` → mediaId, URL kept as-is

### 🎨 AI Card template

- ✨ Custom stream cards; **if `cardTemplateId` is omitted**, defaults to  
  `0d2c84b3-12c1-473b-b14a-f329a7a102cd.schema` (📋 copy button, etc.)

### ⚙️ Minimal config

```json
"channels": {
  "dingtalk-connector": {
    "enabled": true,
    "clientId": "your-clientId",
    "clientSecret": "your-clientSecret"
  }
}
```

Defaults apply: stream card `0d2c84b3-…schema`, session answer card on, message answer card on, `messageImageMd=false`.

> **Maximal config ≡ minimal config.** The blocks below only spell out defaults so the fields are easier to understand. Behavior is the same as the credential-only minimal config — use minimal in production.

### Maximal config (for illustration; defaults written out)

**Single Agent** and **multi Agent** (all values are defaults — **not extra features**).

**Single Agent (top-level credentials):**

```json
"channels": {
  "dingtalk-connector": {
    "enabled": true,
    "clientId": "your-clientId",
    "clientSecret": "your-clientSecret",
    "cardTemplateId": "0d2c84b3-12c1-473b-b14a-f329a7a102cd.schema",
    "cardContentVar": "content",
    "answerCard": true,
    "answerActToken": 500,
    "answerCardTemplateId": "d246b7f5-1783-4e9b-bb46-bef52d63050e.schema",
    "messageAnswerCard": true,
    "messageImageMd": false
  }
}
```

**Multi Agent (`accounts`, one credential/card set per bot):**

```json
"channels": {
  "dingtalk-connector": {
    "enabled": true,
    "defaultAccount": "main-bot",
    "accounts": {
      "main-bot": {
        "enabled": true,
        "name": "main-bot",
        "clientId": "main-bot-clientId",
        "clientSecret": "main-bot-clientSecret",
        "cardTemplateId": "0d2c84b3-12c1-473b-b14a-f329a7a102cd.schema",
        "cardContentVar": "content",
        "answerCard": true,
        "answerActToken": 500,
        "answerCardTemplateId": "d246b7f5-1783-4e9b-bb46-bef52d63050e.schema",
        "messageAnswerCard": true,
        "messageImageMd": false
      },
      "guide-bot": {
        "enabled": true,
        "name": "guide-bot",
        "clientId": "guide-bot-clientId",
        "clientSecret": "guide-bot-clientSecret",
        "cardTemplateId": "0d2c84b3-12c1-473b-b14a-f329a7a102cd.schema",
        "cardContentVar": "content",
        "answerCard": true,
        "answerActToken": 500,
        "answerCardTemplateId": "d246b7f5-1783-4e9b-bb46-bef52d63050e.schema",
        "messageAnswerCard": true,
        "messageImageMd": false
      }
    }
  }
}
```

### DingTalk-specific fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `clientId` | string \| number | — | AppKey / Client ID |
| `clientSecret` | string \| SecretRef | — | AppSecret |
| `accounts` | object | — | Multi-bot map |
| `accounts.*.name` | string | — | Display name |
| `accounts.*.clientId` / `clientSecret` | — | — | Per-bot credentials |
| `cardTemplateId` | string | `0d2c84b3-12c1-473b-b14a-f329a7a102cd.schema` | Streaming AI Card template |
| `cardContentVar` | string | `"content"` | Stream card content variable |
| `answerCard` | boolean | **true** | Session-stream answer card; `false` disables |
| `answerActToken` | int | **500** | Token threshold for spawning answer card |
| `answerCardTemplateId` | string | `d246b7f5-1783-4e9b-bb46-bef52d63050e.schema` | Static answer card template |
| `messageAnswerCard` | boolean | **true** | message-tool body via answer card; `false` = plain message |
| `messageImageMd` | boolean | **false** | message images: separate vs merge markdown |

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
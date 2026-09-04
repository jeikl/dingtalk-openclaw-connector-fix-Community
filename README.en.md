<div align="center">
  <img alt="DingTalk" src="https://raw.githubusercontent.com/DingTalk-Real-AI/dingtalk-openclaw-connector/main/docs/images/dingtalk.svg" width="72" height="72" />
  <h1>dingtalk-openclaw-connector（Community Maintained Fork）</h1>
  <p>Community-enhanced fork based on official <strong>v0.8.24</strong>: adopts official long-connection improvements, plus stronger message delivery, queue feedback, and error-card UX.<br/>
  Keeps <strong>this repo’s unique</strong> extras (images, answer cards, first-response UX) and continues to fix issues not yet covered upstream.</p>

  <p><strong>Current release: <a href="https://www.npmjs.com/package/@jeik/dingtalk-connector">@jeik/dingtalk-connector</a> v0.8.41</strong></p>

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

### 🚀 v0.8.41 · 2026-09-02 (current)

**Theme: cross-env compatibility · /stop abort penetration · dws outbound context**

| Version | Highlights |
|---------|-----------|
| v0.8.41 | Eliminate `import.meta` / top-level Await compatibility issues across Node versions and jiti |
| v0.8.40 | Fix plugin import SyntaxError (`Cannot use 'import.meta' outside a module`) |
| v0.8.39 | `/stop` command penetrates queue, terminates long-running tasks in milliseconds |
| v0.8.33–35 | dws message sends inject `outbound_message` context; outbound-runtime openclaw→jeikclaw fallback |
| v0.8.32 | Install wizard CLI choice (openclaw / jeikclaw); manifest version auto-sync |
| v0.8.29–31 | Quieter default logs; unified `debug` toggle; `incomplete_turn` false-positive filter |

See [CHANGELOG.md](CHANGELOG.md) for the full history.

---

## 🚀 Quick Start

### Requirements

- **OpenClaw** installed and running ([website](https://openclaw.ai/))
- **Version**: OpenClaw ≥ **2026.4.9** (`openclaw -v`)
- Same channel id as official (`dingtalk-connector`); `--force` overwrites — **no uninstall** needed
- Always `openclaw gateway restart` after install/upgrade

Package: [`@jeik/dingtalk-connector`](https://www.npmjs.com/package/@jeik/dingtalk-connector)

> 💡 **Highly recommended: pair with [JeikClaw](https://github.com/jeikl/openclaw-strontfix-feature) (enhanced OpenClaw fork by the same author)**:
>
> Official OpenClaw **2026.8.1** breaks this plugin (see [issue #3](https://github.com/jeikl/dingtalk-openclaw-connector-fix-Community/issues/3)). Official design burns long-task context and updates slowly.
>
> JeikClaw stays on official **2026.7.1** with extensive bug fixes, deep optimization of task management, fallback copy, long-task handling and context passing, plus dedicated **DingTalk / Telegram** adaptation and:
> - 🎨 **Thinking process + tool cards** visualization (persisted stage cards, collapse, multi-round colors)
> - 🖼️ **Intranet URL support for image recognition** and **URL direct-feed recognition for OpenAI / Anthropic APIs**
> - ⏹️ **/stop command penetration** — terminate long-running tasks in milliseconds
>
> Install: `npm install -g jeikclaw@latest` (fully coexists with official `openclaw`, separate bin command)

> 🤖 **Also recommended: [JeikCode](https://github.com/jeikl/jeikcode) (super-fast autonomous terminal AI coding agent, Rust-powered) by the same author**:
>
> Built for large codebases and complex business logic, with **better context management + model coding performance** — code indexing that surpasses Codex / Grok Build / Claude Code:
> - 📚 **CodeExplore: weighted AST + bilingual (CN/EN) semantic search** — **60–70%** faster retrieval, **90%+** accuracy, hits core code within one round — no more grep trial and error
> - 🧠 **Strict Append-Only KV Cache protection** — `sacred_floor` compaction guard + `user-wrap.md` dynamic tail wrapping for stable context and lower cost
> - 🔧 **5-level tool self-healing chain + Loop Guard** — auto-repairs malformed JSON from unknown models, switches strategy after 3 failures
> - ⚡ **Cross-model speed** — native OpenAI / Anthropic / any open protocol support, 4-level reasoning effort (`/effort`)
> - 🖥️ **WebUI console + remote Serve** — headless multi-instance, `/webui` opens browser console
>
> Install: `curl -fsSL https://raw.githubusercontent.com/jeikl/jeikcode/local-dev/scripts/install.sh | bash` (or `cargo install --path crates/atomcode-cli --bin jeikcode --locked`), see [JeikCode README](https://github.com/jeikl/jeikcode)

### A) npx one-command QR install (try in order)

```bash
# 1) Install latest
npx @jeik/dingtalk-connector install --force && openclaw gateway restart

# 2) If you did not get the latest, pin the version
npx @jeik/dingtalk-connector@0.8.41 install --force && openclaw gateway restart

# 3) If it still fails, force the official npm registry
NPM_CONFIG_REGISTRY=https://registry.npmjs.org npx @jeik/dingtalk-connector@0.8.41 install --force && openclaw gateway restart
```

### B) Plugin only (credentials already set; try in order)

```bash
# 1) Install latest
openclaw plugins install @jeik/dingtalk-connector --force && openclaw gateway restart

# 2) If you did not get the latest, pin the version
openclaw plugins install @jeik/dingtalk-connector@0.8.41 --force && openclaw gateway restart

# 3) If it still fails, force the official npm registry
NPM_CONFIG_REGISTRY=https://registry.npmjs.org openclaw plugins install @jeik/dingtalk-connector@0.8.41 --force && openclaw gateway restart
```

### Local tgz / from source (dev / offline)

```bash
git clone https://github.com/jeikl/dingtalk-openclaw-connector-fix-Community.git
cd dingtalk-openclaw-connector-fix-Community
npm install && npm run build && npm pack
openclaw plugins install ./jeik-dingtalk-connector-0.8.41.tgz --force && openclaw gateway restart
```

### Smoke check

```bash
openclaw -v
openclaw plugins list
# Send a DingTalk message — first “summoning model…”, then streaming / answer card
```

---

## ⚙️ Configuration

### Minimal config

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
| `debug` | boolean | **false** | Verbose diagnostics (connection / image mediaId / quote / queue). **Off in production**; set `true` then restart gateway |

> `answerCard` = conversation finalize; `messageAnswerCard` = message-tool outbound.

**Temporary debug example:**

```json
"channels": {
  "dingtalk-connector": {
    "enabled": true,
    "clientId": "…",
    "clientSecret": "…",
    "debug": true
  }
}
```

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

### 🎯 Reply markers + Answer card + Tool progress

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
| Base | Aligned with official **v0.8.24** long-connection work + this repo’s unique extras |
| Fixes | Silent connection, lost messages, stuck error cards, grey images, etc. |
| Maintenance | Community maintained, continuously tracking official updates |

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

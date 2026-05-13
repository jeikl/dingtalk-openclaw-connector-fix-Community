<div align="center">
  <img alt="DingTalk" src="https://raw.githubusercontent.com/DingTalk-Real-AI/dingtalk-openclaw-connector/main/docs/images/dingtalk.svg" width="72" height="72" />
  <h1>dingtalk-openclaw-connector（Community Maintained Fork）</h1>
  <p>Community maintained fork of the official <strong>v0.8.20</strong> release, tracking and fixing bugs the official team hasn't addressed.<br/>
  Identical to the official release in functionality — only community-critical fixes applied.</p>

  <p>
    <a href="https://www.npmjs.com/package/@dingtalk-real-ai/dingtalk-connector"><img src="https://img.shields.io/npm/v/@dingtalk-real-ai/dingtalk-connector.svg?style=flat&colorA=18181B&colorB=28CF8D" alt="npm version" /></a>
    <a href="https://www.npmjs.com/package/@dingtalk-real-ai/dingtalk-connector"><img src="https://img.shields.io/npm/dm/@dingtalk-real-ai/dingtalk-connector.svg?style=flat&colorA=18181B&colorB=28CF8D" alt="npm downloads" /></a>
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

> Card template must be created in [DingTalk Open Platform](https://open.dingtalk.com/) with matching variable fields.

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

## Uninstall Official Plugin (avoid conflicts)

Remove the official plugin before installing this version:

```bash
# List installed plugins
openclaw plugins list

# Uninstall official version
openclaw plugins uninstall dingtalk-connector

# Restart to apply changes
openclaw gateway restart
```

---

## Manual Build & Deployment

This version requires manual compilation (community fix, not published to npm):

```bash
# 1. Clone repo
git clone https://github.com/jeikl/dingtalk-openclaw-connector-fix-Community.git
cd dingtalk-openclaw-connector-fix-Community

# 2. Install, build & pack

# npm
npm install
npm run build
npm pack

# or pnpm
pnpm install
pnpm run build
pnpm pack

# 3. Install to OpenClaw and restart (built artifact in current dir)
npx openclaw plugins install ./dingtalk-real-ai-dingtalk-connector-0.8.20-fix6.tgz
npx openclaw gateway restart
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
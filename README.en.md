# dingtalk-openclaw-connector（Community Maintained Fork）

> Forked from the official [@dingtalk-real-ai/dingtalk-connector](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector), based on **v0.8.20**. Maintained by the community, tracking and fixing bugs the official team hasn't addressed.

---

## About

Due to the sluggish pace of the official DingTalk connector's updates and bug fixes, this repository was forked to keep up with critical fixes.

This version is identical to the official release in functionality, with only community-contributed bug fixes applied. All changes are fully documented in [FIXES.md](FIXES.md).

For full feature descriptions, installation and configuration guides, see the [official README](README_DINGTALK_OFFICIAL.md).

**Bugs fixed using Claude Code (official AI model) to ensure maximum fix quality.**

Community contributions (features & bug fixes) are always welcome — submit a PR anytime!

---

## Differences from Official

This version is based on official **v0.8.20**, with all official features intact, only the community-hesistant bugs fixed.

**Recent Fixes:**
- 🔧 Fix AI Card flashing and repeated re-rendering caused by duplicate intermediate messages after Agent multi-round loop completes (2026-05-11)
- 🐛 Fix OpenClaw 4.29+ causing DingTalk plugin to fail, showing "✅ 任务执行完成（无文本输出）" in group chat @Agent (2026-05-11)
- 🌐 Fix WebSocket phantom reconnect caused by unregistered Pong listener, from [PR #566](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/pull/566) by [Majorshi](https://github.com/Majorshi) (2026-05-08)

All fixes: [FIXES.md](FIXES.md).

---

## Official Docs

- [Official README (Chinese)](README_DINGTALK_OFFICIAL.md)
- [Official GitHub repo](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector)
- [npm package](https://www.npmjs.com/package/@dingtalk-real-ai/dingtalk-connector)
- [OpenClaw DingTalk Plugin Guide](https://alidocs.dingtalk.com/i/nodes/2Amq4vjg89GEno0zfPqoPGqdV3kdP0wQ?utm_scene=team_space)
- [OpenClaw Official Site](https://openclaw.ai/)

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

## Deployment

```bash
# 1. Clone repo
git clone https://github.com/your-username/dingtalk-openclaw-connector.git
cd dingtalk-openclaw-connector

# 2. Install, build & pack (npm)
npm install
npm run build
npm pack

# or pnpm
pnpm install
pnpm run build
pnpm pack

# 3. Install to OpenClaw and restart
openclaw plugins install dingtalk-real-ai-dingtalk-connector-0.8.20-fix6.tgz
openclaw gateway restart
```

---

## Version

Current: `v0.8.20-fix6` (based on official `v0.8.20`, forked 2026-05-10)
# dingtalk-openclaw-connector（社区维护版）

> 本仓库拉取自官方 [@dingtalk-real-ai/dingtalk-connector](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector)，基于官方 **v0.8.20**，由社区自行维护，持续跟进官方无暇修复的 Bug。

---

## 说明

由于钉钉官方连接器那拉稀的仓库更新与 Bug 修复速度，所以fork了此仓库

本版本在官方代码基础上由社区进行 Bug 修复和维护。所有修复内容均有完整记录，详见 [FIXES.md](FIXES.md)。

如需了解插件的完整功能介绍、安装方式和配置说明，请参阅 [官方 README](README_DINGTALK_OFFICIAL.md)。

---

## 与官方版本的差异

本版本基于官方 0.8.20 版本，功能一模一样，只是修复了官方一直拉稀不修的 BUG。

**最近修复（2026-05-11）：**
- 🔧 修复 Agent 多轮循环完成后，中间过程消息重复发送到钉钉对话，造成刷屏和 AI Card 倒放重渲染
- 🐛 修复在最新 openclaw 4.29 以上版本导致钉钉插件失效，导致群聊 @Agent 回复显示"✅ 任务执行完成（无文本输出）"的问题

所有修复项详见 [FIXES.md](FIXES.md)。

---

## 官方文档

- [官方 README（中文）](README_DINGTALK_OFFICIAL.md)
- [官方 GitHub 仓库](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector)
- [npm 包 @dingtalk-real-ai/dingtalk-connector](https://www.npmjs.com/package/@dingtalk-real-ai/dingtalk-connector)
- [OpenClaw 钉钉官方插件使用指南](https://alidocs.dingtalk.com/i/nodes/2Amq4vjg89GEno0zfPqoPGqdV3kdP0wQ?utm_scene=team_space)
- [OpenClaw 官网](https://openclaw.ai/)

---

## 卸载官方插件（避免冲突）

安装本版本前，先移除官方已安装的插件：

```bash
# 查看已安装插件，确认名称
openclaw plugins list

# 卸载官方版本
openclaw plugins uninstall dingtalk-connector

# 重启使卸载生效
openclaw gateway restart
```

---

## 部署

```bash
# 1. 克隆仓库
git clone https://github.com/your-username/dingtalk-openclaw-connector.git
cd dingtalk-openclaw-connector


# 2. 安装依赖 & 构建 & 打包（npm）

# npm
npm install 
npm run build
npm pack

# 或者pnpm
pnpm install 
pnpm run build
pnpm pack

# 3. 安装到 OpenClaw 并重启
openclaw plugins install dingtalk-real-ai-dingtalk-connector-0.8.20-fix5.tgz
openclaw gateway restart

```

---

## 版本

当前版本：`v0.8.20-fix5`（基于官方 `v0.8.20`，2026-05-10 拉取）

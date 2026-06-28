<div align="center">
  <img alt="DingTalk" src="https://raw.githubusercontent.com/DingTalk-Real-AI/dingtalk-openclaw-connector/main/docs/images/dingtalk.svg" width="72" height="72" />
  <h1>dingtalk-openclaw-connector（社区维护版）</h1>
  <p>基于官方 <strong>v0.8.20</strong> 的社区维护版本，由社区持续跟进修复官方无暇处理的 Bug。<br/>
  功能与官方完全一致，拥有最快的修复速度，及时合并官方pr和个人发现的bug和社区急需的 Bug。</p>

  <p>
    <a href="https://www.npmjs.com/package/@jeik/dingtalk-connector"><img src="https://img.shields.io/npm/v/@jeik/dingtalk-connector.svg?style=flat&colorA=18181B&colorB=28CF8D" alt="npm version" /></a>
    <a href="https://www.npmjs.com/package/@jeik/dingtalk-connector"><img src="https://img.shields.io/npm/dm/@jeik/dingtalk-connector.svg?style=flat&colorA=18181B&colorB=28CF8D" alt="npm downloads" /></a>
    <a href="https://github.com/jeikl/dingtalk-openclaw-connector-fix-Community/blob/main/LICENSE"><img src="https://img.shields.io/github/license/jeikl/dingtalk-openclaw-connector-fix-Community.svg?style=flat&colorA=18181B&colorB=28CF8D" alt="license" /></a>
  </p>

  <p>
    <a href="README.en.md">🇺🇸 English</a> •
    <a href="CHANGELOG.md">更新日志</a> •
    <a href="https://openclaw.ai/">OpenClaw 官网</a>
  </p>
</div>

---

## 🔧 最近更新

| 日期 | 标识 | 更新内容 |
|------|------|---------|
| 2026-06-28 | ✨ | 安装向导新增「已存在配置」检测：已有机器人配置可跳过扫码；扫码后可选覆盖或新增机器人（自动维护 bindings、不覆盖其它配置） |
| 2026-06-28 | 📦 | 改为发布到 npm（`@jeik/dingtalk-connector`），新增一键扫码安装命令；`--force` 覆盖更新无需卸载 |
| 2026-06-28 | 🐛 | 修复模型一轮内发送多条过程消息时，连接器把中间过程消息当成最终答案、提前结束 AI Card 渲染的问题（改为整轮结束才定稿卡片） |
| 2026-05-14 | ✨ | Markdown 图片发送支持直链和本地路径，无需下载到本地，请参考下列提示词|
| 2026-05-11 | 🔧 | Agent 多轮循环完成后，中间过程消息重复发送到钉钉对话，造成刷屏和 AI Card 倒放重渲染 |
| 2026-05-11 | 🐛 | OpenClaw 4.29+ 版本导致钉钉插件失效，群聊 @Agent 回复显示"✅ 任务执行完成（无文本输出）" |
| 2026-05-08 | 🌐 | 未注册的 Pong 监听器导致的 WebSocket 幻影重连，来源于 [PR #566](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/pull/566)（[Majorshi](https://github.com/Majorshi) 提交） |

完整更新日志：[FIXES.md](FIXES.md)（[🇺🇸 English](FIXES.en.md)）

---

## ✨ 增强功能

- 🔧 Markdown 图片发送支持直链和本地路径，无需下载到本地：
  - Markdown 语法 `![图片注释](直链URL)` 或 `![图片注释](本地路径)` 直接发送图片
  - 兼容 mediaId 格式
  - ⚠️ 本插件支持图文发送，但钉钉侧不会主动触发此功能，需使用以下提示词引导 Agent：

    ```
    请你把以下发送图片的方式写成你的钉钉图片发送skill，当涉及到图片发送，则调用该技能：用markdown语法发送图片，支持添加图片注释实现图文并茂；直链图片或本地路径文件均可直接嵌入markdown发送，如本地路径含空格请先重命名去除空格再发送。
    ```

- 🎨 支持自定义 AI Card 模板，可使用本人预制的卡片（含内容复制按钮），不填则使用官方默认卡片。

**单机器人：**

```json
"channels": {
  "dingtalk-connector": {
    "enabled": true,
    "clientId": "你的clientId",
    "clientSecret": "你的clientSecret",
    "cardTemplateId": "你的卡片模板ID.schema",
    "cardContentVar": "content"
  }
}
```

**多机器人（多 Agent）：** 每个账号可绑定不同机器人

```json
"channels": {
  "dingtalk-connector": {
    "enabled": true,
    "accounts": {
      "main-bot": {
        "enabled": true,
        "name": "工作流机器人",
        "clientId": "你的clientId",
        "clientSecret": "你的clientSecret",
        "cardTemplateId": "f9b75aac-713c-40e8-a17f-e236d7b5422b.schema",
        "cardContentVar": "content"
      },
      "another-bot": {
        "enabled": true,
        "name": "另一个机器人",
        "clientId": "另一个clientId",
        "clientSecret": "另一个clientSecret",
        "cardTemplateId": "f9b75aac-713c-40e8-a17f-e236d7b5422b.schema",
        "cardContentVar": "content"
      }
    }
  }
}
```

| 参数 | 说明 |
|------|------|
| `clientId` / `clientSecret` | 单机器人模式直接填在顶层 |
| `accounts` | 多机器人模式，key 为账号标识名（可任意命名） |
| `accounts.*.enabled` | 是否启用该账号 |
| `accounts.*.name` | 账号显示名称（仅用于标识） |
| `accounts.*.clientId` | 钉钉应用 ClientId |
| `accounts.*.clientSecret` | 钉钉应用 ClientSecret |
| `cardTemplateId` | AI Card 模板 ID，不填则使用官方默认模板 |
| `cardContentVar` | 最终回复内容变量名，不填默认 `msgContent` |
| `cardProcessVar` | 中间过程（block 状态）变量名，不填默认使用 `cardContentVar` |
| `cardToolVar` | 工具调用输出变量名，不填则不写入卡片 |

> 卡片模板需在[钉钉开放平台](https://open.dingtalk.com/)创建，并添加对应的变量字段。

**效果预览：**

![自定义卡片效果](assets/image.png)

---

## 为什么 Fork？

由于钉钉官方连接器那拉稀的仓库更新与 Bug 修复速度，所以 fork 了此仓库。

本版本在官方代码基础上由社区进行 Bug 修复和维护。**BUG 采用 Claude Code 官方模型修复，保证最大修复效果。**

欢迎民间大神提 PR，共建钉钉连接器生态！

---

## 与官方版本的差异

| 项目 | 说明 |
|------|------|
| 基础版本 | 官方 v0.8.20，功能完全一致 |
| 修复内容 | 官方一直不修的 Bug（见上方最近修复） |
| 维护方式 | 社区维护，持续跟进官方更新 |

---

## 安装与要求

开始之前，请确保：

- **OpenClaw**：已安装并正常运行。详情请访问 [OpenClaw 官网](https://openclaw.ai/)
- **版本要求**：OpenClaw ≥ **2026.4.9**，通过 `openclaw -v` 查看

> 如低于此版本，执行 `npm install -g openclaw` 升级。

---

## 安装

> 与官方插件同 channel id（`dingtalk-connector`），`--force` 直接覆盖更新，**无需先卸载**官方版或旧版。

### 方式一：npm（推荐）

本版本已发布到 npm（`@jeik/dingtalk-connector`）。

**一键扫码安装**（推荐，钉钉扫码完成：机器人创建 → 凭证获取 → 插件安装 → 配置写入）：

```bash
npx -y @jeik/dingtalk-connector install
```

**或仅安装插件**（自行配置凭证，见下方进阶文档）：

```bash
openclaw plugins install @jeik/dingtalk-connector --force
# 或
npx openclaw@latest add @jeik/dingtalk-connector

openclaw gateway restart
```

### 方式二：本地构建产物（开发 / 离线）

```bash
# 1. 克隆仓库
git clone https://ghfast.top/https://github.com/jeikl/dingtalk-openclaw-connector-fix-Community.git
cd dingtalk-openclaw-connector-fix-Community

# 2. 安装依赖 & 构建 & 打包（npm 或 pnpm 任选）
npm install && npm run build && npm pack       # → jeik-dingtalk-connector-0.8.21.tgz
# pnpm install && pnpm run build && pnpm pack

# 3. 安装到 OpenClaw 并重启
openclaw plugins install ./jeik-dingtalk-connector-0.8.21.tgz --force
openclaw gateway restart
```

---

## 使用指南

[OpenClaw 钉钉官方插件使用指南](https://alidocs.dingtalk.com/i/nodes/2Amq4vjg89GEno0zfPqoPGqdV3kdP0wQ?utm_scene=team_space)

---

## 进阶文档

- [手动配置指南](docs/DINGTALK_MANUAL_SETUP.md) — 手动填写凭证配置
- [钉钉 DEAP Agent 集成](docs/DEAP_AGENT_GUIDE.md) — 本地设备操作能力
- [多 Agent 路由配置](docs/MULTI_AGENT_SETUP.md) — 多机器人绑定不同 Agent
- [常见问题](docs/TROUBLESHOOTING.md) — 安装与使用问题排查
- [官方 README（中文）](README_DINGTALK_OFFICIAL.md)
- [Official README（English）](README_DINGTALK_OFFICIAL_en.md)

---

## 贡献

欢迎社区贡献！Bug 修复或功能建议，请提交 [Issue](https://github.com/jeikl/dingtalk-openclaw-connector-fix-Community/issues) 或 Pull Request。

---

## 许可证

本项目基于 [MIT](LICENSE) 许可证。

---

## 支持

- **问题反馈**：[GitHub Issues](https://github.com/jeikl/dingtalk-openclaw-connector-fix-Community/issues)
- **更新日志**：[CHANGELOG.md](CHANGELOG.md)

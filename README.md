<div align="center">
  <img alt="DingTalk" src="https://raw.githubusercontent.com/DingTalk-Real-AI/dingtalk-openclaw-connector/main/docs/images/dingtalk.svg" width="72" height="72" />
  <h1>dingtalk-openclaw-connector（社区维护版）</h1>
  <p>基于官方 <strong>v0.8.20</strong> 的社区维护版本，由社区持续跟进修复官方无暇处理的 Bug。<br/>
  功能与官方完全一致，拥有最快的修复速度，及时合并官方pr和个人发现的bug和社区急需的 Bug。</p>

  <p><strong>当前发布版：<a href="https://www.npmjs.com/package/@jeik/dingtalk-connector">@jeik/dingtalk-connector</a> v0.8.21-fix48</strong>（稳定生产可用；一键安装：`npx -y @jeik/dingtalk-connector install`；本地 tgz：`openclaw plugins install ./jeik-dingtalk-connector-0.8.21-fix48.tgz --force`）</p>

  <p>
    <a href="https://www.npmjs.com/package/@jeik/dingtalk-connector"><img src="https://img.shields.io/npm/v/@jeik/dingtalk-connector.svg?style=flat&colorA=18181B&colorB=28CF8D" alt="npm version" /></a>
    <a href="https://www.npmjs.com/package/@jeik/dingtalk-connector"><img src="https://img.shields.io/npm/dm/@jeik/dingtalk-connector.svg?style=flat&colorA=18181B&colorB=28CF8D&cacheSeconds=0" alt="npm downloads" /></a>
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

### 🚀 v0.8.21-fix48 · 2026-07-21（当前）

**主题：message 工具默认答案卡（可关）**

| | 改动 |
|--|------|
| ✨ **`messageAnswerCard`** | **默认 `true`**：message 正文走答案静态卡；`false` 恢复普通 text/markdown |
| 🔧 **注册** | `schema` + `openclaw.plugin.json`（channels / accounts / uiHints） |
| 📎 **独立** | 与会话流式 `answerCard` 分开；媒体消息仍普通通道 |

```bash
npx -y @jeik/dingtalk-connector install --force && openclaw gateway restart
```

### 📦 v0.8.21-fix47 · 2026-07-20

`file://` 本地图误判远程修复（不再 `fetch failed` 灰图）。

### 📦 v0.8.21-fix46 · 2026-07-20

本地 MD 图灰图诊断日志（LocalImage / MediaIdTrace）。

### 📦 v0.8.21-fix45 · 2026-07-20

图 + 下载链接单气泡 · 只认 `![]` · 引用卡片缓存 · residual 误报修复。

### 📦 v0.8.21-fix38 · 2026-07-20

message 远程 `media` 下载上传。

### 📦 v0.8.21-fix37 · 2026-07-20

本地图（含 `/mnt`）· `messageImageMd` · LocalImage 诊断日志。

---

### 更早版本（摘要）

| 日期 | 版本 / 要点 |
|------|-------------|
| 2026-07-14 | **fix31** — 流式串行队列防半截；双卡 `answerActToken`；错误中文映射；召唤 ACK；安装向导 accountId 推导；去掉 `cardToolVar`/`cardProcessVar` |
| 2026-06-29 | 答案卡 500 修复；阈值默认 500；延迟建卡；message 空卡修复；答案卡模式；工具进度展示；过程消息误终稿修复；安装向导增强 |
| 2026-06-28 | 上线 npm `@jeik/dingtalk-connector`；过程消息提前定稿修复 |
| 2026-05 | MD 直链/本地图；多轮刷屏；4.29+ 无文本输出；WebSocket 幻影重连 |

完整说明：[CHANGELOG.md](CHANGELOG.md) · [FIXES.md](FIXES.md) · [Release fix48](docs/RELEASE_NOTES_V0.8.21-fix48.md)

---

## ✨ 增强功能

- 🔧 Markdown 图片发送支持直链和本地路径（含 **`/mnt` 共享盘**、中文路径）：
  - 语法 `![注释](直链URL)` 或 `![注释](/绝对/本地路径)` → 自动上传 mediaId 后发出
  - **代码块 / 行内 code 内的路径不会上传**（参数说明原文保留）
  - 兼容已有 mediaId 格式
  - message 工具默认**文图分开**；可选 `messageImageMd: true` 在多图+文字时合并 markdown
  - ⚠️ 需引导 Agent 使用 markdown 发图时可用：

    ```
    请你把以下发送图片的方式写成你的钉钉图片发送skill，当涉及到图片发送，则调用该技能：用markdown语法发送图片，支持添加图片注释实现图文并茂；直链图片或本地路径文件均可直接嵌入markdown发送，如本地路径含空格请先重命名去除空格再发送。展示工具参数时请放在代码块中，避免被当作待发送图片。
    ```

- 🎨 支持自定义 AI Card 模板；**不填 `cardTemplateId` 时默认**社区增强模板 `0d2c84b3-12c1-473b-b14a-f329a7a102cd.schema`（含复制按钮等）。

### 最小配置（够跑）

```json
"channels": {
  "dingtalk-connector": {
    "enabled": true,
    "clientId": "你的clientId",
    "clientSecret": "你的clientSecret"
  }
}
```

未写的项走默认：流式卡 `0d2c84b3-…schema`、会话答案卡开、message 答案卡开、`messageImageMd=false`。

### 最大化配置（仅文档字段，值均为默认）

语义与「不配」时一致；按单 Agent / 多 Agent 两种写法。

**单 Agent（顶层凭证）：**

```json
"channels": {
  "dingtalk-connector": {
    "enabled": true,
    "clientId": "你的clientId",
    "clientSecret": "你的clientSecret",
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

**多 Agent（`accounts`，每个机器人一套凭证与卡片选项）：**

```json
"channels": {
  "dingtalk-connector": {
    "enabled": true,
    "defaultAccount": "main-bot",
    "accounts": {
      "main-bot": {
        "enabled": true,
        "name": "主机器人",
        "clientId": "主机器人clientId",
        "clientSecret": "主机器人clientSecret",
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
        "name": "引导机器人",
        "clientId": "引导机器人clientId",
        "clientSecret": "引导机器人clientSecret",
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

### 钉钉专属配置字段

| 字段 | 类型 | 默认 | 说明 |
|------|------|------|------|
| `clientId` | string \| number | — | 钉钉 AppKey / Client ID |
| `clientSecret` | string \| SecretRef | — | AppSecret |
| `accounts` | object | — | 多机器人；key 为账号 ID |
| `accounts.*.name` | string | — | 账号显示名 |
| `accounts.*.clientId` / `clientSecret` | — | — | 该机器人凭证 |
| `cardTemplateId` | string | `0d2c84b3-12c1-473b-b14a-f329a7a102cd.schema` | 会话流式 AI Card 模板 |
| `cardContentVar` | string | `"content"` | 流式卡内容变量名 |
| `answerCard` | boolean | **true** | 会话流式答案卡；`false` 关闭 |
| `answerActToken` | int | **500** | 答案卡 token 阈值：≤ 原卡定稿，> 另开答案卡 |
| `answerCardTemplateId` | string | `d246b7f5-1783-4e9b-bb46-bef52d63050e.schema` | 答案静态卡模板 |
| `messageAnswerCard` | boolean | **true** | message 工具正文走答案静态卡；`false`=普通消息 |
| `messageImageMd` | boolean | **false** | message 图文：`false` 文图分开；`true` 可合并 markdown |

> `answerCard` = 对话流式收尾；`messageAnswerCard` = message 工具外发。

---

## 🎯 回复标记 + 答案卡 + 工具进度（核心增强）

这套机制让钉钉侧的「过程 → 最终答案」渲染更干净、更稳定，规避钉钉流式 AI Card 的官方渲染 bug：

- **回复标记**：配合 [prompt-rewriter](https://www.npmjs.com/package/@jeik/prompt-rewriter) 注入的 `[-process-]`（过程段）/`[-final-]`（最终答案）标记。
  - 过程段逐字流式滚动；出现 `[-final-]` 后**停止流式、一次性定稿**（去掉钉钉"假流式回放"）。
  - 标记对用户**完全不可见**（进卡前统一剥离），且**优先级高于** OpenClaw 默认兜底——避免中间过程被误判成最终答案、提前停渲染。
  - 无标记时完全走 OpenClaw 默认逻辑。
- **答案卡模式**（默认开启）：最终答案 token 超过 `answerActToken`（默认 500）时，**原流式卡定格"✅ 思考完成"**，另投一张**静态答案卡**承载完整回复——规避钉钉流式卡 FINISHED 后仍抖动/重渲染的 bug。短答案仍在原卡定稿，不多开卡。
- **工具调用进度**：Agent 调用工具时，原卡流式显示 `🔧 正在调用工具：<工具名>`，工具结束后正常更新为回复。
- **工具失败不再误判**：工具调用失败的结果（带 `isError`/`isStatusNotice`）只在卡片短暂展示，**不会被当成最终答案**。

> 标记功能需安装并启用 prompt-rewriter 插件；答案卡/工具进度为连接器内置，开箱即用。

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
> **当前稳定版：`0.8.21-fix31`**（npm `latest` 已指向本版）。安装/更新后**必须** `openclaw gateway restart`。

### 方式一：npm（推荐）

包名：[`@jeik/dingtalk-connector`](https://www.npmjs.com/package/@jeik/dingtalk-connector)

**1）一键扫码安装**（推荐：创建机器人 → 取凭证 → 装插件 → 写配置）：

```bash
npx -y @jeik/dingtalk-connector install

# 已有 dingtalk-connector / 装不上时强制覆盖
npx -y @jeik/dingtalk-connector install --force
```

**2）只装插件**（凭证已配好，或走手动配置文档）：

```bash
openclaw plugins install @jeik/dingtalk-connector --force
openclaw gateway restart
```

**3）升级到最新版：**

```bash
openclaw plugins install @jeik/dingtalk-connector --force
openclaw gateway restart
```

### 方式二：本地 tgz / 源码构建（开发、离线、预发验证）

```bash
git clone https://github.com/jeikl/dingtalk-openclaw-connector-fix-Community.git
cd dingtalk-openclaw-connector-fix-Community
# 可选：钉到某次发布（这是 git tag，不是分支；clone 后可直接 checkout）
# git fetch --tags && git checkout v0.8.21-fix31

npm install && npm run build && npm pack
# → jeik-dingtalk-connector-0.8.21-fix31.tgz

openclaw plugins install ./jeik-dingtalk-connector-0.8.21-fix31.tgz --force
openclaw gateway restart
```

> 国内若 clone 慢，可用镜像前缀，例如：  
> `git clone https://ghfast.top/https://github.com/jeikl/dingtalk-openclaw-connector-fix-Community.git`

### 安装后自检

```bash
openclaw -v                    # OpenClaw ≥ 2026.4.9
openclaw plugins list          # 应看到 dingtalk-connector / @jeik/dingtalk-connector
# 发一条钉钉消息：应先出现「🦸 正在召唤大模型…」，再进入流式回复
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

<div align="center">
  <img alt="DingTalk" src="https://raw.githubusercontent.com/DingTalk-Real-AI/dingtalk-openclaw-connector/main/docs/images/dingtalk.svg" width="72" height="72" />
  <h1>dingtalk-openclaw-connector（社区维护版）</h1>
  <p>基于官方最新 <strong>v0.8.24</strong> 的社区增强版：吸收官方长连接改进，并重点优化消息接收、排队反馈与模型错误展示。<br/>
  保留社区在图片、答案卡、首响体验上的增强，持续修官方暂未覆盖的实际使用问题。</p>

  <p><strong>当前正式版：<a href="https://www.npmjs.com/package/@jeik/dingtalk-connector">@jeik/dingtalk-connector</a> v0.8.41</strong></p>

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

### 🚀 v0.8.41 · 2026-09-02（当前正式版）

**主题：跨环境彻底兼容 · 中止命令穿透 · dws 出站上下文**

| 版本 | 亮点 |
|------|------|
| v0.8.41 | 彻底消除 `import.meta` / 顶层 Await 跨 Node 版本与 jiti 的兼容问题 |
| v0.8.40 | 修复插件导入 SyntaxError（`Cannot use 'import.meta' outside a module`） |
| v0.8.39 | `/stop` 中止命令穿透入站队列，毫秒级终止长任务 |
| v0.8.33–35 | dws 发消息自动注入 `outbound_message` 上下文；outbound-runtime openclaw→jeikclaw 降级 |
| v0.8.32 | 安装向导可选 CLI（openclaw / jeikclaw）；manifest 版本自动同步 |
| v0.8.29–31 | 默认日志更轻；`debug` 配置统一开关；`incomplete_turn` 误报过滤 |

完整变更详见 [CHANGELOG.md](CHANGELOG.md)。

---

## 🚀 快速开始

### 要求

- **OpenClaw** 已安装并正常运行（[官网](https://openclaw.ai/)）
- **版本**：OpenClaw ≥ **2026.4.9**（`openclaw -v`）
- 与官方插件同 channel id（`dingtalk-connector`），`--force` 可直接覆盖，**无需先卸载**
- 安装/更新后**必须** `openclaw gateway restart`

包名：[`@jeik/dingtalk-connector`](https://www.npmjs.com/package/@jeik/dingtalk-connector)

> 💡 **强烈推荐搭配本仓库作者维护的 [JeikClaw](https://github.com/jeikl/openclaw-strontfix-feature)（OpenClaw 增强版）使用**：
>
> 官方 OpenClaw 更新到 **2026.8.1** 后插件无法正常使用（见 [issue #3](https://github.com/jeikl/dingtalk-openclaw-connector-fix-Community/issues/3)）。官方设计消耗长任务上下文、维护拖沓。
>
> JeikClaw 针对官方 **2026.7.1** 版本做了大面积 BUG 修复，并对任务管理、降级文案、长任务管理、上下文传递做了深度优化，且专门为**钉钉 / Telegram 做了适配**，还增加了：
> - 🎨 **思考过程 + 工具卡** 可视化（阶段卡落盘、折叠、多轮配色）
> - 🖼️ **图片识别内网 URL 支持**，以及 **OpenAI / Anthropic 接口的 URL 直传识别**
> - ⏹️ **/stop 命令穿透** 毫秒级终止长任务
>
> 安装：`npm install -g jeikclaw@latest`（与官方 `openclaw` 完全共存，独立 bin 命令）

> 🤖 **再推荐本仓库作者独立维护的 [JeikCode](https://github.com/jeikl/jeikcode)（极速、自主的终端 AI Coding Agent，Rust 驱动）**：
>
> 专为大型代码库与复杂业务打造，**更好的上下文管理 + 模型编程性能**，代码索引能力超越 Codex / Grok Build / Claude Code：
> - 📚 **CodeExplore 自研加权 AST + 中英双语语义检索** — 检索效率提升 **60–70%**、准确率 **90%+**，1 轮内精准命中核心代码，杜绝反复 grep 试错
> - 🧠 **严格 Append-Only KV Cache 保护** — `sacred_floor` 压缩保护 + `user-wrap.md` 动态末尾包裹，稳定上下文、节省成本
> - 🔧 **五级工具自愈链 + Loop Guard 熔断** — 陌生模型 JSON 自动修复、3 次失败强换方案，毫秒级参数自愈
> - ⚡ **跨模型极速编程** — 原生支持 OpenAI / Anthropic / 任意开源协议，4 档思考努力度随时切换（`/effort`）
> - 🖥️ **WebUI 控制台 + 远程 Serve** — 多实例无头运行，`/webui` 一键开启浏览器控制台
>
> 安装：`curl -fsSL https://raw.githubusercontent.com/jeikl/jeikcode/local-dev/scripts/install.sh | bash`（或 `cargo install --path crates/atomcode-cli --bin jeikcode --locked`），详见 [JeikCode README](https://github.com/jeikl/jeikcode)

### A）npx 一键扫码安装（按顺序试）

```bash
# 1）装最新
npx @jeik/dingtalk-connector install --force && openclaw gateway restart

# 2）若装到的不是最新，指定版本号
npx @jeik/dingtalk-connector@0.8.41 install --force && openclaw gateway restart

# 3）若仍装不了，强制走 npm 官方源
NPM_CONFIG_REGISTRY=https://registry.npmjs.org npx @jeik/dingtalk-connector@0.8.41 install --force && openclaw gateway restart
```

### B）只装插件（凭证已配好时，按顺序试）

```bash
# 1）装最新
openclaw plugins install @jeik/dingtalk-connector --force && openclaw gateway restart

# 2）若装到的不是最新，指定版本号
openclaw plugins install @jeik/dingtalk-connector@0.8.41 --force && openclaw gateway restart

# 3）若仍装不了，强制走 npm 官方源
NPM_CONFIG_REGISTRY=https://registry.npmjs.org openclaw plugins install @jeik/dingtalk-connector@0.8.41 --force && openclaw gateway restart
```

### 本地 tgz / 源码（开发、离线）

```bash
git clone https://github.com/jeikl/dingtalk-openclaw-connector-fix-Community.git
cd dingtalk-openclaw-connector-fix-Community
npm install && npm run build && npm pack
openclaw plugins install ./jeik-dingtalk-connector-0.8.41.tgz --force && openclaw gateway restart
```

### 安装后自检

```bash
openclaw -v                    # ≥ 2026.4.9
openclaw plugins list          # 应看到 dingtalk-connector / @jeik/dingtalk-connector
# 发一条钉钉消息：应先「正在召唤大模型…」，再流式/答案卡
```

---

## ⚙️ 配置

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

> **最大化配置 ≡ 最小化配置。** 下面只是把默认值显式写出来，方便对照字段含义；效果与只填凭证的最小配置相同，生产环境直接用最小配置即可。

### 最大化配置（展示用，默认值写全）

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
| `debug` | boolean | **false** | 详细诊断日志（连接/图片 mediaId/引用回填/队列）。**日常关闭**；排障时顶层或某账号设 `true`，改完 `openclaw gateway restart` |

> `answerCard` = 对话流式收尾；`messageAnswerCard` = message 工具外发。

**临时开排障日志示例：**

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

## ✨ 增强功能

### 🖼️ 图片发送：全面修复与增强

> 🔥 **毫无死角** · 混合发图 · 全面碾压官方薄弱的图片机制  
> ✅ 对话发图 · ✅ message 直发 · ✅ markdown 嵌图 · ✅ 文图可分可合

对官方图片发送做了**全路径修复增强**，多通道混合发图，全部显示正常：

| | 发送方式 | 能力 |
|--|----------|------|
| 💬 | **普通对话回复** | Agent 用 `![注释](…)` 嵌图，定稿前自动上传 mediaId |
| 📤 | **message · mediaUrl** | 机器人主动触发直发（本地 / 内网 / 公网） |
| 📝 | **message · markdown 正文** | 正文嵌 `![](…)`（本地 / `file://` / 直链）与文字同条 |
| ⚙️ | **文图策略可配** | 默认 📎 **分开**；`messageImageMd: true` → 🧩 **合并**一条 markdown |

#### 🌐 路径与协议全覆盖

| | 类型 | 示例 |
|--|------|------|
| 🌍 | 公网直链 | `https://…` |
| 🏠 | 内网直链 | `http://内网主机/…` |
| 📁 | 本地绝对路径 | `/tmp/…` · `/root/…` |
| 💾 | **`/mnt` 挂载盘** | 中文目录 · 共享盘 · SMB |
| 🔗 | `file://` URI | `file:///mnt/…` · `file:///tmp/…` |
| 🆔 | 已有 mediaId | `@lADP…` |

#### 🛡️ 细节兜底

- 📦 代码块 / 行内 code 路径 **不会误上传**（参数说明原文保留）
- ⬇️ 远程图 **先下载再上传**；本地失败会 **`/tmp` 重试**
- 🫧 图 + 下载链接 **同泡共存**：`![]` → mediaId，下载 URL 仍是原链

### 🎨 AI Card 模板

- ✨ 支持自定义流式卡；**不填 `cardTemplateId` 默认**  
  `0d2c84b3-12c1-473b-b14a-f329a7a102cd.schema`（含 📋 复制按钮等）

### 🎯 回复标记 + 答案卡 + 工具进度

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
| 基础版本 | 对齐官方 **v0.8.24** 长连接能力，并叠加本仓库独有优化 |
| 修复内容 | 连接假死、消息丢失、错误卡卡住、图片灰图等实际使用问题 |
| 维护方式 | 社区维护，持续跟进官方更新 |

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

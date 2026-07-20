# Release Notes — v0.8.21-fix37（2026-07-20）

生产稳定版 / Production-stable community build of `@jeik/dingtalk-connector`.

## 安装 / Install

```bash
# 一键扫码安装 / 升级（推荐，npm latest）
npx -y @jeik/dingtalk-connector install --force

# 仅装插件
openclaw plugins install @jeik/dingtalk-connector --force
openclaw gateway restart
```

本地 tgz：

```bash
openclaw plugins install ./jeik-dingtalk-connector-0.8.21-fix37.tgz --force
openclaw gateway restart
```

## 本版要点 / Highlights

| 领域 | 说明 |
|------|------|
| MD 本地图 | 支持 **`/mnt` 及任意绝对路径**、中文文件名；上传失败会拷贝到 `/tmp` 重试 |
| 代码块保护 | 围栏 / 行内 code 中的路径与 mediaId **不会**被 `processLocalImages` 改写 |
| message 图文 | 配置 **`messageImageMd`**（默认 `false`）：文图分开；`true` 时仅多图+文字合并 markdown |
| 诊断 | **`[DingTalk][LocalImage]`** 全链路日志，**无需** `debug: true` |
| message 外发 | 默认普通消息（`useAICard: false`），避免卡片 mediaId 渲染不稳 |

## 配置示例 / Config

```json
{
  "channels": {
    "dingtalk-connector": {
      "enabled": true,
      "clientId": "...",
      "clientSecret": "...",
      "messageImageMd": false,
      "debug": false
    }
  }
}
```

### `messageImageMd`

| 值 | 行为 |
|----|------|
| `false`（默认） | message 工具：先文字、后独立图片消息 |
| `true` | 正文里**已有图** + 再带 `media` 时合并一条 markdown；单张图文 / 纯媒体仍分开 |

## 升级注意 / Upgrade notes

- 从 fix31～fix36 升级：直接 `--force` 安装即可。
- 若仍见本地图问题：看日志前缀 `[DingTalk][LocalImage]`（匹配 / 是否 inCode / exists / OAPI / tmp 重试）。
- 共享盘路径须对 **gateway 进程用户** 可读（`ls` 同用户验证）。

## 与上游 / OpenClaw

本版只改**钉钉渠道插件**。下列能力仍依赖 **OpenClaw 核心**（未在本包内）：

- image 工具 SSRF / 内网直链 / `imageUrl` 混合投递
- image 工具 `localRoots` 工作区外路径
- message 工具 delivery-mirror 是否进模型上下文
- Gateway 假死 / stuck session 自愈

详见仓库内排查与后续方案说明。

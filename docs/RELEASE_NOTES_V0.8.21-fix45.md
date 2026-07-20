# Release Notes — v0.8.21-fix45（2026-07-20）

生产稳定版 / Production-stable community build of `@jeik/dingtalk-connector`.

## 安装 / Install

```bash
npx -y @jeik/dingtalk-connector install --force
openclaw gateway restart
```

本地 tgz：

```bash
openclaw plugins install ./jeik-dingtalk-connector-0.8.21-fix45.tgz --force
openclaw gateway restart
```

## 本版要点 / Highlights

| 领域 | 说明 |
|------|------|
| 图 + 下载链接 | `![](http://…)` **下载上传为 mediaId**；正文「下载链接：http://…」**保留原 URL、同一条消息** |
| 只认 `![]()` | 不扫裸路径；代码块内路径不上传 |
| 误报修复 | AI 终稿代码块里举例 `/tmp/...` **不再**报「仍含本地路径 MD 图」 |
| 引用 AI 卡 | 定稿缓存正文，引用时 `CardCache` 回填 |
| message media | `media: "https://..."` 下载再上传（含自 fix38） |

## 问题与修复对照

### 下载链接变成 `@lADP…`

**原因：** 钉钉 `sampleMarkdown` 在「`![](同一 http)` + 正文同一 URL」时会把下载位改写成 mediaId。  

**修复：** 先把 `![](http)` 换成 `![](@mediaId)`，下载链接仍写原 URL 且与图同泡。

### closeStreaming 误报灰图

**原因：** 终稿里代码块示例含 `![x](/tmp/...)`，旧正则未跳过代码块。  

**修复：** 只检查代码块外的本地 `![]`。

## 升级

从 fix37～fix44 直接 `--force` 安装即可。

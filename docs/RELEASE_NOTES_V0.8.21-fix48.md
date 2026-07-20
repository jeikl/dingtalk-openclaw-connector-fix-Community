# Release Notes — v0.8.21-fix48（2026-07-21）

生产稳定版 / Production-stable community build of `@jeik/dingtalk-connector`。

## 安装 / Install

```bash
npx -y @jeik/dingtalk-connector install --force
openclaw gateway restart
```

本地 tgz：

```bash
openclaw plugins install ./jeik-dingtalk-connector-0.8.21-fix48.tgz --force
openclaw gateway restart
```

## 本版要点 / Highlights

| 领域 | 说明 |
|------|------|
| **message 答案卡** | 新增配置 **`messageAnswerCard`（默认 `true`）**：message 工具正文默认走**答案静态卡** |
| 模板 | 使用 `answerCardTemplateId` 或内置答案卡模板；`skipInputingWalk` 直接 FINISHED |
| 降级 | 建卡失败 → 自动普通 text/markdown |
| 关闭 | `"messageAnswerCard": false` 恢复旧行为（普通消息） |
| 注册 | `schema.ts` + `openclaw.plugin.json`（channels / accounts / uiHints） |
| 独立 | 与会话流式 **`answerCard`** 互不影响；图/音/视/文件仍走普通通道 |

## 配置示例

```json
"channels": {
  "dingtalk-connector": {
    "messageAnswerCard": true,
    "answerCardTemplateId": "可选-自定义答案卡模板.schema"
  }
}
```

关闭 message 答案卡：

```json
"messageAnswerCard": false
```

### 钉钉专属字段（文档）

见 README 最小/最大化配置与字段表：

- 凭证 / `accounts`（name、clientId、clientSecret）
- `cardTemplateId`（默认 `0d2c84b3-12c1-473b-b14a-f329a7a102cd.schema`）/ `cardContentVar`（默认 `content`）
- `answerCard` / `answerActToken`（500）/ `answerCardTemplateId`
- `messageAnswerCard`（true）/ `messageImageMd`（false）

## 日志

```text
[DingTalk][MessageCard] sendTextToDingTalk | messageAnswerCard=true useAICard=true tpl=...
[DingTalk][MessageCard] AI Card 发送成功 | outTrack=card_... skipInputing=true
```

## 含此前修复

- fix47：`file://` 本地图不再误判远程  
- fix46：LocalImage / MediaIdTrace 诊断日志  
- fix45：图+下载同泡、只认 `![]`、CardCache、residual 误报  

## 升级

从任意 fix37+ 直接 `--force` 安装即可。

# Release Notes — v0.8.21-fix39（2026-07-20）

## 安装

```bash
npx -y @jeik/dingtalk-connector install --force
openclaw gateway restart
```

## 本版修复

### 1. 下载链接被替换成 mediaId

**复现：**

```json
{
  "action": "send",
  "message": "…\n\n![AKG](http://host/path/a.jpg)\n\n下载链接：http://host/path/a.jpg"
}
```

MD 图正常显示，但「下载链接：」后变成 mediaId。

**根因：**

- `BARE_IMAGE_PATH_RE` 的 Windows 盘符 `[A-Za-z]:[\\/]` 会把 `http://` 匹配成 `p://…`、`https://` 匹配成 `s://…`
- 行内「下载链接：/本地路径」也会被当裸图路径上传替换

**修复：**

- 盘符匹配加 `(?<![A-Za-z])`
- `looksLikeRemoteUrl` 拦截
- 仅**独占一行**的本地路径才自动转图

### 2. 引用 AI/交互卡片看不到内容

**现象：** 用户引用机器人 AI 卡片再提问时，模型侧只有：

```text
[引用] [interactiveCard消息]
```

**原因（钉钉侧限制）：**  
引用 AI 卡片时，回调里的 `repliedMsg` 几乎总是：

```json
{ "msgType": "interactiveCard", "content": { "templateId": "..." } }
```

**不带卡片上显示的正文**，插件无法从载荷直接解析出答案。

**修复（插件侧缓存回填）：**

1. 机器人 `finishAICard` 定稿时把 `outTrackId → 终稿正文` 写入内存缓存（带会话 ID）  
2. 收到引用时：先抠载荷字段；没有则按 outTrackId / **同会话最近一张卡**回填  
3. 仍未命中：日志 dump `repliedMsg`（`[DingTalk][Quote]`），并给出明确占位文案  

**限制：**

- 缓存在 **gateway 进程内存**，重启后丢失  
- 只能回填 **本插件发出并定稿** 过的卡；别人的卡 / 重启前的卡仍可能无正文  
- 双卡模式：答案在「答案卡」上，引用原「思考完成」卡时可能只回填到思考完成文案

# 剩余工作清单（指针）

完整 backlog（防上下文截断）：

**`/root/src/OPENCLAW_DINGTALK_REMAINING_WORK.md`**

（若只克隆本插件仓，可向维护者索取，或见上级 monorepo。）

## 本插件（钉钉侧）· 已修至 fix49

图 / message 出站主路径已闭环，**勿再当未修 BUG**：

- 对话 / message markdown：`![]` 本地、`file://`、`/mnt`、公网/内网直链 → mediaId  
- message `media`/`mediaUrl`：远程下载再上传；无扩展名默认 image  
- 图+下载同泡；代码块不误传；`messageImageMd` / `messageAnswerCard`  
- 默认流式卡 `0d2c84b3-…schema`，`cardContentVar=content`

可选未闭环：远程 fetch **SSRF** 与核心策略对齐（依赖 OpenClaw）。

## 仍属 OpenClaw 核心（勿在本仓硬改）

1. ~~**OC-4**~~ **本机已落地**（主文档 §2.1.9）：`deliveryContext` + 人话出站记录 + 钉钉 `inferTargetChatType`（裸 id → direct）  
2. image 工具 `imageUrl` 混合投递 / SSRF allowlist / `localRoots`  
3. Gateway 假死 / stuck session 看门狗  

详见主文档 §2～§4。

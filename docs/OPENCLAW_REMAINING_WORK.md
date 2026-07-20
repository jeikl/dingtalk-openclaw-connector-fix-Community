# 剩余工作清单（指针）

完整、防上下文截断的 backlog 写在仓库外主工作区：

**`/root/src/OPENCLAW_DINGTALK_REMAINING_WORK.md`**

（若你克隆的是本插件仓 alone，可向维护者索取该文档，或见上级 monorepo。）

## 本插件 fix38 已修

- message 工具 `media: "https://..."`：下载临时文件 → 上传钉钉；无扩展名图床默认 image；photoURL 兜底。

## 仍属 OpenClaw 核心（勿在本仓硬改）

1. image 工具 `imageUrl` 混合投递 / SSRF allowlist / `localRoots`
2. message delivery-mirror 是否进模型上下文
3. Gateway 假死 / stuck session 看门狗

详见主文档 §3～§5。

# Release Notes — v0.8.21-fix38（2026-07-20）

生产稳定版 / Production-stable community build of `@jeik/dingtalk-connector`.

## 安装 / Install

```bash
npx -y @jeik/dingtalk-connector install --force
openclaw gateway restart
```

本地 tgz：

```bash
openclaw plugins install ./jeik-dingtalk-connector-0.8.21-fix38.tgz --force
openclaw gateway restart
```

## 本版要点 / Highlights

| 领域 | 说明 |
|------|------|
| message 远程 media | `media: "https://..."` **下载到临时文件 → 上传钉钉 media**，修复「文件不存在 / 媒体文件上传失败」 |
| 无扩展名图床 | `picsum.photos/seed/...` 等默认 **image**，不再拆出错误扩展名当 file |
| 兜底 | 下载或再上传失败时，图片尝试 **photoURL 直链** |
| 诊断 | 前缀 **`[DingTalk][RemoteMedia]`** |

## 复现与修复对照

**旧（fix37 及更早）日志：**

```text
文件扩展名: photos/seed/test/200/200
媒体类型判断完成: file
uploadMedia type=file 失败:文件不存在 | https://picsum.photos/...
⚠️ 媒体文件上传失败
```

**新期望：**

```text
[DingTalk][RemoteMedia] 开始下载 | https://...
[DingTalk][RemoteMedia] 下载成功 | bytes=... tmp=/tmp/dingtalk-remote-....png
uploadMedia type=image ... 成功
[DingTalk][RemoteMedia] 已清理临时文件
```

## 代码入口

- `src/services/messaging.ts`：`downloadRemoteMediaToTemp` / `resolveMediaSourceToLocalFile` / `sendMediaToDingTalk`
- 测试：`tests/outbound/outbound-routing.test.ts`（远程下载上传、下载失败 photoURL 兜底）

## 与上游 / OpenClaw

本版只改**钉钉渠道插件**。核心侧仍待：

- image 工具 SSRF / `imageUrl` 混合投递 / `localRoots`
- message delivery-mirror 是否进模型上下文
- Gateway 假死 / stuck session 自愈

完整 backlog（防上下文丢失）：仓库外若维护 `OPENCLAW_DINGTALK_REMAINING_WORK.md`，以其为准。

## 升级注意

- 从 fix37 直接 `--force` 安装即可。
- 远程 media 会由 gateway 进程发起出站 HTTP 下载；企业环境需放行目标图床域名。
- 暂未与 OpenClaw 核心 SSRF policy 强制对齐（后续可选）。

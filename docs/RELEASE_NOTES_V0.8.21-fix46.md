# Release Notes — v0.8.21-fix46（2026-07-20）

生产稳定版 / Production-stable community build of `@jeik/dingtalk-connector`。

在 **fix45** 行为不变的基础上，补强 **message 本地 MD 图** 诊断日志，方便排查灰图。

## 安装 / Install

```bash
npx -y @jeik/dingtalk-connector install --force
openclaw gateway restart
```

本地 tgz：

```bash
openclaw plugins install ./jeik-dingtalk-connector-0.8.21-fix46.tgz --force
openclaw gateway restart
```

## 本版要点 / Highlights

| 领域 | 说明 |
|------|------|
| 诊断日志 | always-on 本地图流水线：匹配 → exists → 上传 → API 前 payload → residual |
| MediaIdTrace | `mdImgs=[local:…\|mediaId:…]`、`residualLocal`、preview |
| 业务逻辑 | **与 fix45 相同**（图+下载同泡、只认 `![]`、代码块跳过、CardCache） |

## 查灰图时看哪些行

```text
[DingTalk][LocalImage] sendTextToDingTalk 入口 | ...
[DingTalk][LocalImage] processImagesForOutbound 扫描 ![]() | #1 kind=local exists=...
[DingTalk][LocalImage] processImagesForOutbound 本地→mediaId 成功 | ... → @lADP...
[DingTalk][MediaIdTrace] sendTextToDingTalk:API前 | mdImgs=[mediaId:@lADP...] residualLocal=0
```

- `kind=local` 但 `exists=false` → 路径在 gateway 机上不存在  
- 上传失败 → 会看到失败提示 / fallback 第2次  
- API前仍是 `local:/tmp/...` 或 `residualLocal>0` → 未换成 mediaId  
- API前已是 `mediaId:@lADP...` 仍灰 → 偏钉钉渲染/账号侧

## 升级

从 fix45 直接 `--force` 安装即可。

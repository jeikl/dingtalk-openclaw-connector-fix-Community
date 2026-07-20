# Release Notes — v0.8.21-fix40（2026-07-20）

## 安装

```bash
npx -y @jeik/dingtalk-connector install --force
# 或
openclaw plugins install ./jeik-dingtalk-connector-0.8.21-fix40.tgz --force
openclaw gateway restart
```

## 问题

发：

```text
![AKG](http://host/.../akg.jpg)

下载链接：http://host/.../akg.jpg
```

钉钉里变成：

```text
￼（图正常）
下载链接：@lADPM1lnKk_jR1_ND8DNC9A
```

## 根因

1. 插件 `processLocalImages` **不会**上传远程 http 图（fix39 已修 Windows 盘符误匹配）。  
2. 但发 **sampleMarkdown** 时，**钉钉侧**仍会把正文里**裸的图片 URL**（含「下载链接：」后那串）改写成 mediaId。  
3. 所以只靠「插件不上传」不够，必须让下载位的 URL **看起来不像可被自动转 media 的裸图链**。

## 修复

| 策略 | 行为 |
|------|------|
| `protectBareHttpImageUrls` | `![]()` / code 外的裸图 URL **套反引号** `` `http://...` `` |
| 下载语境 | 含「下载/链接/download」的行（或上一行）本地路径 **不转图** |
| MD 本地图上传后 | 其余同路径写成 `https://down.dingtalk.com/media/...`，不写 `@mediaId` |

期望效果：

```text
![AKG](http://...)   → 图正常
下载链接：`http://...`  → 可复制原文，不再变成 @lADP...
```

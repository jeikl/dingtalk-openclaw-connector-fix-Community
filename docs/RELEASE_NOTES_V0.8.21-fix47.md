# Release Notes — v0.8.21-fix47（2026-07-20）

## 安装 / Install

```bash
npx -y @jeik/dingtalk-connector install --force
openclaw gateway restart
```

## 修复 / Fixed

### `file://` MD 本地图灰图

**现象（fix46 日志）：**

```text
扫描 ![]() | #2 kind=http path=file:///mnt/smb/...
processImagesForOutbound 远程图 | file:///mnt/...
远程图下载异常 | fetch failed
localTried=0 remoteTried=3
API前 mdImgs 仍含 http:file:///...
```

**原因：** `looksLikeRemoteUrl` 把任意含 `://` 的字符串当远程；`isLocalImageRef` 又先调用它，`file://` 永远进不了本地上传。

**修复：** `file://` / `MEDIA:` / `attachment://` 优先判本地 → `toLocalPath` → 上传 mediaId。

裸绝对路径 `/mnt/...`、`/tmp/...` 本来就正常；本版修的是 **带 `file://` 前缀** 的写法。

## 升级

从 fix46 直接 `--force` 安装。

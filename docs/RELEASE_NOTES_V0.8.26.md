# RELEASE NOTES - V0.8.26 (正式版)

**发布日期**: 2026-07-25

---

## 🚀 核心更新

### 1. 目标 ID 恢复约束强化 (Target ID Prompt Constraints)
- 🎯 **出站消息 target ID 保留后缀与大小写约束**: 强化消息转发/回复场景下的 ID 指引，强调完整保留 Base64 / 特殊符号后缀（如 `==`、`=`）与字母大小写，避免模型在调用 `message` 工具时因裁剪符号导致投递失败。

---

## 📦 安装与升级

```bash
npm install -g @jeik/dingtalk-connector@0.8.26
```

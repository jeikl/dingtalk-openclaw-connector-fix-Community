# RELEASE NOTES - V0.8.25 (正式版)

**发布日期**: 2026-07-24

---

## 🚀 核心更新

### 1. 发送人身份强化与岗位信息 (Sender Identity & Job Title)
- ✨ **前置发送人身份全量信息**: 消息发送推给 Agent 时，自动通过通讯录 API 拉取并附带发送人的真名、**岗位 (Title)**、入职时间、角色（老板/主管）等信息，便于 Agent 更精准识别与响应。

### 2. 目标解析与类型推导优化 (Targets & Routing)
- 🐛 **无前缀裸钉钉 ID 推导修复**: 当传入没有显式类型前缀的钉钉用户 ID 时，自动正确推导为 `direct`（单聊）类型，避免解析失败或报错。

### 3. 消息处理器与发送工具优化 (Message Handler & Utilities)
- 🛠️ 优化消息处理器底层管道与异步调度。
- 📦 升级包定义与依赖更新。

---

## 📦 安装与升级

```bash
npm install -g @jeik/dingtalk-connector@0.8.25
```

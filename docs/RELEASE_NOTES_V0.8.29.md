# Release Notes · v0.8.29

**发布日期：** 2026-07-25  
**npm：** `@jeik/dingtalk-connector@0.8.29`  
**定位：** 正式加固版（日志 / 排障 / 文档）

---

## 一句话

默认日志更干净；排障只需配置 `"debug": true`。连接、消息、错误卡能力继承 0.8.28。

---

## 本版变更

1. **默认静默** — 无图正常回复不再刷 LocalImage / MediaIdTrace / CardCache  
2. **debug 配置** — 打开后输出连接、图片 mediaId、引用回填、队列等详细日志（无需环境变量）  
3. **文档** — 安装改为三条递进命令（最新 → 指定版本 → 官方源）

---

## 排障

```json
"channels": {
  "dingtalk-connector": {
    "debug": true
  }
}
```

改完后：`openclaw gateway restart`。用完请改回 `false`。

---

## 安装

**npx（一键扫码，按顺序试）：**

```bash
# 1）装最新
npx @jeik/dingtalk-connector install --force && openclaw gateway restart

# 2）若不是最新，指定版本
npx @jeik/dingtalk-connector@0.8.29 install --force && openclaw gateway restart

# 3）仍失败时走 npm 官方源
NPM_CONFIG_REGISTRY=https://registry.npmjs.org npx @jeik/dingtalk-connector@0.8.29 install --force && openclaw gateway restart
```

**openclaw plugins install（只装插件，按顺序试）：**

```bash
# 1）装最新
openclaw plugins install @jeik/dingtalk-connector --force && openclaw gateway restart

# 2）若不是最新，指定版本
openclaw plugins install @jeik/dingtalk-connector@0.8.29 --force && openclaw gateway restart

# 3）仍失败时走 npm 官方源
NPM_CONFIG_REGISTRY=https://registry.npmjs.org openclaw plugins install @jeik/dingtalk-connector@0.8.29 --force && openclaw gateway restart
```

---

## 建议验收

1. 默认：纯文本对话日志无 LocalImage / MediaIdTrace 刷屏  
2. `"debug": true` 重启后：可见图片/引用类详细日志  
3. 模型 503：错误卡中文定稿，不永久转圈  
4. 任务进行中再发：有排队/处理中反馈  

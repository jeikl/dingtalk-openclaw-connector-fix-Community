# 媒体处理模块测试方案

## 1. 模块划分与职责

- **toLocalPath(raw: string): string**  
  去掉 `file://`、`MEDIA:`、`attachment://` 前缀，再对结果做 `decodeURIComponent`；解码失败则保持原样。
- **processLocalImages(content, oapiToken, log)**  
  **只**处理明确的 `![](local)`（代码块内跳过）；**不**扫裸路径。  
  同一 `![]` target 在正文其它位置再出现 → `protectNonImageOccurrencesOfTargets`。  
  无 token 直接返回 content。
- **uploadMediaToDingTalk**  
  依赖 fs/axios；单元测试覆盖 toLocalPath / processLocalImages 控制流。

## 2. toLocalPath 用例表（覆盖核心分支）

| 序号 | 输入 raw | 期望输出 | 说明 |
|------|----------|----------|------|
| 1 | `'file:///tmp/image.png'` | `'/tmp/image.png'` | file:// 前缀 |
| 2 | `'file:///C:/Users/a.png'` | `'/C:/Users/a.png'` | file:// Windows 风格 |
| 3 | `'MEDIA:/var/folders/ab/cd/image.png'` | `'/var/folders/ab/cd/image.png'` | MEDIA: |
| 4 | `'attachment:///Users/test/image.png'` | `'/Users/test/image.png'` | attachment:// |
| 5 | `'/Users/测试/图片%20一.png'` | `'/Users/测试/图片 一.png'` | URL 解码 %20 |
| 6 | `'/tmp/a.png'` | `'/tmp/a.png'` | 无前缀，原样 |
| 7 | `''` | `''` | 空字符串 |
| 8 | 非法 % 导致 decodeURIComponent 抛错 | 原样返回 | 容错 |

## 3. processLocalImages 用例表（覆盖核心控制流）

| 序号 | content | oapiToken | 期望 | 说明 |
|------|---------|-----------|------|------|
| 9 | 任意 | null | 返回 content 不变，log.warn | 无 token 跳过 |
| 10 | `''` | 'tok' | `''` | 空内容 |
| 11 | `'no image'` | 'tok' | `'no image'` | 无匹配 |
| 12 | 含 `![alt](path)` 且上传成功 | 'tok' | path 替换为 media_id | 需 mock 上传 |

## 4. 预期正确输出与潜在错误

- **正确**：toLocalPath 仅去已知前缀并解码，无前缀或解码异常则不变；processLocalImages 在 token 为空时原样返回并 warn。
- **错误原因**：replace 前缀时误删路径内容；decode 未 try-catch；processLocalImages 无 token 时仍尝试上传。

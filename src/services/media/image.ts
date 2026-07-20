/**
 * 图片处理模块
 * 支持图片上传、本地路径处理
 *
 * 注意：与 services/media.ts 中 processLocalImages 保持同一策略：
 * - 匹配全部 ![]()，本地路径（含 /mnt）上传为 mediaId
 * - 上传失败则 /tmp 重试，仍失败则移除本地路径避免灰图
 */

// 本地类型定义
interface Logger {
  info?: (...args: any[]) => void;
  warn?: (...args: any[]) => void;
  error?: (...args: any[]) => void;
  debug?: (...args: any[]) => void;
  [key: string]: any;
}

/**
 * 直接复用 media.ts 权威实现，避免 reply 路径与 message 路径两套逻辑分叉。
 */
export async function processLocalImages(
  content: string,
  oapiToken: string | null,
  log?: Logger,
): Promise<string> {
  const { processLocalImages: impl } = await import("../media.ts");
  return impl(content, oapiToken, log);
}

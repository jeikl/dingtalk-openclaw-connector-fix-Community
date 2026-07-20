/**
 * 钉钉媒体处理
 * 支持图片、视频、音频、文件的上传和下载
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
// form-data 是 CJS 模块，静态 import 可确保 jiti/ESM 环境下 CJS 互操作行为稳定，
// 避免动态 import 时 .default 偶发为 undefined 导致 "Cannot read properties of undefined (reading 'registry')"
import FormData from 'form-data';
import type { DingtalkConfig } from '../types/index.ts';
import { DINGTALK_OAPI, getOapiAccessToken } from '../utils/index.ts';
import { dingtalkHttp, dingtalkOapiHttp } from '../utils/http-client.ts';


/** 文本文件扩展名 */
export const TEXT_FILE_EXTENSIONS = new Set([
  '.txt',
  '.md',
  '.json',
  '.yaml',
  '.yml',
  '.xml',
  '.html',
  '.css',
  '.js',
  '.ts',
  '.py',
  '.java',
  '.c',
  '.cpp',
  '.h',
  '.sh',
  '.bat',
  '.csv',
]);

/** 图片文件扩展名 */
export const IMAGE_EXTENSIONS = /\.(png|jpg|jpeg|gif|bmp|webp|tiff|svg)$/i;

/**
 * Markdown 图片语法 ![alt](path) — 捕获所有 path，是否本地由 isLocalImageRef 判断。
 * 注意：旧版只匹配 /tmp|/home|/root 等前缀，**漏掉 /mnt 共享盘**，导致 message 工具 MD 灰图。
 */
export const LOCAL_IMAGE_RE = /!\[([^\]]*)\]\(([^)]+)\)/g;

/** 是否像远程 URL 或其截断片段（禁止当本地路径上传） */
export function looksLikeRemoteUrl(raw: string): boolean {
  const p = (raw || "").trim();
  if (!p) return false;
  if (/^https?:\/\//i.test(p)) return true;
  if (/^[a-z]:\/\//i.test(p) && !/^[a-z]:[\\/][^/\\]/i.test(p)) return true;
  if (p.includes("://")) return true;
  return false;
}

/**
 * 治本原则（与「代码块内不转 mediaId」同一类）：
 *
 * 1. **只处理明确的 `![](target)`**（本地上传；远程可下载后上传）。
 * 2. **绝不扫描裸路径**。
 * 3. 同一 target 在 `![]` 外再出现：从 markdown 正文**剥离**，交给调用方用 **text 消息**另发
 *    （日志已证明：插件出站无 mediaId 时，钉钉 sampleMarkdown 仍会把同 URL 吃成 mediaId；
 *    反引号不够，必须拆成非 markdown 的 text 气泡）。
 */
export function stripNonImageOccurrencesOfTargets(
  content: string,
  targets: string[],
): { body: string; stripped: string[] } {
  if (!content || !targets.length) return { body: content, stripped: [] };

  const uniq = [...new Set(targets.map((t) => t.trim()).filter((t) => t.length >= 2))].sort(
    (a, b) => b.length - a.length,
  );
  const stripped: string[] = [];
  let out = content;

  for (const original of uniq) {
    // 同时剥掉反引号包裹形式
    const variants = [original, `\`${original}\``];
    for (const variant of variants) {
      let from = 0;
      const codeRanges = getMarkdownCodeRanges(out);
      while (from < out.length) {
        const idx = out.indexOf(variant, from);
        if (idx < 0) break;
        // 在 ]( 内 = 仍是 markdown 链接/图片 target → 保留
        if (out.slice(Math.max(0, idx - 2), idx) === "](") {
          from = idx + variant.length;
          continue;
        }
        if (isIndexInCodeRange(idx, codeRanges) && !variant.startsWith("`")) {
          from = idx + variant.length;
          continue;
        }
        console.log(
          `[DingTalk][MediaIdTrace] strip 非图重复 target | idx=${idx} remove=${variant.slice(0, 100)}`,
        );
        if (!stripped.includes(original)) stripped.push(original);
        out = out.slice(0, idx) + out.slice(idx + variant.length);
        // 清掉残留的空「下载链接：」类前缀行由调用方整理；此处只去 target
        from = idx;
      }
    }
  }

  // 收尾：连续空行压成最多两个换行；去掉行尾多余空白
  out = out
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[：:]\s*$/gm, "")
    .trim();

  if (stripped.length) {
    console.log(
      `[DingTalk][MediaIdTrace] strip 完成 | stripped=${stripped.length} bodyLen=${out.length}`,
    );
  }
  return { body: out, stripped };
}

/** @deprecated 名称保留；内部改为 strip（拆 text 另发），不再原地反引号 */
export function protectNonImageOccurrencesOfTargets(
  content: string,
  targets: Array<{ original: string; replaceWith?: string }>,
): string {
  // 兼容旧调用：若带 replaceWith 则替换；否则 strip 并… 仅返回 body（丢失 stripped）
  // 新代码请用 stripNonImageOccurrencesOfTargets
  const withUrl = targets.filter((t) => t.replaceWith);
  let out = content;
  for (const t of withUrl) {
    const o = t.original?.trim();
    const w = t.replaceWith!;
    if (!o) continue;
    let from = 0;
    while (from < out.length) {
      const idx = out.indexOf(o, from);
      if (idx < 0) break;
      if (out.slice(Math.max(0, idx - 2), idx) === "](") {
        from = idx + o.length;
        continue;
      }
      out = out.slice(0, idx) + w + out.slice(idx + o.length);
      from = idx + w.length;
    }
  }
  const { body } = stripNonImageOccurrencesOfTargets(
    out,
    targets.map((t) => t.original),
  );
  return body;
}

/** 判断 markdown 图片 target 是否为需要上传的本地路径（非 http(s)/mediaId） */
export function isLocalImageRef(rawPath: string): boolean {
  const p = (rawPath || "").trim();
  if (!p) return false;
  // 已是远程 URL 或钉钉 mediaId（@ 开头）→ 不上传
  if (looksLikeRemoteUrl(p) || /^https?:\/\//i.test(p)) return false;
  if (p.startsWith("@") && !p.includes("/") && !p.includes("\\")) return false;
  if (p.startsWith("file://") || p.startsWith("MEDIA:") || p.startsWith("attachment://")) {
    return true;
  }
  // Unix 绝对路径 / Windows 盘符
  if (p.startsWith("/") || /^[A-Za-z]:[\\/]/.test(p)) {
    // 有图片后缀，或路径中明显是文件（含扩展名）
    if (IMAGE_EXTENSIONS.test(p.split("?")[0] || p)) return true;
    // 无扩展名也尝试（部分本地引用）
    return !p.includes("://");
  }
  return false;
}

/** 视频标记正则表达式 */
export const VIDEO_MARKER_PATTERN = /\[DINGTALK_VIDEO\](.*?)\[\/DINGTALK_VIDEO\]/gs;

/** 音频标记正则表达式 */
export const AUDIO_MARKER_PATTERN = /\[DINGTALK_AUDIO\](.*?)\[\/DINGTALK_AUDIO\]/gs;

/** 文件标记正则表达式 */
export const FILE_MARKER_PATTERN = /\[DINGTALK_FILE\](.*?)\[\/DINGTALK_FILE\]/gs;


/**
 * 去掉 file:// / MEDIA: / attachment:// 前缀，得到实际的绝对路径
 */
export function toLocalPath(raw: string): string {
  let filePath = raw;
  if (filePath.startsWith('file://')) filePath = filePath.replace('file://', '');
  else if (filePath.startsWith('MEDIA:')) filePath = filePath.replace('MEDIA:', '');
  else if (filePath.startsWith('attachment://')) filePath = filePath.replace('attachment://', '');

  // 解码 URL 编码的路径（如中文字符 %E5%9B%BE → 图）
  try {
    filePath = decodeURIComponent(filePath);
  } catch {
    // 解码失败则保持原样
  }
  return filePath;
}

/**
 * 通用媒体文件上传函数
 */
/** 上传结果接口 */
export interface UploadResult {
  mediaId: string;      // 原始 media_id（带 @）
  cleanMediaId: string; // 去掉 @ 的 media_id
  downloadUrl: string;  // 下载链接
}

/**
 * 本地图诊断：默认只 console 一行，不再 log.warn（避免 [sendTextToDingTalk] 双前缀刷屏）。
 * verbose 步骤（文件可读/realpath 等）仅 debug 时通过 log 输出。
 */
function logLocalImage(log: any, step: string, detail?: string, verbose = false) {
  const line = detail
    ? `[DingTalk][LocalImage] ${step} | ${detail}`
    : `[DingTalk][LocalImage] ${step}`;
  if (verbose) {
    try {
      log?.debug?.(line);
    } catch {
      // ignore
    }
    return;
  }
  console.log(line);
}

/** 钉钉 mediaId 形态 */
const MEDIA_ID_RE = /@[A-Za-z0-9_-]{8,}/g;

/**
 * 精简 MediaId 追踪：默认只在关键节点 / 异常时打一行。
 * force=true 或发现「裸 mediaId」时才输出。
 */
export function logMediaIdTrace(
  stage: string,
  content: string | null | undefined,
  extra?: string,
  force = false,
): void {
  const text = typeof content === "string" ? content : "";
  const ids = [...new Set([...text.matchAll(MEDIA_ID_RE)].map((m) => m[0]))];
  const inMd = new Set(
    [...text.matchAll(LOCAL_IMAGE_RE)].map((m) => (m[2] || "").trim()),
  );
  const bareIds = ids.filter((id) => !inMd.has(id));
  // sampleImageMsg 的 photoURL 就是裸 mediaId，不算异常
  const isImageMsg = /type=image|sampleImage|photoURL/i.test(`${stage} ${extra || ""}`);
  const suspiciousBare = isImageMsg ? [] : bareIds;
  if (!force && suspiciousBare.length === 0 && !stage.includes("API前") && !stage.includes("完成")) {
    return;
  }
  const preview = text.replace(/\n/g, "\\n").slice(0, 160);
  console.log(
    `[DingTalk][MediaIdTrace] ${stage} | len=${text.length}` +
      (ids.length ? ` mediaIds=${ids.length}` : "") +
      (suspiciousBare.length ? ` ⚠️BARE=${suspiciousBare.join(",")}` : "") +
      (extra ? ` ${extra}` : "") +
      ` | ${preview}`,
  );
}

/** Markdown 代码区域（围栏 ``` 与行内 `...`），其中的路径不应上传 */
function getMarkdownCodeRanges(content: string): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];
  const fenceRe = /```[\s\S]*?```/g;
  let m: RegExpExecArray | null;
  while ((m = fenceRe.exec(content)) !== null) {
    ranges.push({ start: m.index, end: m.index + m[0].length });
  }
  const inlineRe = /`[^`\n]+`/g;
  while ((m = inlineRe.exec(content)) !== null) {
    const start = m.index;
    if (ranges.some((r) => start >= r.start && start < r.end)) continue;
    ranges.push({ start, end: start + m[0].length });
  }
  return ranges;
}

function isIndexInCodeRange(
  index: number,
  ranges: Array<{ start: number; end: number }>,
): boolean {
  return ranges.some((r) => index >= r.start && index < r.end);
}

export async function uploadMediaToDingTalk(
  filePath: string,
  mediaType: 'image' | 'file' | 'video' | 'voice',
  oapiToken: string,
  maxSize: number = 20 * 1024 * 1024,
  log?: any,
): Promise<UploadResult | null> {
  const tag = `uploadMedia type=${mediaType}`;
  try {
    let absPath = toLocalPath(filePath);
    logLocalImage(log, `${tag} 开始`, `path=${absPath}`, true);

    if (!fs.existsSync(absPath)) {
      logLocalImage(log, `${tag} 失败:文件不存在`, absPath);
      return null;
    }

    // SMB/共享盘上 realpath 有时能纠正软链；失败则沿用原路径
    try {
      const real = fs.realpathSync(absPath);
      if (real !== absPath) {
        logLocalImage(log, `${tag} realpath`, `${absPath} → ${real}`, true);
      }
      absPath = real;
    } catch (e: any) {
      logLocalImage(log, `${tag} realpath跳过`, e?.message || String(e), true);
    }

    // 检查文件大小
    const stats = fs.statSync(absPath);
    const fileSizeMB = (stats.size / (1024 * 1024)).toFixed(2);
    logLocalImage(log, `${tag} 文件可读`, `size=${fileSizeMB}MB`, true);

    // 钉钉 image 类型官方上限约 10MB；调用方若传入更大 limit 也按类型收紧
    const effectiveMax =
      mediaType === "image"
        ? Math.min(maxSize, 10 * 1024 * 1024)
        : mediaType === "voice"
          ? Math.min(maxSize, 2 * 1024 * 1024)
          : maxSize;

    if (stats.size > effectiveMax) {
      const maxSizeMB = (effectiveMax / (1024 * 1024)).toFixed(0);
      logLocalImage(
        log,
        `${tag} 失败:文件过大`,
        `size=${fileSizeMB}MB limit=${maxSizeMB}MB path=${absPath}`,
      );
      return null;
    }

    // ✅ 根据媒体类型设置正确的 contentType
    const getContentType = () => {
      const ext = path.extname(absPath).toLowerCase();
      if (mediaType === 'image') {
        if (ext === '.png') return 'image/png';
        if (ext === '.gif') return 'image/gif';
        if (ext === '.webp') return 'image/webp';
        return 'image/jpeg';
      } else if (mediaType === 'video') {
        return ext === '.mp4' ? 'video/mp4' : 'video/quicktime';
      } else if (mediaType === 'voice') {
        return ext === '.mp3' ? 'audio/mpeg' : 'audio/amr';
      } else {
        return 'application/octet-stream';
      }
    };

    // 中文/特殊字符文件名在部分 multipart 网关会失败：FormData 用 ASCII 安全名，流仍读真实路径
    const originalBase = path.basename(absPath);
    const ext = path.extname(absPath) || (mediaType === "image" ? ".jpg" : ".bin");
    const safeFilename = /^[\w.\-]+$/i.test(originalBase)
      ? originalBase
      : `dingtalk-upload-${Date.now()}${ext.toLowerCase()}`;
    if (safeFilename !== originalBase) {
      logLocalImage(
        log,
        `${tag} 安全文件名`,
        `${originalBase} → ${safeFilename}`,
      );
    }

    const form = new FormData();
    form.append("media", fs.createReadStream(absPath), {
      filename: safeFilename,
      contentType: getContentType(),
    });

    const uploadType = mediaType === "video" ? "file" : mediaType;
    logLocalImage(
      log,
      `${tag} 请求钉钉OAPI`,
      `uploadType=${uploadType} formName=${safeFilename} size=${fileSizeMB}MB`,
    );
    const resp = await dingtalkOapiHttp.post(
      `${DINGTALK_OAPI}/media/upload?access_token=${oapiToken}&type=${uploadType}`,
      form,
      { headers: form.getHeaders(), timeout: 60_000 },
    );

    const mediaId = resp.data?.media_id;
    if (mediaId) {
      // ✅ 去掉 media_id 前面的 @ 符号（如果有的话）
      const cleanMediaId = mediaId.startsWith('@') ? mediaId.substring(1) : mediaId;
      // ✅ 将 media_id 转换为钉钉下载链接
      const downloadUrl = `https://down.dingtalk.com/media/${cleanMediaId}`;
      logLocalImage(
        log,
        `${tag} 成功`,
        `mediaId=${mediaId} clean=${cleanMediaId}`,
      );
      return {
        mediaId,
        cleanMediaId,
        downloadUrl,
      };
    }
    const bodyPreview = JSON.stringify(resp.data ?? {}).slice(0, 500);
    logLocalImage(log, `${tag} 失败:无media_id`, `http=${resp.status} body=${bodyPreview}`);
    return null;
  } catch (err: any) {
    const status = err?.response?.status;
    const data = err?.response?.data;
    logLocalImage(
      log,
      `${tag} 异常`,
      `msg=${err?.message || err} status=${status ?? "-"} data=${JSON.stringify(data ?? {}).slice(0, 400)}`,
    );
    return null;
  }
}

/**
 * 本地图片上传（含失败时拷到 /tmp 再传，缓解 SMB/中文路径问题）
 */
export async function uploadLocalImageWithFallback(
  filePath: string,
  oapiToken: string,
  log?: any,
): Promise<UploadResult | null> {
  const absPath = toLocalPath(filePath);
  if (!fs.existsSync(absPath)) {
    logLocalImage(log, "fallback 失败:文件不存在", absPath);
    return null;
  }

  let result = await uploadMediaToDingTalk(absPath, "image", oapiToken, 10 * 1024 * 1024, log);
  if (result?.mediaId) {
    return result;
  }

  // 直接读共享盘/中文路径失败时：拷贝到本地 tmp 再传
  const ext = path.extname(absPath) || ".jpg";
  const tmp = path.join(
    os.tmpdir(),
    `dingtalk-img-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext.toLowerCase()}`,
  );
  try {
    fs.copyFileSync(absPath, tmp);
    result = await uploadMediaToDingTalk(tmp, "image", oapiToken, 10 * 1024 * 1024, log);
    return result;
  } catch (err: any) {
    logLocalImage(
      log,
      "fallback 拷贝/重试异常",
      `${absPath} err=${err?.message || err}`,
    );
    return null;
  } finally {
    try {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    } catch {
      // ignore
    }
  }
}

export type ProcessImagesOutboundResult = {
  /** 单条 markdown/卡片正文：![] 已是 mediaId，下载位保留原 URL（同一气泡，不拆消息） */
  text: string;
  /** @deprecated 不再拆消息；恒为空数组，保留字段兼容调用方 */
  followUpUrls: string[];
};

async function downloadRemoteUrlToTemp(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(60_000),
      headers: { "User-Agent": "dingtalk-openclaw-connector/0.8.21" },
    });
    if (!res.ok) {
      console.warn(`[DingTalk][MediaIdTrace] 远程图下载失败 HTTP ${res.status} | ${url}`);
      return null;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length || buf.length > 20 * 1024 * 1024) return null;
    const ct = (res.headers.get("content-type") || "").toLowerCase();
    let ext = ".bin";
    if (ct.includes("png")) ext = ".png";
    else if (ct.includes("jpeg") || ct.includes("jpg")) ext = ".jpg";
    else if (ct.includes("gif")) ext = ".gif";
    else if (ct.includes("webp")) ext = ".webp";
    else {
      const m = (url.split("?")[0] || "").match(/\.(png|jpe?g|gif|webp)$/i);
      if (m) ext = `.${m[1].toLowerCase().replace("jpeg", "jpg")}`;
      else ext = ".jpg";
    }
    const tmp = path.join(
      os.tmpdir(),
      `dingtalk-md-remote-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`,
    );
    fs.writeFileSync(tmp, buf);
    console.log(
      `[DingTalk][MediaIdTrace] 远程图下载成功 | bytes=${buf.length} tmp=${tmp}`,
    );
    return tmp;
  } catch (e: any) {
    console.warn(`[DingTalk][MediaIdTrace] 远程图下载异常 | ${e?.message || e}`);
    return null;
  }
}

/**
 * 把 original 在「非 ![] / 非 ]( 」位置替换为 replacement（同一气泡内保留下载位）。
 */
function replaceOutsideImageTargets(
  content: string,
  original: string,
  replacement: string,
): string {
  if (!content.includes(original) || original === replacement) return content;
  let out = content;
  let from = 0;
  while (from < out.length) {
    const idx = out.indexOf(original, from);
    if (idx < 0) break;
    if (out.slice(Math.max(0, idx - 2), idx) === "](") {
      from = idx + original.length;
      continue;
    }
    out = out.slice(0, idx) + replacement + out.slice(idx + original.length);
    from = idx + replacement.length;
  }
  return out;
}

/**
 * 出站图片处理（单气泡）：
 * - 只处理 `![](target)`：本地/远程均上传 → `![](mediaId)`
 * - 代码块跳过；不扫裸路径
 * - 远程：![] 改 mediaId 后，正文里「下载链接：http://…」**原样保留在同一条消息**
 *   （钉钉改写发生在「![] 与正文共用同一 http」时；![] 改成 mediaId 后即可同泡共存）
 * - 本地：正文重复的本地路径换成 down.dingtalk.com 可点链接（仍同一条消息）
 * - **不再拆第二条 text 消息**
 */
export async function processImagesForOutbound(
  content: string,
  oapiToken: string | null,
  log?: any,
): Promise<ProcessImagesOutboundResult> {
  if (!oapiToken || !content || typeof content !== "string") {
    return { text: content || "", followUpUrls: [] };
  }

  const codeRanges = getMarkdownCodeRanges(content);
  const mdMatches = [...content.matchAll(LOCAL_IMAGE_RE)];
  let result = content;
  /** 本地路径 → 可点 downloadUrl（仅替换正文中的裸路径，不拆消息） */
  const localPathToDl = new Map<string, string>();
  let uploadCount = 0;

  for (const match of mdMatches) {
    if (match.index !== undefined && isIndexInCodeRange(match.index, codeRanges)) continue;
    const [fullMatch, alt, rawPath] = match;
    const cleanPath = (rawPath || "").replace(/\\ /g, " ").trim();
    if (!cleanPath) continue;

    if (isLocalImageRef(cleanPath)) {
      const absPath = toLocalPath(cleanPath);
      try {
        const uploadResult = await uploadLocalImageWithFallback(absPath, oapiToken, log);
        if (uploadResult?.mediaId) {
          result = result
            .split(fullMatch)
            .join(`![${alt || path.basename(absPath)}](${uploadResult.mediaId})`);
          uploadCount++;
          if (uploadResult.downloadUrl) {
            localPathToDl.set(cleanPath, uploadResult.downloadUrl);
            localPathToDl.set(absPath, uploadResult.downloadUrl);
          }
        } else {
          result = result
            .split(fullMatch)
            .join(`📷 *图片上传失败（${path.basename(absPath)}）*`);
        }
      } catch {
        result = result
          .split(fullMatch)
          .join(`📷 *图片上传异常（${path.basename(toLocalPath(cleanPath))}）*`);
      }
      continue;
    }

    if (looksLikeRemoteUrl(cleanPath)) {
      let tmp: string | null = null;
      try {
        tmp = await downloadRemoteUrlToTemp(cleanPath);
        if (!tmp) continue;
        const uploadResult = await uploadLocalImageWithFallback(tmp, oapiToken, log);
        if (uploadResult?.mediaId) {
          // 只改 ![] 为 mediaId；正文「下载链接：http://…」保持原 URL，同一条消息
          result = result.split(fullMatch).join(`![${alt || "image"}](${uploadResult.mediaId})`);
          uploadCount++;
          console.log(
            `[DingTalk][LocalImage] ![]远程→mediaId 下载链保留原URL | ${uploadResult.mediaId}`,
          );
        }
      } catch (err: any) {
        logLocalImage(log, "远程图处理失败", err?.message || String(err));
      } finally {
        if (tmp) {
          try {
            fs.unlinkSync(tmp);
          } catch {
            // ignore
          }
        }
      }
    }
  }

  // 本地路径若在「下载链接」等处再出现：换成可点 downloadUrl（仍同一气泡）
  for (const [p, dl] of localPathToDl) {
    result = replaceOutsideImageTargets(result, p, dl);
  }

  console.log(
    `[DingTalk][LocalImage] processImagesForOutbound 完成 | uploads=${uploadCount} outLen=${result.length}`,
  );
  logMediaIdTrace("processImagesForOutbound:out", result);

  return { text: result, followUpUrls: [] };
}

/** 兼容旧调用 */
export async function processLocalImages(
  content: string,
  oapiToken: string | null,
  log?: any,
): Promise<string> {
  const r = await processImagesForOutbound(content, oapiToken, log);
  return r.text;
}

/**
 * 是否仍有「需要上传却未上传」的本地 MD 图。
 * **代码块 / 行内 code 内的示例路径不算**（否则 AI 举例 `![x](/tmp/a.jpg)` 会误报灰图）。
 */
export function hasResidualLocalMdImagesOutsideCode(content: string): boolean {
  if (!content) return false;
  const codeRanges = getMarkdownCodeRanges(content);
  for (const m of content.matchAll(LOCAL_IMAGE_RE)) {
    if (m.index !== undefined && isIndexInCodeRange(m.index, codeRanges)) continue;
    const target = (m[2] || "").trim();
    if (isLocalImageRef(target)) return true;
  }
  return false;
}


/** 视频信息接口 */
export interface VideoInfo {
  path: string;
}

/**
 * 提取视频元数据（时长、分辨率）
 */
export async function extractVideoMetadata(
  filePath: string,
  log?: any,
): Promise<{ duration: number; width: number; height: number } | null> {
  try {
    const ffmpeg = require('fluent-ffmpeg');
    const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
    const ffprobePath = require('@ffprobe-installer/ffprobe').path;
    ffmpeg.setFfmpegPath(ffmpegPath);
    ffmpeg.setFfprobePath(ffprobePath);

    return new Promise((resolve) => {
      ffmpeg.ffprobe(filePath, (err: any, metadata: any) => {
        if (err) {
          log?.warn?.(`ffprobe 执行失败: ${err.message}`);
          resolve(null);
          return;
        }
        try {
          // ✅ 钉钉 API 需要毫秒，ffprobe 返回的是秒，需要转换
          const duration = metadata.format?.duration ? Math.round(parseFloat(metadata.format.duration) * 1000) : 0;
          const videoStream = metadata.streams?.find((s: any) => s.codec_type === 'video');
          const width = videoStream?.width || 0;
          const height = videoStream?.height || 0;
          resolve({ duration, width, height });
        } catch (err) {
          log?.warn?.(`解析 ffprobe 输出失败`);
          resolve(null);
        }
      });
    });
  } catch (err: any) {
    log?.warn?.(`提取视频元数据失败: ${err.message}`);
    return null;
  }
}

/**
 * 生成视频封面图（第1秒截图）
 */
export async function extractVideoThumbnail(
  videoPath: string,
  outputPath: string,
  log?: any,
): Promise<string | null> {
  try {
    const ffmpeg = require('fluent-ffmpeg');
    const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
    const path = await import('path');
    ffmpeg.setFfmpegPath(ffmpegPath);

    return new Promise((resolve) => {
      ffmpeg(videoPath)
        .screenshots({
          count: 1,
          folder: path.dirname(outputPath),
          filename: path.basename(outputPath),
          timemarks: ['1'],
          size: '?x360',
        })
        .on('end', () => {
          log?.info?.(`封面生成成功: ${outputPath}`);
          resolve(outputPath);
        })
        .on('error', (err: any) => {
          log?.error?.(`封面生成失败: ${err.message}`);
          resolve(null);
        });
    });
  } catch (err: any) {
    log?.error?.(`ffmpeg 失败: ${err.message}`);
    return null;
  }
}

/**
 * 提取视频标记并发送视频消息
 */
export async function processVideoMarkers(
  content: string,
  sessionWebhook: string,
  config: DingtalkConfig,
  oapiToken: string | null,
  log?: any,
  useProactiveApi: boolean = false,
  target?: any,
): Promise<string> {
  const logPrefix = useProactiveApi ? 'Video[Proactive]' : 'Video';

  if (!oapiToken) {
    log?.warn?.(`${logPrefix} 无 oapiToken，跳过视频处理`);
    return content;
  }

  const matches = [...content.matchAll(VIDEO_MARKER_PATTERN)];
  const videoInfos: VideoInfo[] = [];
  const invalidVideos: string[] = [];
  
  // 导入需要的模块
  const os = await import('os');

  for (const match of matches) {
    try {
      const videoInfo = JSON.parse(match[1]) as VideoInfo;
      if (videoInfo.path && fs.existsSync(videoInfo.path)) {
        videoInfos.push(videoInfo);
        log?.info?.(`${logPrefix} 提取到视频: ${videoInfo.path}`);
      } else {
        invalidVideos.push(videoInfo.path || '未知路径');
        log?.warn?.(`${logPrefix} 视频文件不存在: ${videoInfo.path}`);
      }
    } catch (err: any) {
      log?.warn?.(`${logPrefix} 解析标记失败: ${err.message}`);
    }
  }

  if (videoInfos.length === 0 && invalidVideos.length === 0) {
    log?.info?.(`${logPrefix} 未检测到视频标记`);
    return content.replace(VIDEO_MARKER_PATTERN, '').trim();
  }

  // 先移除所有视频标记
  let cleanedContent = content.replace(VIDEO_MARKER_PATTERN, '').trim();

  const statusMessages: string[] = [];

  for (const invalidPath of invalidVideos) {
    statusMessages.push(`⚠️ 视频文件不存在: ${path.basename(invalidPath)}`);
  }

  if (videoInfos.length > 0) {
    log?.info?.(`${logPrefix} 检测到 ${videoInfos.length} 个视频，开始处理...`);
  }

  for (const videoInfo of videoInfos) {
    const fileName = path.basename(videoInfo.path);
    let thumbnailPath = '';
    try {
      // 1. 提取视频元数据
      const metadata = await extractVideoMetadata(videoInfo.path, log);
      if (!metadata) {
        log?.warn?.(`${logPrefix} 无法提取元数据: ${videoInfo.path}`);
        statusMessages.push(`⚠️ 视频处理失败: ${fileName}（无法读取视频信息）`);
        continue;
      }

      // 2. 生成封面图
      thumbnailPath = path.join(os.tmpdir(), `thumbnail_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.jpg`);
      log?.info?.(`${logPrefix} 准备生成封面: ${thumbnailPath}`);
      const thumbnail = await extractVideoThumbnail(videoInfo.path, thumbnailPath, log);
      if (!thumbnail) {
        log?.warn?.(`${logPrefix} 无法生成封面: ${videoInfo.path}`);
        statusMessages.push(`⚠️ 视频处理失败: ${fileName}（无法生成封面）`);
        continue;
      }
      
      // 检查生成的封面文件
      if (fs.existsSync(thumbnailPath)) {
        const stats = fs.statSync(thumbnailPath);
        log?.info?.(`${logPrefix} 封面文件生成完成: ${thumbnailPath}, 大小: ${(stats.size / 1024).toFixed(2)}KB`);
        if (stats.size < 1024) {  // 小于1KB可能有问题
          log?.warn?.(`${logPrefix} 封面文件过小，可能存在质量问题`);
        }
      } else {
        log?.error?.(`${logPrefix} 封面文件未生成: ${thumbnailPath}`);
        statusMessages.push(`⚠️ 视频处理失败: ${fileName}（封面文件未生成）`);
        continue;
      }

      // 3. 上传视频
      const videoUploadResult = await uploadMediaToDingTalk(videoInfo.path, 'video', oapiToken, 20 * 1024 * 1024, log);
      if (!videoUploadResult) {
        log?.warn?.(`${logPrefix} 视频上传失败: ${videoInfo.path}`);
        statusMessages.push(`⚠️ 视频上传失败: ${fileName}（文件可能超过 20MB 限制）`);
        continue;
      }
      const videoMediaId = videoUploadResult.mediaId; // 使用原始 media_id（带 @）

      // 4. 上传封面
      const picUploadResult = await uploadMediaToDingTalk(thumbnailPath, 'image', oapiToken, 20 * 1024 * 1024, log);
      if (!picUploadResult) {
        log?.warn?.(`${logPrefix} 封面上传失败: ${thumbnailPath}`);
        statusMessages.push(`⚠️ 视频封面上传失败: ${fileName}`);
        continue;
      }
      const picMediaId = picUploadResult.mediaId; // 使用原始 media_id（带 @）

      // 5. 发送视频消息
      if (useProactiveApi && target) {
        await sendVideoProactive(config, target, videoMediaId, picMediaId, metadata, log);
      } else {
        await sendVideoMessage(config, sessionWebhook, fileName, videoUploadResult.downloadUrl, log, metadata);
      }
      
      statusMessages.push(`✅ 视频已发送: ${fileName}`);
      log?.info?.(`${logPrefix} 视频处理完成: ${fileName}`);
    } catch (err: any) {
      log?.error?.(`${logPrefix} 处理视频失败: ${err.message}`);
      statusMessages.push(`⚠️ 视频处理异常: ${fileName}（${err.message}）`);
    } finally {
      // 清理临时封面文件
      if (thumbnailPath && fs.existsSync(thumbnailPath)) {
        try {
          fs.unlinkSync(thumbnailPath);
          log?.info?.(`${logPrefix} 临时封面已清理: ${thumbnailPath}`);
        } catch (cleanupErr: any) {
          log?.warn?.(`${logPrefix} 清理临时文件失败: ${cleanupErr?.message || cleanupErr}`);
        }
      }
    }
  }

  if (statusMessages.length > 0) {
    const statusText = statusMessages.join('\n');
    cleanedContent = cleanedContent
      ? `${cleanedContent}\n\n${statusText}`
      : statusText;
  }

  return cleanedContent;
}


/** 音频信息接口 */
export interface AudioInfo {
  path: string;
}

/**
 * 提取音频时长
 *
 * 使用 fluent-ffmpeg 的 ffprobe API，与 extractVideoMetadata 保持一致，
 * 完全避免直接调用 child_process，消除安全扫描误报。
 */
async function extractAudioDuration(filePath: string, log?: any): Promise<number | null> {
  try {
    const ffmpeg = require('fluent-ffmpeg');

    // 优先使用 @ffprobe-installer/ffprobe 提供的固定路径
    try {
      const ffprobeInstaller = require('@ffprobe-installer/ffprobe');
      if (ffprobeInstaller?.path) {
        ffmpeg.setFfprobePath(ffprobeInstaller.path);
      }
    } catch {
      // @ffprobe-installer/ffprobe 未安装（optionalDependency），使用系统 ffprobe
    }

    return new Promise((resolve) => {
      ffmpeg.ffprobe(filePath, (err: any, metadata: any) => {
        if (err) {
          log?.warn?.(`ffprobe 执行失败: ${err.message}`);
          resolve(null);
          return;
        }
        try {
          const duration = metadata.format?.duration
            ? Math.round(parseFloat(metadata.format.duration) * 1000)
            : 0;
          resolve(duration);
        } catch (parseErr) {
          log?.warn?.(`解析 ffprobe 输出失败`);
          resolve(null);
        }
      });
    });
  } catch (err: any) {
    log?.warn?.(`提取音频时长失败: ${err.message}`);
    return null;
  }
}

/**
 * 提取音频标记并发送音频消息
 */
export async function processAudioMarkers(
  content: string,
  sessionWebhook: string,
  config: DingtalkConfig,
  oapiToken: string | null,
  log?: any,
  useProactiveApi: boolean = false,
  target?: any,
): Promise<string> {
  const logPrefix = useProactiveApi ? 'Audio[Proactive]' : 'Audio';

  if (!oapiToken) {
    log?.warn?.(`${logPrefix} 无 oapiToken，跳过音频处理`);
    return content;
  }

  const matches = [...content.matchAll(AUDIO_MARKER_PATTERN)];
  const audioInfos: AudioInfo[] = [];
  const invalidAudios: string[] = [];

  for (const match of matches) {
    try {
      const audioInfo = JSON.parse(match[1]) as AudioInfo;
      if (audioInfo.path && fs.existsSync(audioInfo.path)) {
        audioInfos.push(audioInfo);
        log?.info?.(`${logPrefix} 提取到音频: ${audioInfo.path}`);
      } else {
        invalidAudios.push(audioInfo.path || '未知路径');
        log?.warn?.(`${logPrefix} 音频文件不存在: ${audioInfo.path}`);
      }
    } catch (err: any) {
      log?.warn?.(`${logPrefix} 解析标记失败: ${err.message}`);
    }
  }

  if (audioInfos.length === 0 && invalidAudios.length === 0) {
    log?.info?.(`${logPrefix} 未检测到音频标记`);
    return content.replace(AUDIO_MARKER_PATTERN, '').trim();
  }

  // 先移除所有音频标记
  let cleanedContent = content.replace(AUDIO_MARKER_PATTERN, '').trim();

  const statusMessages: string[] = [];

  for (const invalidPath of invalidAudios) {
    statusMessages.push(`⚠️ 音频文件不存在: ${path.basename(invalidPath)}`);
  }

  if (audioInfos.length > 0) {
    log?.info?.(`${logPrefix} 检测到 ${audioInfos.length} 个音频，开始处理...`);
  }

  for (const audioInfo of audioInfos) {
    const fileName = path.basename(audioInfo.path);
    try {
      const ext = path.extname(audioInfo.path).slice(1).toLowerCase();

      // 上传音频到钉钉
      const uploadResult = await uploadMediaToDingTalk(audioInfo.path, 'voice', oapiToken, 20 * 1024 * 1024, log);
      if (!uploadResult) {
        statusMessages.push(`⚠️ 音频上传失败: ${fileName}（文件可能超过 20MB 限制）`);
        continue;
      }

      // 提取音频实际时长
      const audioDurationMs = await extractAudioDuration(audioInfo.path, log);

      // 发送音频消息
      if (useProactiveApi && target) {
        await sendAudioProactive(config, target, fileName, uploadResult.downloadUrl, log, audioDurationMs ?? undefined);
      } else {
        await sendAudioMessage(config, sessionWebhook, fileName, uploadResult.downloadUrl, log, audioDurationMs ?? undefined);
      }
      statusMessages.push(`✅ 音频已发送: ${fileName}`);
      log?.info?.(`${logPrefix} 音频处理完成: ${fileName}`);
    } catch (err: any) {
      log?.error?.(`${logPrefix} 处理音频失败: ${err.message}`);
      statusMessages.push(`⚠️ 音频处理异常: ${fileName}（${err.message}）`);
    }
  }

  if (statusMessages.length > 0) {
    const statusText = statusMessages.join('\n');
    cleanedContent = cleanedContent
      ? `${cleanedContent}\n\n${statusText}`
      : statusText;
  }

  return cleanedContent;
}


/** 文件信息接口 */
export interface FileInfo {
  path: string;
  fileName: string;
  fileType: string;
}

/**
 * 提取文件标记，上传文件到钉钉，并发送独立的文件消息（webhook 或 proactive API）。
 * 
 * 注意：此函数既做「上传」也做「发送」，是完整版的文件处理流程。
 * 与 media/file.ts 中的 uploadAndReplaceFileMarkers 不同，后者只做上传+文本替换。
 * 
 * 调用方：messaging.ts（直接 import media.ts）
 */
export async function processFileMarkers(
  content: string,
  sessionWebhook: string,
  config: DingtalkConfig,
  oapiToken: string | null,
  log?: any,
  useProactiveApi: boolean = false,
  target?: any,
): Promise<string> {
  const logPrefix = useProactiveApi ? 'File[Proactive]' : 'File';

  if (!oapiToken) {
    log?.warn?.(`${logPrefix} 无 oapiToken，跳过文件处理`);
    return content;
  }

  const matches = [...content.matchAll(FILE_MARKER_PATTERN)];
  const fileInfos: FileInfo[] = [];
  const invalidFiles: string[] = [];

  for (const match of matches) {
    try {
      const fileInfo = JSON.parse(match[1]) as FileInfo;
      if (fileInfo.path && fs.existsSync(fileInfo.path)) {
        fileInfos.push(fileInfo);
        log?.info?.(`${logPrefix} 提取到文件: ${fileInfo.path}`);
      } else {
        invalidFiles.push(fileInfo.path || '未知路径');
        log?.warn?.(`${logPrefix} 文件不存在: ${fileInfo.path}`);
      }
    } catch (err: any) {
      log?.warn?.(`${logPrefix} 解析标记失败: ${err.message}`);
    }
  }

  if (fileInfos.length === 0 && invalidFiles.length === 0) {
    log?.info?.(`${logPrefix} 未检测到文件标记`);
    return content.replace(FILE_MARKER_PATTERN, '').trim();
  }

  // 先移除所有文件标记
  let cleanedContent = content.replace(FILE_MARKER_PATTERN, '').trim();

  const statusMessages: string[] = [];

  for (const invalidPath of invalidFiles) {
    statusMessages.push(`⚠️ 文件不存在: ${path.basename(invalidPath)}`);
  }

  if (fileInfos.length > 0) {
    log?.info?.(`${logPrefix} 检测到 ${fileInfos.length} 个文件，开始处理...`);
  }

  for (const fileInfo of fileInfos) {
    const fileName = fileInfo.fileName || path.basename(fileInfo.path);
    try {
      // 上传文件到钉钉
      const uploadResult = await uploadMediaToDingTalk(fileInfo.path, 'file', oapiToken, 20 * 1024 * 1024, log);
      if (!uploadResult) {
        statusMessages.push(`⚠️ 文件上传失败: ${fileName}（文件可能超过 20MB 限制）`);
        continue;
      }

      // 发送文件消息（钉钉 API 统一要求带 @ 前缀的 mediaId）
      if (useProactiveApi && target) {
        await sendFileProactive(config, target, fileInfo, uploadResult.mediaId, log);
      } else {
        await sendFileMessage(config, sessionWebhook, fileInfo, uploadResult.mediaId, log);
      }
      statusMessages.push(`✅ 文件已发送: ${fileName}`);
      log?.info?.(`${logPrefix} 文件处理完成: ${fileName}`);
    } catch (err: any) {
      log?.error?.(`${logPrefix} 处理文件失败: ${err.message}`);
      statusMessages.push(`⚠️ 文件处理异常: ${fileName}（${err.message}）`);
    }
  }

  if (statusMessages.length > 0) {
    const statusText = statusMessages.join('\n');
    cleanedContent = cleanedContent
      ? `${cleanedContent}\n\n${statusText}`
      : statusText;
  }

  return cleanedContent;
}


/** 视频元数据接口 */
interface VideoMetadata {
  duration: number;
  width: number;
  height: number;
}

/**
 * 发送视频消息（sessionWebhook 模式）
 */
async function sendVideoMessage(
  config: DingtalkConfig,
  sessionWebhook: string,
  fileName: string,
  mediaId: string,
  log?: any,
  metadata?: { duration: number; width: number; height: number },
): Promise<void> {
  try {
    const token = await (await import('../utils/index.ts')).getAccessToken(config);
    
    // 钉钉视频消息格式（sessionWebhook 模式）
    const videoMessage = {
      msgtype: 'video',
      video: {
        mediaId: mediaId,
        duration: metadata?.duration.toString() || '60000',
        type: 'mp4',
      },
    };

    log?.info?.(`发送视频消息: ${fileName}`);
    const resp = await dingtalkHttp.post(sessionWebhook, videoMessage, {
      headers: {
        'x-acs-dingtalk-access-token': token,
        'Content-Type': 'application/json',
      },
      timeout: 10_000,
    });

    if (resp.data?.success !== false) {
      log?.info?.(`视频消息发送成功: ${fileName}`);
    } else {
      log?.error?.(`视频消息发送失败: ${JSON.stringify(resp.data)}`);
    }
  } catch (err: any) {
    log?.error?.(`发送视频消息异常: ${fileName}, 错误: ${err.message}`);
  }
}

/**
 * 发送视频消息（主动 API 模式）
 */
export async function sendVideoProactive(
  config: DingtalkConfig,
  target: any,
  videoMediaId: string,
  picMediaId: string,
  metadata?: { duration: number; width: number; height: number },
  log?: any,
): Promise<void> {
  try {
    const token = await (await import('../utils/index.ts')).getAccessToken(config);
    const { DINGTALK_API } = await import('../utils/index.ts');

    // 钉钉普通消息 API 的视频消息格式
    const msgParam = {
      duration: metadata?.duration.toString() || '60000',
      videoMediaId: videoMediaId,
      videoType: 'mp4',
      picMediaId: picMediaId || '', // 封面图 mediaId
    };

    const body: any = {
      robotCode: String(config.clientId),
      msgKey: 'sampleVideo',
      msgParam: JSON.stringify(msgParam),
    };

    let endpoint: string;
    if (target.type === 'group') {
      body.openConversationId = target.openConversationId;
      endpoint = `${DINGTALK_API}/v1.0/robot/groupMessages/send`;
    } else {
      body.userIds = [target.userId];
      endpoint = `${DINGTALK_API}/v1.0/robot/oToMessages/batchSend`;
    }

    log?.info?.(`Video[Proactive] 发送视频消息`);
    log?.info?.(`Video[Proactive] 请求体: ${JSON.stringify(body, null, 2)}`);
    log?.info?.(`Video[Proactive] endpoint: ${endpoint}`);
    const resp = await dingtalkHttp.post(endpoint, body, {
      headers: { 'x-acs-dingtalk-access-token': token, 'Content-Type': 'application/json' },
      timeout: 10_000,
    });

    log?.info?.(`Video[Proactive] 钉钉 API 响应: ${JSON.stringify(resp.data, null, 2)}`);

    if (resp.data?.processQueryKey) {
      log?.info?.(`Video[Proactive] 视频消息发送成功`);
    } else {
      log?.error?.(`Video[Proactive] 视频消息发送失败: ${JSON.stringify(resp.data)}`);
      throw new Error(`视频消息发送失败: ${JSON.stringify(resp.data)}`);
    }
  } catch (err: any) {
    log?.error?.(`Video[Proactive] 发送视频消息失败, 错误: ${err.message}`);
  }
}


/**
 * 发送音频消息（sessionWebhook 模式）
 */
async function sendAudioMessage(
  config: DingtalkConfig,
  sessionWebhook: string,
  fileName: string,
  mediaId: string,
  log?: any,
  durationMs?: number,
): Promise<void> {
  try {
    const token = await (await import('../utils/index.ts')).getAccessToken(config);

    // 钉钉语音消息格式
    const actualDuration = (durationMs && durationMs > 0) ? durationMs.toString() : '60000';
    const audioMessage = {
      msgtype: 'voice',
      voice: {
        mediaId: mediaId,
        duration: actualDuration,
      },
    };

    log?.info?.(`发送语音消息: ${fileName}`);
    const resp = await dingtalkHttp.post(sessionWebhook, audioMessage, {
      headers: {
        'x-acs-dingtalk-access-token': token,
        'Content-Type': 'application/json',
      },
      timeout: 10_000,
    });

    if (resp.data?.success !== false) {
      log?.info?.(`语音消息发送成功: ${fileName}`);
    } else {
      log?.error?.(`语音消息发送失败: ${JSON.stringify(resp.data)}`);
    }
  } catch (err: any) {
    log?.error?.(`发送语音消息异常: ${fileName}, 错误: ${err.message}`);
  }
}

/**
 * 发送音频消息（主动 API 模式）
 */
export async function sendAudioProactive(
  config: DingtalkConfig,
  target: any,
  fileName: string,
  mediaId: string,
  log?: any,
  durationMs?: number,
): Promise<void> {
  try {
    const token = await (await import('../utils/index.ts')).getAccessToken(config);
    const { DINGTALK_API } = await import('../utils/index.ts');

    // 钉钉普通消息 API 的音频消息格式
    const actualDuration = (durationMs && durationMs > 0) ? durationMs.toString() : '60000';
    const msgParam = {
      mediaId: mediaId,
      duration: actualDuration,
    };

    const body: any = {
      robotCode: String(config.clientId),
      msgKey: 'sampleAudio',
      msgParam: JSON.stringify(msgParam),
    };

    let endpoint: string;
    if (target.type === 'group') {
      body.openConversationId = target.openConversationId;
      endpoint = `${DINGTALK_API}/v1.0/robot/groupMessages/send`;
    } else {
      body.userIds = [target.userId];
      endpoint = `${DINGTALK_API}/v1.0/robot/oToMessages/batchSend`;
    }

    log?.info?.(`Audio[Proactive] 发送音频消息: ${fileName}`);
    const resp = await dingtalkHttp.post(endpoint, body, {
      headers: { 'x-acs-dingtalk-access-token': token, 'Content-Type': 'application/json' },
      timeout: 10_000,
    });

    if (resp.data?.processQueryKey) {
      log?.info?.(`Audio[Proactive] 音频消息发送成功: ${fileName}`);
    } else {
      log?.warn?.(`Audio[Proactive] 音频消息发送响应异常: ${JSON.stringify(resp.data)}`);
    }
  } catch (err: any) {
    log?.error?.(`Audio[Proactive] 发送音频消息失败: ${fileName}, 错误: ${err.message}`);
  }
}


/**
 * 发送文件消息（sessionWebhook 模式）
 */
async function sendFileMessage(
  config: DingtalkConfig,
  sessionWebhook: string,
  fileInfo: FileInfo,
  mediaId: string,
  log?: any,
): Promise<void> {
  try {
    const token = await (await import('../utils/index.ts')).getAccessToken(config);

    const fileMessage = {
      msgtype: 'file',
      file: {
        mediaId: mediaId,
        fileName: fileInfo.fileName,
        fileType: fileInfo.fileType,
      },
    };

    log?.info?.(`发送文件消息: ${fileInfo.fileName}`);
    const resp = await dingtalkHttp.post(sessionWebhook, fileMessage, {
      headers: {
        'x-acs-dingtalk-access-token': token,
        'Content-Type': 'application/json',
      },
      timeout: 10_000,
    });

    if (resp.data?.success !== false) {
      log?.info?.(`文件消息发送成功: ${fileInfo.fileName}`);
    } else {
      log?.error?.(`文件消息发送失败: ${JSON.stringify(resp.data)}`);
    }
  } catch (err: any) {
    log?.error?.(`发送文件消息异常: ${fileInfo.fileName}, 错误: ${err.message}`);
    throw err;
  }
}

/**
 * 发送文件消息（主动 API 模式）
 */
export async function sendFileProactive(
  config: DingtalkConfig,
  target: any,
  fileInfo: FileInfo,
  mediaId: string,
  log?: any,
): Promise<void> {
  try {
    const token = await (await import('../utils/index.ts')).getAccessToken(config);
    const { DINGTALK_API } = await import('../utils/index.ts');

    // 钉钉普通消息 API 的文件消息格式
    const resolvedFileName = fileInfo.fileName || path.basename(fileInfo.path);
    const resolvedFileType = fileInfo.fileType || resolvedFileName.split('.').pop() || 'file';
    const msgParam = {
      mediaId: mediaId,
      fileName: resolvedFileName,
      fileType: resolvedFileType,
    };

    const body: any = {
      robotCode: String(config.clientId),
      msgKey: 'sampleFile',
      msgParam: JSON.stringify(msgParam),
    };

    let endpoint: string;
    if (target.type === 'group') {
      body.openConversationId = target.openConversationId;
      endpoint = `${DINGTALK_API}/v1.0/robot/groupMessages/send`;
    } else {
      body.userIds = [target.userId];
      endpoint = `${DINGTALK_API}/v1.0/robot/oToMessages/batchSend`;
    }

    log?.info?.(`File[Proactive] 发送文件消息: ${fileInfo.fileName}`);
    const resp = await dingtalkHttp.post(endpoint, body, {
      headers: { 'x-acs-dingtalk-access-token': token, 'Content-Type': 'application/json' },
      timeout: 10_000,
    });

    if (resp.data?.processQueryKey) {
      log?.info?.(`File[Proactive] 发送成功: processQueryKey=${resp.data.processQueryKey}`);
    } else {
      log?.warn?.(`File[Proactive] 发送失败: ${JSON.stringify(resp.data)}`);
    }
  } catch (err: any) {
    log?.error?.(`File[Proactive] 发送文件消息失败: ${fileInfo.fileName}, 错误: ${err.message}`);
    throw err;
  }
}

// 裸露文件路径处理（绕过 OpenClaw SDK bug）

/**
 * 检测并处理响应中的裸露本地文件路径
 * 
 * OpenClaw SDK 会自动检测响应中的裸露文件路径并调用 ctx.outbound.sendMedia，
 * 但是 SDK 传递了错误的 to 参数（accountId 而不是真实的用户 ID）。
 * 
 * 为了绕过这个 bug，我们在 SDK 检测到之前就处理这些文件路径：
 * 1. 检测裸露的本地文件路径（如 /Users/xxx/video.mp4）
 * 2. 上传文件到钉钉
 * 3. 发送媒体消息
 * 4. 从响应中移除文件路径
 * 
 * 这样 SDK 就检测不到文件路径，也就不会调用 sendMedia 了。
 */
interface AICardTarget {
  type: 'user' | 'group';
  userId?: string;
  openConversationId?: string;
}

export async function processRawMediaPaths(
  content: string,
  config: DingtalkConfig,
  oapiToken: string,
  log?: any,
  target?: AICardTarget,
): Promise<string> {
  const logPrefix = 'RawMedia';
  
  // 匹配裸露的本地文件路径（绝对路径）
  // 支持的格式：
  // - Unix: /path/to/file.ext
  // - Windows: C:\path\to\file.ext 或 C:/path/to/file.ext
  const rawPathPattern = /(?:^|\s)((?:[A-Za-z]:)?[\/\\](?:[^\/\\:\*\?"<>\|\s]+[\/\\])*[^\/\\:\*\?"<>\|\s]+\.(?:mp4|avi|mov|wmv|flv|mkv|webm|mp3|wav|flac|aac|ogg|m4a|wma|pdf|doc|docx|xls|xlsx|ppt|pptx|txt|zip|rar|7z|tar|gz))(?:\s|$)/gi;
  
  const matches = Array.from(content.matchAll(rawPathPattern));
  
  if (matches.length === 0) {
    return content;
  }
  
  log?.info?.(`${logPrefix} 检测到 ${matches.length} 个裸露的本地文件路径`);
  
  let processedContent = content;
  const statusMessages: string[] = [];
  
  for (const match of matches) {
    const fullMatch = match[0];
    const filePath = match[1].trim();
    
    try {
      log?.info?.(`${logPrefix} 开始处理文件: ${filePath}`);
      
      // 判断文件类型
      const ext = filePath.toLowerCase().split('.').pop() || '';
      let mediaType: 'video' | 'voice' | 'file';
      
      if (['mp4', 'avi', 'mov', 'wmv', 'flv', 'mkv', 'webm'].includes(ext)) {
        mediaType = 'video';
      } else if (['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a', 'wma'].includes(ext)) {
        mediaType = 'voice';  // 钉钉 API 中音频类型是 'voice'
      } else {
        mediaType = 'file';
      }
      
      // 上传文件到钉钉
      const uploadResult = await uploadMediaToDingTalk(
        filePath,
        mediaType,
        oapiToken,
        20 * 1024 * 1024,
        log
      );
      
      if (!uploadResult) {
        log?.error?.(`${logPrefix} 文件上传失败: ${filePath}`);
        statusMessages.push(`⚠️ 文件上传失败: ${filePath}`);
        continue;
      }
      
      // 发送媒体消息
      const fileName = filePath.split(/[\/\\]/).pop() || 'unknown';
      
      if (mediaType === 'video') {
        // 提取视频元数据
        const metadata = await extractVideoMetadata(filePath, log);
        
        if (target) {
          // 视频消息需要原始 mediaId（带 @）
          await sendVideoProactive(config, target, uploadResult.mediaId, fileName, log, metadata);
        }
        statusMessages.push(`✅ 视频已发送: ${fileName}`);
      } else if (mediaType === 'voice') {
        // 提取音频时长
        const durationMs = await extractAudioDuration(filePath, log);
        
        if (target) {
          // 音频消息使用下载链接
          await sendAudioProactive(config, target, fileName, uploadResult.downloadUrl, log, durationMs ?? undefined);
        }
        statusMessages.push(`✅ 音频已发送: ${fileName}`);
      } else {
        // 文件消息
        const fileInfo: FileInfo = {
          path: filePath,
          fileName: fileName,
          fileType: ext,
        };
        
        if (target) {
          await sendFileProactive(config, target, fileInfo, uploadResult.mediaId, log);
        }
        statusMessages.push(`✅ 文件已发送: ${fileName}`);
      }
      
      // 从响应中移除文件路径
      processedContent = processedContent.replace(fullMatch, fullMatch.replace(filePath, ''));
      
      log?.info?.(`${logPrefix} 文件处理完成: ${fileName}`);
    } catch (err: any) {
      log?.error?.(`${logPrefix} 处理文件失败: ${filePath}, 错误: ${err.message}`);
      statusMessages.push(`⚠️ 处理失败: ${filePath}`);
    }
  }
  
  // 添加状态消息到响应中
  if (statusMessages.length > 0) {
    const statusText = '\n\n' + statusMessages.join('\n');
    processedContent = processedContent.trim() + statusText;
  }
  
  return processedContent;
}

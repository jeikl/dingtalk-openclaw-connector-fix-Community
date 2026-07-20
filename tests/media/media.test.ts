import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  isLocalImageRef,
  looksLikeRemoteUrl,
  processImagesForOutbound,
  processLocalImages,
  toLocalPath,
} from '../../src/services/media.ts';

describe('media helpers', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('toLocalPath / looksLikeRemoteUrl / isLocalImageRef 区分 file:// 与 http', () => {
    expect(toLocalPath('file:///tmp/a.png')).toBe('/tmp/a.png');
    expect(looksLikeRemoteUrl('http://x/a.jpg')).toBe(true);
    expect(looksLikeRemoteUrl('https://x/a.jpg')).toBe(true);
    expect(looksLikeRemoteUrl('/tmp/a.jpg')).toBe(false);
    // 回归：file:// 绝不能当远程（否则会 fetch failed → 灰图）
    expect(looksLikeRemoteUrl('file:///mnt/smb/a.jpg')).toBe(false);
    expect(looksLikeRemoteUrl('file:///root/a.gif')).toBe(false);
    expect(isLocalImageRef('file:///mnt/smb/a.jpg')).toBe(true);
    expect(isLocalImageRef('file:///root/out/x.gif')).toBe(true);
    expect(isLocalImageRef('/tmp/a.jpg')).toBe(true);
    expect(isLocalImageRef('http://x/a.jpg')).toBe(false);
  });

  it('file:// 本地图走上传分支而非远程 download', async () => {
    const tmp = path.join(os.tmpdir(), `dingtalk-file-scheme-test-${Date.now()}.png`);
    // 最小 PNG
    fs.writeFileSync(
      tmp,
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        'base64',
      ),
    );
    const fileUri = `file://${tmp}`;
    const content = `图\n\n![x](${fileUri})`;
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    // 不 mock 上传 HTTP 时会失败，但关键是：绝不能走 fetch 远程分支
    const r = await processImagesForOutbound(content, 'fake-token');
    expect(fetchSpy).not.toHaveBeenCalled();
    // 上传会失败（fake token），应换成失败提示或至少不再是 file:// 原样（exists 时上传）
    // fake token → OAPI 失败 → 失败提示
    expect(r.text).not.toContain('file://');
    try {
      fs.unlinkSync(tmp);
    } catch {
      // ignore
    }
  });

  it('远程 ![] 上传失败时仍不拆消息，下载 URL 留在同一正文', async () => {
    const url = 'http://bclaw.edav.top:9000/ailai/weicuimei/akg-img5306.jpg';
    const content = `维萃美AKG\n\n![AKG](${url})\n\n下载链接：${url}`;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        headers: { get: () => null },
        arrayBuffer: async () => new ArrayBuffer(0),
      }),
    );
    const r = await processImagesForOutbound(content, 'fake-token');
    expect(r.followUpUrls).toEqual([]);
    // 下载失败则 ![] 仍是原 URL，下载链接也在
    expect(r.text).toContain(`![AKG](${url})`);
    expect(r.text).toContain(`下载链接：${url}`);
  });

  it('裸路径不处理、不拆消息', async () => {
    const r = await processImagesForOutbound('看 /tmp/a.png', 'tok');
    expect(r.text).toBe('看 /tmp/a.png');
    expect(r.followUpUrls).toEqual([]);
  });

  it('processLocalImages 返回 string', async () => {
    expect(await processLocalImages('hi', null)).toBe('hi');
  });
});

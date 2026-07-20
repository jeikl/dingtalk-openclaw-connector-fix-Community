import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
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

  it('toLocalPath / looksLikeRemoteUrl', () => {
    expect(toLocalPath('file:///tmp/a.png')).toBe('/tmp/a.png');
    expect(looksLikeRemoteUrl('http://x/a.jpg')).toBe(true);
    expect(looksLikeRemoteUrl('/tmp/a.jpg')).toBe(false);
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

/**
 * 出站路由单元测试
 *
 * 验证 sendTextToDingTalk / sendMediaToDingTalk 正确解析 group:/user: 前缀，
 * 以及 channel.ts resolveAllowFrom 返回空列表不影响内部策略过滤。
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock http client
const mockPost = vi.hoisted(() => vi.fn());
const mockGet = vi.hoisted(() => vi.fn());
vi.mock("../../src/utils/http-client.ts", () => ({
  dingtalkHttp: { post: mockPost, get: mockGet },
  dingtalkOapiHttp: { get: mockGet, post: mockPost },
  dingtalkUploadHttp: { post: mockPost, get: mockGet },
}));

// Mock token — 直接返回 fake token，避免 HTTP 请求
const mockGetOapiAccessToken = vi.hoisted(() => vi.fn().mockResolvedValue(null));
vi.mock("../../src/utils/token.ts", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../../src/utils/token.ts")>();
  return {
    ...orig,
    getAccessToken: vi.fn().mockResolvedValue("fake-token"),
    getOapiAccessToken: mockGetOapiAccessToken,
    DINGTALK_API: orig.DINGTALK_API,
    DINGTALK_OAPI: orig.DINGTALK_OAPI,
  };
});

// processLocalImages：测试可注入「上传后」的 markdown
const mockProcessLocalImages = vi.hoisted(() =>
  vi.fn(async (content: string) => content),
);
vi.mock("../../src/services/media.ts", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../../src/services/media.ts")>();
  return {
    ...orig,
    processLocalImages: mockProcessLocalImages,
    uploadMediaToDingTalk: vi.fn().mockResolvedValue({
      mediaId: "@test-media-id",
      cleanMediaId: "test-media-id",
      downloadUrl: "https://down.dingtalk.com/media/test-media-id",
    }),
  };
});

// Mock AI Card 创建，让 sendProactive 走普通消息路径（useAICard: false）
vi.mock("../../src/services/messaging/card.ts", () => ({
  createAICardForTarget: vi.fn().mockResolvedValue(null), // 返回 null → fallback 到普通消息
  finishAICard: vi.fn(),
  streamAICard: vi.fn(),
  updateAICard: vi.fn(),
}));

const config = {
  clientId: "ding_client_id",
  clientSecret: "ding_client_secret",
};

describe("sendTextToDingTalk target routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetOapiAccessToken.mockResolvedValue(null);
    mockProcessLocalImages.mockImplementation(async (content: string) => content);
    // 默认 API 调用返回成功
    mockPost.mockResolvedValue({ data: { processQueryKey: "pqk-123" }, status: 200 });
  });

  it("group:cid... 前缀 → 调用群消息 API，openConversationId 去掉前缀", async () => {
    const { sendTextToDingTalk } = await import("../../src/services/messaging.ts");
    await sendTextToDingTalk({ config, target: "group:cidABC123==", text: "hello" });

    expect(mockPost).toHaveBeenCalledWith(
      expect.stringContaining("/groupMessages/send"),
      expect.objectContaining({ openConversationId: "cidABC123==" }),
      expect.anything(),
    );
  });

  it("cid... 无前缀 → 调用群消息 API（旧格式兼容）", async () => {
    const { sendTextToDingTalk } = await import("../../src/services/messaging.ts");
    await sendTextToDingTalk({ config, target: "cidABC123==", text: "hello" });

    expect(mockPost).toHaveBeenCalledWith(
      expect.stringContaining("/groupMessages/send"),
      expect.objectContaining({ openConversationId: "cidABC123==" }),
      expect.anything(),
    );
  });

  it("user:xxx 前缀 → 调用单聊消息 API，userId 去掉前缀", async () => {
    const { sendTextToDingTalk } = await import("../../src/services/messaging.ts");
    await sendTextToDingTalk({ config, target: "user:staff001", text: "hello" });

    expect(mockPost).toHaveBeenCalledWith(
      expect.stringContaining("/oToMessages/batchSend"),
      expect.objectContaining({ userIds: ["staff001"] }),
      expect.anything(),
    );
  });

  it("裸 userId（无前缀且不以 cid 开头）→ 调用单聊消息 API", async () => {
    const { sendTextToDingTalk } = await import("../../src/services/messaging.ts");
    await sendTextToDingTalk({ config, target: "staff001", text: "hello" });

    expect(mockPost).toHaveBeenCalledWith(
      expect.stringContaining("/oToMessages/batchSend"),
      expect.objectContaining({ userIds: ["staff001"] }),
      expect.anything(),
    );
  });

  it("旧行为回归：group:cidXXX== 不再被误路由为单聊", async () => {
    const { sendTextToDingTalk } = await import("../../src/services/messaging.ts");
    await sendTextToDingTalk({ config, target: "group:cidXXX==", text: "hello" });

    // 不应调用单聊 API
    const calls = mockPost.mock.calls.map((c) => c[0]);
    expect(calls.every((url: string) => !url.includes("oToMessages"))).toBe(true);
  });

  it("含 markdown 图片时使用 sampleMarkdown（避免 text 灰图）", async () => {
    mockGetOapiAccessToken.mockResolvedValue("oapi-token");
    mockProcessLocalImages.mockResolvedValue("看图：\n\n![](@media-id-1)");

    const { sendTextToDingTalk } = await import("../../src/services/messaging.ts");
    await sendTextToDingTalk({
      config,
      target: "user:staff001",
      text: "看图：\n\n![](file:///tmp/a.png)",
    });

    expect(mockProcessLocalImages).toHaveBeenCalled();
    expect(mockPost).toHaveBeenCalledWith(
      expect.stringContaining("/oToMessages/batchSend"),
      expect.objectContaining({
        msgKey: "sampleMarkdown",
        msgParam: expect.stringContaining("media-id-1"),
      }),
      expect.anything(),
    );
  });
});

describe("sendMediaToDingTalk image strategy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetOapiAccessToken.mockResolvedValue("oapi-token");
    mockProcessLocalImages.mockImplementation(async (content: string) => content);
    mockPost.mockResolvedValue({ data: { processQueryKey: "pqk-media" }, status: 200 });
  });

  it("默认 messageImageMd=false：文图分开（先 text 再 image）", async () => {
    const { sendMediaToDingTalk } = await import("../../src/services/messaging.ts");
    await sendMediaToDingTalk({
      config,
      target: "user:staff001",
      text: "两张图一起发试试",
      mediaUrl: "file:///tmp/photo.png",
    });

    const batchCalls = mockPost.mock.calls.filter(
      (c) => typeof c[0] === "string" && String(c[0]).includes("oToMessages"),
    );
    expect(batchCalls.length).toBeGreaterThanOrEqual(2);
    const keys = batchCalls.map((c) => (c[1] as { msgKey?: string }).msgKey);
    expect(keys).toContain("sampleImageMsg");
    // 第一段为文案
    expect(keys[0] === "sampleText" || keys[0] === "sampleMarkdown").toBe(true);
  });

  it("messageImageMd=true 且正文已有图：合并 markdown", async () => {
    mockProcessLocalImages.mockResolvedValue("见图\n\n![](@existing)");
    const { sendMediaToDingTalk } = await import("../../src/services/messaging.ts");
    await sendMediaToDingTalk({
      config: { ...config, messageImageMd: true },
      target: "user:staff001",
      text: "见图\n\n![](/tmp/a.png)",
      mediaUrl: "file:///tmp/photo.png",
    });

    const batchCalls = mockPost.mock.calls.filter(
      (c) => typeof c[0] === "string" && String(c[0]).includes("oToMessages"),
    );
    expect(batchCalls.length).toBe(1);
    const body = batchCalls[0][1] as { msgKey?: string; msgParam?: string };
    expect(body.msgKey).toBe("sampleMarkdown");
  });
});

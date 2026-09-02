import { beforeEach, describe, expect, it, vi } from "vitest";

const mockSendProactive = vi.hoisted(() => vi.fn());
const mockGatewayRequest = vi.hoisted(() => vi.fn(async () => ({ ok: true, aborted: true })));
const mockDispatchReply = vi.hoisted(() => vi.fn(async () => ({ queuedFinal: false, counts: { final: 1 } })));

vi.mock("../../src/utils/utils-legacy.ts", () => ({
  isMessageProcessed: vi.fn(() => false),
  markMessageProcessed: vi.fn(),
  buildSessionContext: vi.fn((params: any) => ({
    sessionPeerId: params?.conversationId || params?.senderId || "peer-default",
    chatType: "direct",
  })),
  getAccessToken: vi.fn(async () => "tk"),
  getOapiAccessToken: vi.fn(async () => null),
  DINGTALK_API: "https://api.dingtalk.com",
  DINGTALK_OAPI: "https://oapi.dingtalk.com",
  addEmotionReply: vi.fn(async () => undefined),
  recallEmotionReply: vi.fn(async () => undefined),
  getUserProfile: vi.fn(async () => ({ nick: "User", avatarUrl: "" })),
  formatHiredDateShanghai: vi.fn(() => ""),
  formatSenderDisplayLabel: vi.fn((p: any) => p.realName || p.nickName || ""),
  formatSenderRoles: vi.fn(() => ""),
}));

vi.mock("../../src/services/media/index.ts", () => ({
  processLocalImages: vi.fn(async (s: string) => s),
  processVideoMarkers: vi.fn(async (s: string) => s),
  processAudioMarkers: vi.fn(async (s: string) => s),
  uploadAndReplaceFileMarkers: vi.fn(async (s: string) => s),
  uploadMediaToDingTalk: vi.fn(async () => null),
  toLocalPath: vi.fn((s: string) => s),
  FILE_MARKER_PATTERN: /\[DINGTALK_FILE\](.*?)\[\/DINGTALK_FILE\]/gs,
  VIDEO_MARKER_PATTERN: /\[DINGTALK_VIDEO\](.*?)\[\/DINGTALK_VIDEO\]/gs,
  AUDIO_MARKER_PATTERN: /\[DINGTALK_AUDIO\](.*?)\[\/DINGTALK_AUDIO\]/gs,
}));

vi.mock("../../src/services/messaging/index.ts", () => ({
  sendProactive: mockSendProactive,
  createAICardForTarget: vi.fn(async () => null),
  streamAICard: vi.fn(async () => undefined),
  finishAICard: vi.fn(async () => undefined),
}));

vi.mock("../../src/reply-dispatcher.ts", () => ({
  createDingtalkReplyDispatcher: vi.fn(() => ({
    dispatcher: {},
    replyOptions: {},
    markDispatchIdle: vi.fn(),
    getAsyncModeResponse: vi.fn(() => ""),
    finalizeDispatchError: vi.fn(async () => undefined),
  })),
  matchModelErrorText: vi.fn(),
}));

vi.mock("../../src/runtime.ts", () => ({
  getDingtalkRuntime: vi.fn(() => ({
    gateway: {
      request: mockGatewayRequest,
    },
    channel: {
      reply: {
        resolveEnvelopeFormatOptions: vi.fn(() => ({})),
        formatAgentEnvelope: vi.fn(() => "body"),
        finalizeInboundContext: vi.fn((ctx: any) => ctx || {}),
        withReplyDispatcher: vi.fn(async (opts: any) => {
          if (typeof opts?.run === "function") {
            return opts.run();
          }
          return { queuedFinal: false, counts: { final: 1 } };
        }),
        dispatchReplyFromConfig: mockDispatchReply,
      },
      routing: {
        buildAgentSessionKey: vi.fn(() => "agent:main:dingtalk-connector:peer-1"),
      },
    },
  })),
}));

describe("handleDingTalkMessage - /stop queue penetration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("penetrates the queue immediately when /stop is sent and calls gateway chat.abort", async () => {
    const { handleDingTalkMessage } = await import("../../src/core/message-handler.ts");

    let slowTaskResolve: () => void;
    const slowTaskPromise = new Promise<void>((resolve) => {
      slowTaskResolve = resolve;
    });

    mockDispatchReply.mockReset();
    mockDispatchReply.mockImplementation(async (params: any) => {
      const text = params?.ctx?.CommandBody || params?.ctx?.RawBody || "";
      if (text.includes("做一个大任务")) {
        await slowTaskPromise;
        return { queuedFinal: false, counts: { final: 1 } };
      }
      return { queuedFinal: false, counts: { final: 1 } };
    });

    const runNormal = handleDingTalkMessage({
      accountId: "acc-1",
      sessionWebhook: "https://mock.webhook",
      config: { clientId: "id", clientSecret: "sec" } as any,
      data: {
        msgtype: "text",
        text: { content: "做一个大任务" },
        conversationType: "1",
        senderStaffId: "user-1",
        senderId: "user-1",
        conversationId: "conv-1",
      } as any,
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any,
      cfg: { defaultAgent: "main" } as any,
    });

    // 等待微任务让 normal 消息进入队列并占槽
    await new Promise((r) => setTimeout(r, 50));

    const runStop = handleDingTalkMessage({
      accountId: "acc-1",
      sessionWebhook: "https://mock.webhook",
      config: { clientId: "id", clientSecret: "sec" } as any,
      data: {
        msgtype: "text",
        text: { content: "/stop" },
        conversationType: "1",
        senderStaffId: "user-1",
        senderId: "user-1",
        conversationId: "conv-1",
      } as any,
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any,
      cfg: { defaultAgent: "main" } as any,
    });

    // /stop 穿透执行，直接触发 gateway.request("chat.abort")
    await new Promise((r) => setTimeout(r, 50));

    // 验证 Gateway chat.abort 被调用
    expect(mockGatewayRequest).toHaveBeenCalledWith(
      "chat.abort",
      expect.objectContaining({
        sessionKey: "agent:main:dingtalk-connector:peer-1",
        agentId: "main",
      })
    );

    // 验证没有发送“上一条还没结束”排队 ACK
    expect(mockSendProactive).not.toHaveBeenCalled();

    // 释放长任务
    slowTaskResolve!();
    await Promise.all([runNormal, runStop]);
  });

  it("skips queued task execution when /stop invalidates the queue epoch", async () => {
    const { handleDingTalkMessage } = await import("../../src/core/message-handler.ts");

    let slowTaskResolve: () => void;
    const slowTaskPromise = new Promise<void>((resolve) => {
      slowTaskResolve = resolve;
    });

    const executedTasks: string[] = [];

    let task1StartedResolve: () => void;
    const task1Started = new Promise<void>((resolve) => {
      task1StartedResolve = resolve;
    });

    let stopTaskDoneResolve: () => void;
    const stopTaskDone = new Promise<void>((resolve) => {
      stopTaskDoneResolve = resolve;
    });

    mockDispatchReply.mockImplementation(async (params: any) => {
      const text = params?.ctx?.CommandBody || params?.ctx?.RawBody || "";
      if (text.includes("任务 1")) {
        executedTasks.push("task-1");
        task1StartedResolve();
        await slowTaskPromise;
        return { queuedFinal: false, counts: { final: 1 } };
      }
      if (text.includes("任务 2")) {
        executedTasks.push("task-2");
        return { queuedFinal: false, counts: { final: 1 } };
      }
      if (text.includes("停止") || text.includes("stop")) {
        executedTasks.push("task-stop");
        stopTaskDoneResolve();
        return { queuedFinal: false, counts: { final: 1 } };
      }
      return { queuedFinal: false, counts: { final: 1 } };
    });

    const run1 = handleDingTalkMessage({
      accountId: "acc-1",
      sessionWebhook: "https://mock.webhook",
      config: { clientId: "id", clientSecret: "sec" } as any,
      data: {
        msgtype: "text",
        text: { content: "任务 1" },
        conversationType: "1",
        senderStaffId: "user-2",
        senderId: "user-2",
        conversationId: "conv-2",
      } as any,
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any,
      cfg: { defaultAgent: "main" } as any,
    });

    // 等待 Task 1 真正开始执行
    await task1Started;

    const run2 = handleDingTalkMessage({
      accountId: "acc-1",
      sessionWebhook: "https://mock.webhook",
      config: { clientId: "id", clientSecret: "sec" } as any,
      data: {
        msgtype: "text",
        text: { content: "任务 2" },
        conversationType: "1",
        senderStaffId: "user-2",
        senderId: "user-2",
        conversationId: "conv-2",
      } as any,
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any,
      cfg: { defaultAgent: "main" } as any,
    });

    await new Promise((r) => setTimeout(r, 50));

    const runStop = handleDingTalkMessage({
      accountId: "acc-1",
      sessionWebhook: "https://mock.webhook",
      config: { clientId: "id", clientSecret: "sec" } as any,
      data: {
        msgtype: "text",
        text: { content: "停止" },
        conversationType: "1",
        senderStaffId: "user-2",
        senderId: "user-2",
        conversationId: "conv-2",
      } as any,
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any,
      cfg: { defaultAgent: "main" } as any,
    });

    // 等待 /stop 穿透执行完毕
    await stopTaskDone;

    // 释放 Task 1
    slowTaskResolve!();
    await new Promise((r) => setTimeout(r, 100));

    // 验证：Task 1 执行了，/stop 执行了，但是排队的 Task 2 被 epoch 作废并跳过了
    expect(executedTasks).toContain("task-1");
    expect(executedTasks).toContain("task-stop");
    expect(executedTasks).not.toContain("task-2");
  });
});

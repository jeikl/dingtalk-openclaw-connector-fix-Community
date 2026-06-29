import { describe, it, expect } from "vitest";
import { extractFinal, finalClean, displayClean, stripAllMarkers, estimateTokens } from "../src/services/reply-markers.ts";

// 剥光方案：含 [-final-] = 最终答案，剥光所有标记保留完整正文；否则 null。
describe("extractFinal — 含 [-final-] → 剥光所有标记的完整正文", () => {
  it("多段过程 + 末尾 final → 保留全部步骤+汇总，标记全剥", () =>
    expect(extractFinal("步骤1[-process-]步骤2[-process-]汇总[-final-]")).toBe("步骤1步骤2汇总"));

  it("末尾 final（无 process）", () =>
    expect(extractFinal("你好世界[-final-]")).toBe("你好世界"));

  it("final 在中间也算最终答案，全部剥光", () =>
    expect(extractFinal("你好[-final-]世界")).toBe("你好世界"));

  it("只有 process（无 final） → null", () =>
    expect(extractFinal("步骤1[-process-]步骤2[-process-]")).toBeNull());

  it("无标记 → null", () => expect(extractFinal("普通文本")).toBeNull());
});

describe("finalClean / stripAllMarkers — 剥光所有标记", () => {
  it("message 单条过程消息", () =>
    expect(finalClean("第一轮汇报：xxx[-process-]")).toBe("第一轮汇报：xxx"));
  it("剥光中间 + 末尾标记，正文全留", () =>
    expect(finalClean("a[-process-]b[-final-]")).toBe("ab"));
  it("中间标记也剥", () =>
    expect(stripAllMarkers("你好[-final-]世界")).toBe("你好世界"));
});

describe("displayClean — 流式展示", () => {
  it("剥半截尾标记", () => expect(displayClean("回答[-fin")).toBe("回答"));
  it("剥光完整标记", () => expect(displayClean("步骤[-process-]")).toBe("步骤"));
});

describe("estimateTokens — 答案卡阈值估算", () => {
  it("空 → 0", () => expect(estimateTokens("")).toBe(0));
  it("CJK 每字约 1 token", () => expect(estimateTokens("你好世界")).toBe(4));
  it("英文约 4 字符 1 token", () => expect(estimateTokens("abcdefgh")).toBe(2));
  it("中英混合相加", () => expect(estimateTokens("你好abcd")).toBe(2 + 1));
  it("长中文超过 600 阈值可判定", () =>
    expect(estimateTokens("中".repeat(700)) > 600).toBe(true));
});

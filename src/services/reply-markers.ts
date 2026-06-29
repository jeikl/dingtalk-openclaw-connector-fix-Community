// 回复标记工具 —— 配合 prompt-rewriter 插件注入的"打标记"指令使用。
//
// 【剥光方案】只要文本里出现 [-final-]（头/尾/中间任意位置）→ 这就是最终回复，
//   把所有 [-process-] / [-final-] 标记全部剥掉，保留完整正文。
//   没有 [-final-]、只有 [-process-] → 过程段（流式中展示，不定稿）。
//   规则极简，不分段、不挑位置，避免一堆特殊情况的 bug。
//
// ⚠️ 标记字面量必须与 prompt-rewriter 的 rewriter.ts 保持一致（两处重复，改一处要同步另一处）。

export const PROCESS_TAG = "[-process-]";
export const FINAL_TAG = "[-final-]";

const EDGE_WS = /^[ \t\r\n]+|[ \t\r\n]+$/g;

/** 剥掉文本中所有 [-process-] / [-final-] 标记（头、尾、中间全部），首尾空白清掉。 */
export function stripAllMarkers(text: string | undefined | null): string {
  if (!text) return "";
  return text.split(PROCESS_TAG).join("").split(FINAL_TAG).join("").replace(EDGE_WS, "");
}

/** 取最终答案：文本含 [-final-]（任意位置）→ 剥光所有标记、返回完整正文；否则 null（非最终答案）。 */
export function extractFinal(text: string | undefined | null): string | null {
  if (!text || !text.includes(FINAL_TAG)) return null;
  return stripAllMarkers(text);
}

/** 去掉流式途中末尾未闭合的半截标记（如 "[-fin"，缺右 "]"）。完整标记交给 stripAllMarkers。 */
export function stripPartialTail(text: string | undefined | null): string {
  if (!text) return "";
  return text.replace(/\[-[a-z]*-?$/i, "");
}

/** 定稿 / 单条消息用：剥光所有标记，保留完整正文。 */
export function finalClean(text: string | undefined | null): string {
  return stripAllMarkers(text);
}

/** 流式展示用：剥光所有标记 + 末尾半截标记。 */
export function displayClean(text: string | undefined | null): string {
  return stripPartialTail(stripAllMarkers(text));
}

/** 粗略估算 token 数：CJK 字 ~1 token/字，其余 ~1 token/4 字符。
 *  用于"答案卡阈值"判断，不要求精确（OpenClaw 的 usage 是整轮的，拿不到单条最终答案的 token）。
 *  ponytail: 字符级启发式，足够给阈值判断用；要更精确再换 tokenizer 库。 */
export function estimateTokens(text: string | undefined | null): number {
  if (!text) return 0;
  let cjk = 0;
  let other = 0;
  for (const ch of text) {
    // CJK 统一表意 + 扩展A + 兼容 + 假名 + 谚文
    if (/[㐀-鿿豈-﫿぀-ヿ가-힯]/.test(ch)) cjk++;
    else other++;
  }
  return cjk + Math.ceil(other / 4);
}

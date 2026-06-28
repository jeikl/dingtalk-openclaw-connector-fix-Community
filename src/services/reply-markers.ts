// 回复标记工具 —— 配合 prompt-rewriter 插件注入的"打标记"指令使用。
//
// 【单标记方案，位置无关】指令要求每条消息【末尾】加标记（过程 [-process-]、最终答案 [-final-]，整轮一个），
// 但模型常把标记放开头。所以提取/剥离都【不依赖位置】：只删那一个标记 token，其余原样。
//   最终答案 = 带 [-final-] 的那条消息去掉该标记后的内容。
//   正文里其它同名字面量（模型解释标记时）原样保留——只动作为信号的那一个。
//
// ⚠️ 标记字面量与逻辑必须与 prompt-rewriter 的 rewriter.ts 保持一致（两处重复，改一处要同步另一处）。

export const PROCESS_TAG = "[-process-]";
export const FINAL_TAG = "[-final-]";

const EDGE_WS = /^[ \t\r\n]+|[ \t\r\n]+$/g;

/** 文本里是否带任一标记（用于"带标记走记号规则 / 不带走兜底"的分流判断）。 */
export function hasMarkers(text: string | undefined | null): boolean {
  if (!text) return false;
  return text.includes(PROCESS_TAG) || text.includes(FINAL_TAG);
}

/** 取最终答案：去掉那一个 [-final-]（开头/中间/结尾都行），其余原样，首尾空白清掉。
 *  没有 [-final-] 返回 null。多处出现取最后一个当信号。 */
export function extractFinal(text: string | undefined | null): string | null {
  if (!text) return null;
  const i = text.lastIndexOf(FINAL_TAG);
  if (i < 0) return null;
  return (text.slice(0, i) + text.slice(i + FINAL_TAG.length)).replace(EDGE_WS, "");
}

/** 剥掉一个标记 token（[-process-] 或 [-final-]，位置无关，取最后一个），其余原样，首尾空白清掉。 */
export function stripOneMarker(text: string | undefined | null): string {
  if (!text) return "";
  const pi = text.lastIndexOf(PROCESS_TAG);
  const fi = text.lastIndexOf(FINAL_TAG);
  if (pi < 0 && fi < 0) return text.replace(EDGE_WS, "");
  const [i, len] = fi >= pi ? [fi, FINAL_TAG.length] : [pi, PROCESS_TAG.length];
  return (text.slice(0, i) + text.slice(i + len)).replace(EDGE_WS, "");
}

/** 去掉流式途中末尾未闭合的半截标记（如 "[-fin"，缺右 "]"）。完整标记交给上面两个函数。 */
export function stripPartialTail(text: string | undefined | null): string {
  if (!text) return "";
  return text.replace(/\[-[a-z]*-?$/i, "");
}

/** 定稿用：有 [-final-] 去掉它；否则剥一个标记。正文不动。 */
export function finalClean(text: string | undefined | null): string {
  return extractFinal(text) ?? stripOneMarker(text);
}

/** 流式展示用：有 [-final-] 直接显示最终答案；否则剥一个标记 + 半截标记，正文不动。 */
export function displayClean(text: string | undefined | null): string {
  const fin = extractFinal(text);
  return fin !== null ? fin : stripPartialTail(stripOneMarker(text));
}

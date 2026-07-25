/**
 * 后台任务引用计数。
 *
 * 钉钉 WS 回调只「入队」后就返回，真正的 AI 跑在 sessionQueues 后台 Promise 里。
 * 若只在 WS 回调里 markMessageProcessingStart/End，会在入队后立刻 End，
 * 长任务（尤其 503 重试）期间心跳超时会触发幽灵重连 → 后续消息「网关没反应」。
 *
 * 用法：session 队列任务创建后 trackBackgroundWork(taskPromise)。
 * connection 层订阅计数变化，在 count>0 时保持处理中 keepAlive。
 */

import { isDingtalkDebug } from "./logger.ts";

type CountListener = (count: number) => void;

let activeCount = 0;
const listeners = new Set<CountListener>();

export function getActiveBackgroundWorkCount(): number {
  return activeCount;
}

/** 订阅计数变化；返回取消订阅函数 */
export function onBackgroundWorkCountChange(listener: CountListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notify(): void {
  for (const listener of listeners) {
    try {
      listener(activeCount);
    } catch {
      // ignore listener errors
    }
  }
}

/**
 * 跟踪一个后台 Promise：开始 +1，settle -1。
 * 重复 settle 安全（只减一次）。
 */
export function trackBackgroundWork(
  work: Promise<unknown>,
  label?: string,
): void {
  activeCount += 1;
  notify();
  let settled = false;
  const done = () => {
    if (settled) return;
    settled = true;
    activeCount = Math.max(0, activeCount - 1);
    notify();
  };
  void work.then(done, done);
  if (label && typeof process !== "undefined" && isDingtalkDebug()) {
    console.log(`[DingTalk][bgWork] +1 label=${label} count=${activeCount}`);
    void work.finally(() => {
      console.log(`[DingTalk][bgWork] -1 label=${label} count=${activeCount}`);
    });
  }
}

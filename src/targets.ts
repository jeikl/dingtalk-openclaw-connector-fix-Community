import type { DingtalkMessageContext } from "./types/index.ts";

function stripProviderPrefix(raw: string): string {
  return raw.replace(/^(dingtalk|dd|ding):/i, "").trim();
}

export function normalizeDingtalkTarget(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }

  const withoutProvider = stripProviderPrefix(trimmed);
  const lowered = withoutProvider.toLowerCase();
  if (lowered.startsWith("user:")) {
    return withoutProvider.slice("user:".length).trim() || null;
  }
  if (lowered.startsWith("group:")) {
    return withoutProvider.slice("group:".length).trim() || null;
  }

  return withoutProvider;
}

export function formatDingtalkTarget(id: string, type?: "user" | "group"): string {
  const trimmed = id.trim();
  if (type === "group") {
    return `group:${trimmed}`;
  }
  if (type === "user") {
    return `user:${trimmed}`;
  }
  return trimmed;
}

export function looksLikeDingtalkId(raw: string): boolean {
  const trimmed = stripProviderPrefix(raw.trim());
  if (!trimmed) {
    return false;
  }
  if (/^(user|group):/i.test(trimmed)) {
    return true;
  }
  return true;
}

/**
 * Infer OpenClaw chat type for outbound session routing.
 * Must match resolveOutboundTarget in services/messaging.ts:
 * - group:… / cid… → group
 * - user:… / bare id → direct (DM)
 *
 * Core detectTargetKind defaults bare ids to "group" (Telegram-style), which
 * wrongly routes DingTalk DM userIds into group: sessions and drops delivery
 * context from the real direct: session UI/model history.
 */
export function inferDingtalkTargetChatType(raw: string): "direct" | "group" | undefined {
  const trimmed = stripProviderPrefix(raw.trim());
  if (!trimmed) {
    return undefined;
  }
  const lowered = trimmed.toLowerCase();
  if (lowered.startsWith("group:") || lowered.startsWith("cid")) {
    return "group";
  }
  if (lowered.startsWith("user:")) {
    return "direct";
  }
  // bare staffId / userId → DM (same as messaging resolveOutboundTarget)
  return "direct";
}

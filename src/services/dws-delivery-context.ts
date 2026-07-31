/**
 * DWS 发消息成功后注入 outbound_message 上下文（对齐 OpenClaw message 工具 OC-4）。
 *
 * - 不修改 dws 本体：仅解析 OpenClaw exec/shell 回调里看到的命令行
 * - 默认开启（target）：只在 dws 发消息成功时追加上下文，不影响普通回复 / message 工具
 * - 可配置 off | target | source | both
 */
import { CHANNEL_ID } from "../channel.ts";

export type DwsDeliveryContextMode = "off" | "target" | "source" | "both";

export type ParsedDwsSendCommand = {
  /** dws 子命令身份 */
  kind: "user-send" | "bot-send" | "webhook-send" | "reply";
  /** 规范化后的 message 工具风格 target：group:… / user:… */
  target?: string;
  /** 原始 openConversationId / userId / openDingTalkId */
  rawTarget?: string;
  targetChatType?: "group" | "direct";
  message?: string;
  title?: string;
  atAll?: boolean;
  atUserIds?: string[];
  atOpenDingTalkIds?: string[];
  atMobiles?: string[];
  robotCode?: string;
  /** 原始命令文本（截断后写入 args） */
  command: string;
};

const SEND_COMMAND_RE =
  /\bdws\b(?:\s+[^\s]+)*\s+chat\s+message\s+(send-by-bot|send-by-webhook|send|reply)\b/i;

/** 从命令行提取 --flag value / --flag=value / 布尔 --flag */
function extractFlag(cmd: string, name: string): string | undefined {
  const eq = new RegExp(`--${name}(?:=|\\s+)(?:"([^"]*)"|'([^']*)'|(\\S+))`, "i");
  const m = cmd.match(eq);
  if (!m) return undefined;
  return (m[1] ?? m[2] ?? m[3] ?? "").trim() || undefined;
}

function hasBoolFlag(cmd: string, name: string): boolean {
  return new RegExp(`(?:^|\\s)--${name}(?:\\s|=|$)`, "i").test(cmd);
}

function splitCsv(raw?: string): string[] | undefined {
  if (!raw) return undefined;
  const parts = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length ? parts : undefined;
}

/**
 * 判断是否为 dws 发消息类命令，并解析关键参数。
 * 解析失败返回 null（调用方 no-op，不影响现有体验）。
 */
export function parseDwsSendCommand(commandText: string): ParsedDwsSendCommand | null {
  const cmd = String(commandText || "").trim();
  if (!cmd) return null;
  const m = cmd.match(SEND_COMMAND_RE);
  if (!m) return null;

  const sub = m[1].toLowerCase();
  let kind: ParsedDwsSendCommand["kind"];
  if (sub === "send-by-bot") kind = "bot-send";
  else if (sub === "send-by-webhook") kind = "webhook-send";
  else if (sub === "reply") kind = "reply";
  else kind = "user-send";

  const group =
    extractFlag(cmd, "group") ||
    extractFlag(cmd, "conversation-id") ||
    extractFlag(cmd, "id") ||
    extractFlag(cmd, "chat");
  const user =
    extractFlag(cmd, "user") ||
    extractFlag(cmd, "open-dingtalk-id") ||
    // 批量单聊取第一个，便于 session 映射
    splitCsv(extractFlag(cmd, "users"))?.[0] ||
    splitCsv(extractFlag(cmd, "open-dingtalk-ids"))?.[0];

  const text =
    extractFlag(cmd, "text") ||
    extractFlag(cmd, "content") ||
    extractFlag(cmd, "body") ||
    extractFlag(cmd, "message") ||
    extractFlag(cmd, "markdown");

  let target: string | undefined;
  let rawTarget: string | undefined;
  let targetChatType: "group" | "direct" | undefined;

  if (group) {
    rawTarget = group.replace(/^(group:|channel:)/i, "");
    target = `group:${rawTarget}`;
    targetChatType = "group";
  } else if (user) {
    rawTarget = user.replace(/^(user:|dm:)/i, "");
    target = `user:${rawTarget}`;
    targetChatType = "direct";
  }

  // webhook 无明确会话目标时无法写 target session
  if (kind === "webhook-send" && !target) {
    return {
      kind,
      message: text,
      title: extractFlag(cmd, "title"),
      atAll: hasBoolFlag(cmd, "at-all"),
      atUserIds: splitCsv(extractFlag(cmd, "at-users")),
      atMobiles: splitCsv(extractFlag(cmd, "at-mobiles")),
      command: cmd.slice(0, 2000),
    };
  }

  return {
    kind,
    target,
    rawTarget,
    targetChatType,
    message: text,
    title: extractFlag(cmd, "title"),
    atAll: hasBoolFlag(cmd, "at-all"),
    atUserIds:
      splitCsv(extractFlag(cmd, "at-user-ids")) ||
      splitCsv(extractFlag(cmd, "at-users")),
    atOpenDingTalkIds: splitCsv(extractFlag(cmd, "at-open-dingtalk-ids")),
    atMobiles: splitCsv(extractFlag(cmd, "at-mobiles")),
    robotCode: extractFlag(cmd, "robot-code"),
    command: cmd.slice(0, 2000),
  };
}

export function resolveDwsDeliveryContextMode(
  config: any,
): DwsDeliveryContextMode {
  const raw = config?.dwsDeliveryContext;
  if (raw === "off" || raw === false) return "off";
  if (raw === "source" || raw === "both" || raw === "target") return raw;
  // 默认 target：仅叠加，不改 message 工具 / 普通回复
  if (raw === true || raw === undefined || raw === null) return "target";
  return "off";
}

export type MaybeInjectDwsOutboundContextParams = {
  /** 完整 OpenClaw 配置（resolveOutboundSessionRoute 需要） */
  cfg: any;
  /** 账号合并后的钉钉配置（读取 dwsDeliveryContext） */
  accountConfig?: any;
  agentId: string;
  accountId?: string;
  /** 当前发起会话 sessionKey */
  sourceSessionKey: string;
  invokerId?: string;
  invokerName?: string;
  commandText: string;
  exitCode?: number | null;
  phase?: string;
  toolCallId?: string;
  log?: { info?: (...a: any[]) => void; warn?: (...a: any[]) => void };
};

let warnedMissingApi = false;

function resolveModeFromConfigs(cfg: any, accountConfig?: any): DwsDeliveryContextMode {
  // 账号级 > 渠道顶层 > 默认 target
  if (accountConfig?.dwsDeliveryContext !== undefined) {
    return resolveDwsDeliveryContextMode(accountConfig);
  }
  const channelCfg = cfg?.channels?.[CHANNEL_ID];
  if (channelCfg?.dwsDeliveryContext !== undefined) {
    return resolveDwsDeliveryContextMode(channelCfg);
  }
  return "target";
}

/**
 * 在 dws 发消息命令成功结束后，向目标/来源会话写入 outbound_message。
 * 全程 best-effort，失败只打日志。
 */
export async function maybeInjectDwsOutboundContext(
  params: MaybeInjectDwsOutboundContextParams,
): Promise<boolean> {
  const log = params.log;
  const effectiveMode = resolveModeFromConfigs(params.cfg, params.accountConfig);

  if (effectiveMode === "off") return false;

  // 仅在命令结束且成功时注入
  if (params.phase && params.phase !== "end") return false;
  if (params.exitCode !== undefined && params.exitCode !== null && params.exitCode !== 0) {
    return false;
  }

  const parsed = parseDwsSendCommand(params.commandText);
  if (!parsed) return false;

  // 无明确 target 时，仅 source 模式才写
  if (!parsed.target && effectiveMode === "target") {
    log?.info?.(
      `[DingTalk][dwsDeliveryContext] 解析到 dws ${parsed.kind} 但无 group/user 目标，跳过 target 注入`,
    );
    return false;
  }

  try {
    const oc = await import("openclaw/plugin-sdk/outbound-runtime");
    const append = (oc as any).appendOutboundMessageDeliveryContext as
      | ((p: any) => Promise<void>)
      | undefined;
    const resolveRoute = (oc as any).resolveOutboundSessionRoute as
      | ((p: any) => Promise<any>)
      | undefined;
    const ensureEntry = (oc as any).ensureOutboundSessionEntry as
      | ((p: any) => Promise<void>)
      | undefined;

    if (typeof append !== "function") {
      if (!warnedMissingApi) {
        warnedMissingApi = true;
        log?.warn?.(
          "[DingTalk][dwsDeliveryContext] 当前 OpenClaw 未导出 appendOutboundMessageDeliveryContext；" +
            "请升级/重建 openclaw（plugin-sdk/outbound-runtime）。本功能已跳过，不影响发消息。",
        );
      }
      return false;
    }

    let targetRoute: any = null;
    const targetTo = parsed.target;
    if (targetTo && typeof resolveRoute === "function") {
      try {
        targetRoute = await resolveRoute({
          cfg: params.cfg,
          channel: CHANNEL_ID,
          agentId: params.agentId,
          accountId: params.accountId,
          target: targetTo,
          currentSessionKey: params.sourceSessionKey,
        });
        if (targetRoute && typeof ensureEntry === "function") {
          await ensureEntry({
            cfg: params.cfg,
            channel: CHANNEL_ID,
            accountId: params.accountId,
            route: targetRoute,
          });
        }
      } catch (err: any) {
        log?.warn?.(
          `[DingTalk][dwsDeliveryContext] resolveOutboundSessionRoute 失败: ${err?.message || err}`,
        );
      }
    }

    // target 模式但路由失败 → 仍可写 source（若 both/source）
    const action =
      parsed.kind === "bot-send"
        ? "dws.chat.message.send-by-bot"
        : parsed.kind === "webhook-send"
          ? "dws.chat.message.send-by-webhook"
          : parsed.kind === "reply"
            ? "dws.chat.message.reply"
            : "dws.chat.message.send";

    const actionParams: Record<string, unknown> = {
      action: "send",
      via: "dws",
      dwsKind: parsed.kind,
      message: parsed.message ?? "",
      title: parsed.title,
      target: targetTo,
      to: parsed.rawTarget,
      channel: CHANNEL_ID,
      accountId: params.accountId,
      atAll: parsed.atAll || undefined,
      atUserIds: parsed.atUserIds,
      atOpenDingTalkIds: parsed.atOpenDingTalkIds,
      atMobiles: parsed.atMobiles,
      robotCode: parsed.robotCode,
      command: parsed.command,
    };

    const idempotencyKey =
      params.toolCallId?.trim() ||
      `dws:${params.sourceSessionKey}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;

    await append({
      cfg: params.cfg,
      mode: effectiveMode,
      agentId: params.agentId,
      sourceSessionKey: params.sourceSessionKey,
      sourceAccountId: params.accountId,
      invokerId: params.invokerId,
      invokerName: params.invokerName,
      targetTo: targetTo || params.sourceSessionKey,
      targetChannel: CHANNEL_ID,
      targetAccountId: params.accountId,
      targetRoute,
      actionParams,
      action,
      idempotencyKey,
    });

    log?.info?.(
      `[DingTalk][dwsDeliveryContext] 已注入 outbound_message mode=${effectiveMode} kind=${parsed.kind} target=${targetTo || "-"} route=${targetRoute?.sessionKey || "-"}`,
    );
    return true;
  } catch (err: any) {
    log?.warn?.(
      `[DingTalk][dwsDeliveryContext] 注入失败（已忽略，不影响发消息）: ${err?.message || err}`,
    );
    return false;
  }
}

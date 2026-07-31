import { describe, expect, it } from "vitest";
import {
  parseDwsSendCommand,
  resolveDwsDeliveryContextMode,
} from "../src/services/dws-delivery-context.ts";

describe("parseDwsSendCommand", () => {
  it("parses user send to group with at-all", () => {
    const cmd =
      'dws chat message send --group cidWOK6s/IIC5KgZAmBeSvWEw== --at-all --text "<@all> 全员通知"';
    const p = parseDwsSendCommand(cmd);
    expect(p).not.toBeNull();
    expect(p!.kind).toBe("user-send");
    expect(p!.target).toBe("group:cidWOK6s/IIC5KgZAmBeSvWEw==");
    expect(p!.rawTarget).toBe("cidWOK6s/IIC5KgZAmBeSvWEw==");
    expect(p!.atAll).toBe(true);
    expect(p!.message).toContain("全员通知");
  });

  it("parses send-by-bot with at-user-ids", () => {
    const cmd =
      'dws chat message send-by-bot --robot-code bot1 --group cidXXX== --title "提醒" --text "@u1 请看" --at-user-ids u1,u2';
    const p = parseDwsSendCommand(cmd);
    expect(p!.kind).toBe("bot-send");
    expect(p!.target).toBe("group:cidXXX==");
    expect(p!.atUserIds).toEqual(["u1", "u2"]);
    expect(p!.robotCode).toBe("bot1");
    expect(p!.title).toBe("提醒");
  });

  it("parses user send to open-dingtalk-id", () => {
    const cmd =
      'dws chat message send --open-dingtalk-id odt123 --text "hello"';
    const p = parseDwsSendCommand(cmd);
    expect(p!.kind).toBe("user-send");
    expect(p!.target).toBe("user:odt123");
    expect(p!.targetChatType).toBe("direct");
  });

  it("returns null for non-send dws commands", () => {
    expect(parseDwsSendCommand("dws chat search --query 项目")).toBeNull();
    expect(parseDwsSendCommand("dws contact user search --query 张三")).toBeNull();
    expect(parseDwsSendCommand("echo hello")).toBeNull();
  });

  it("preserves Base64 padding in group id", () => {
    const cmd =
      'dws chat message send --group "cidWOK6s/IIC5KgZAmBeSvWEw==" --text "x"';
    const p = parseDwsSendCommand(cmd);
    expect(p!.rawTarget).toBe("cidWOK6s/IIC5KgZAmBeSvWEw==");
    expect(p!.target).toBe("group:cidWOK6s/IIC5KgZAmBeSvWEw==");
  });
});

describe("resolveDwsDeliveryContextMode", () => {
  it("defaults missing to target", () => {
    expect(resolveDwsDeliveryContextMode({})).toBe("target");
    expect(resolveDwsDeliveryContextMode({ dwsDeliveryContext: undefined })).toBe("target");
  });

  it("honors off / source / both", () => {
    expect(resolveDwsDeliveryContextMode({ dwsDeliveryContext: "off" })).toBe("off");
    expect(resolveDwsDeliveryContextMode({ dwsDeliveryContext: "source" })).toBe("source");
    expect(resolveDwsDeliveryContextMode({ dwsDeliveryContext: "both" })).toBe("both");
  });
});

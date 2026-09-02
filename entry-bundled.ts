/**
 * Bundled entry for openclaw-fork compatibility.
 *
 * Standard openclaw loads the plugin via `index.ts` (export default register).
 * openclaw-fork expects `defineBundledChannelEntry` format.
 *
 * Usage in package.json exports:
 *   "./bundled" → this file
 */

import { defineBundledChannelEntry } from "openclaw/plugin-sdk/channel-entry-contract";
import { getCurrentModuleUrl } from "./src/utils/compat.ts";

export default defineBundledChannelEntry({
  id: "dingtalk-connector",
  name: "DingTalk",
  description:
    "DingTalk (钉钉) channel connector — Stream mode with AI Card streaming",
  importMetaUrl: getCurrentModuleUrl("entry-bundled.mjs"),
  plugin: {
    specifier: "./index.ts",
    exportName: "dingtalkPlugin",
  },
  runtime: {
    specifier: "./index.ts",
    exportName: "setDingtalkRuntime",
  },
  async registerFull(api) {
    const { registerGatewayMethods } = await import("./src/gateway-methods.ts");
    registerGatewayMethods(api);
  },
});

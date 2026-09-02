import { createRequire as nodeCreateRequire } from "node:module";
import { pathToFileURL } from "node:url";

/**
 * 获取跨运行环境（CJS / ESM / jiti）安全的 require 函数。
 * 绝不使用裸 import.meta，避免在 CJS / Script 模式下触发 V8 解析器的 SyntaxError。
 */
export function getSafeRequire(basePath?: string): NodeRequire {
  if (typeof require === "function") {
    return require;
  }
  const resolvedPath =
    basePath ||
    (typeof __filename !== "undefined" && __filename) ||
    `${process.cwd()}/package.json`;
  return nodeCreateRequire(resolvedPath);
}

/**
 * 获取当前模块的路径或 file:// URL，完全兼容 ESM 与 CJS/jiti。
 */
export function getCurrentModuleUrl(fallbackName = "index.mjs"): string {
  if (typeof __filename !== "undefined" && __filename) {
    try {
      return pathToFileURL(__filename).href;
    } catch {
      return `file://${__filename}`;
    }
  }
  try {
    const err = new Error();
    const stack = err.stack?.split("\n") || [];
    for (const line of stack) {
      const match = line.match(/(?:file:\/\/)?(\/[^:\s)]+\.(?:[cm]?[jt]sx?))/);
      if (match && !match[1].includes("node:") && !match[1].includes("compat.")) {
        return pathToFileURL(match[1]).href;
      }
    }
  } catch {}
  return `file://${process.cwd()}/dist/${fallbackName}`;
}

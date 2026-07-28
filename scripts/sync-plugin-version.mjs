#!/usr/bin/env node
/**
 * Keep openclaw.plugin.json version in lockstep with package.json.
 * OpenClaw plugins inspect prefers the manifest version field; forgetting to
 * bump it makes install look "stuck" even after npm @x.y.z --force.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packagePath = path.join(root, "package.json");
const manifestPath = path.join(root, "openclaw.plugin.json");

const pkg = JSON.parse(fs.readFileSync(packagePath, "utf8"));
const version = typeof pkg.version === "string" ? pkg.version.trim() : "";
if (!version) {
  console.error("[sync-plugin-version] package.json missing version");
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const previous = manifest.version;
if (previous === version) {
  console.log(`[sync-plugin-version] openclaw.plugin.json already ${version}`);
  process.exit(0);
}

manifest.version = version;
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`[sync-plugin-version] openclaw.plugin.json ${previous} -> ${version}`);

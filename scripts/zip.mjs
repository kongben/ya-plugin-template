// 把 dist/ 打成可导入的插件 zip（包内顶层就是 plugin.json）
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const root = process.cwd();
const dist = path.join(root, "dist");
const manifestPath = path.join(dist, "plugin.json");

if (!fs.existsSync(manifestPath)) {
  console.error("dist/ 里没有 plugin.json —— 先跑 pnpm build");
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const id = manifest.id || path.basename(root);
const version = manifest.version || "0.0.0";
const out = path.join(root, `${id}-${version}.zip`);
if (fs.existsSync(out)) fs.rmSync(out);

// zip 里直接是插件文件，不带外层目录；plugin.json 必须声明 id
// （宿主在顶层 zip 场景下用 plugin.json 的 id 作为目录名）
execFileSync("zip", ["-qr", out, "."], { cwd: dist, stdio: "inherit" });

console.log(`\n  ✅ ${path.relative(root, out)}  (${(fs.statSync(out).size / 1024).toFixed(1)} KB)`);
console.log("  导入方式：ya 插件管理页 → 导入 zip，或 yatools://install?url=<文件/网络地址>\n");

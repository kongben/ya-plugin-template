// 把 dist/ 直接装进本机 ya 的插件目录，方便边改边验（不用每次打 zip）
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = process.cwd();
const dist = path.join(root, "dist");
const manifestPath = path.join(dist, "plugin.json");

if (!fs.existsSync(manifestPath)) {
  console.error("dist/ 里没有 plugin.json —— 先跑 pnpm build");
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const id = manifest.id || path.basename(root);
const dest = path.join(os.homedir(), "Library", "Application Support", "ya", "plugins", id);

fs.rmSync(dest, { recursive: true, force: true });
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.cpSync(dist, dest, { recursive: true });

console.log(`\n  ✅ 已安装到 ${dest}`);
console.log(`     ${fs.readdirSync(dest).sort().join(", ")}`);
console.log("\n  生效方式：ya 插件管理页 → 重新加载（或重启 ya）");
console.log(`  验证：呼出面板输入 "${manifest.keyword ?? (manifest.keywords || [])[0]} <内容>"\n`);

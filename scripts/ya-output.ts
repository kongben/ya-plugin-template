import fs from "node:fs";
import path from "node:path";
import type { Plugin } from "vite";

/**
 * 让 `vite build` 的产物直接符合 ya 插件目录结构：
 *
 *   dist/
 *   ├── plugin.json   ← 从项目根拷进来（并校验关键字）
 *   ├── main.js       ← IIFE 单文件，宿主用 new Function(code)() 求值
 *   ├── style.css     ← 宿主自动注入并加 .ya-plugin-<id> 作用域
 *   └── ...           ← public/ 下的资源（文件名不变，可用 api.assetUrl 取）
 *
 * 同时在构建结束时做「能在宿主里跑」的静态自检，把最常见的翻车点提前暴露。
 */
export function yaPluginOutput(): Plugin {
  const root = process.cwd();
  const dist = path.resolve(root, "dist");

  return {
    name: "ya-plugin-output",
    apply: "build",
    closeBundle() {
      // 1) 拷 manifest
      const manifestPath = path.resolve(root, "plugin.json");
      if (!fs.existsSync(manifestPath)) {
        throw new Error("项目根缺少 plugin.json（插件的唯一声明文件）");
      }
      const raw = fs.readFileSync(manifestPath, "utf8");
      let manifest: any;
      try {
        manifest = JSON.parse(raw);
      } catch (e) {
        throw new Error(`plugin.json 不是合法 JSON: ${(e as Error).message}`);
      }
      const hasKeyword =
        (typeof manifest.keyword === "string" && manifest.keyword.trim() !== "") ||
        (Array.isArray(manifest.keywords) &&
          manifest.keywords.some((k: unknown) => typeof k === "string" && k.trim() !== ""));
      // 结果提供者（provider: true）免关键字，宿主导入时也放行
      if (!hasKeyword && manifest.provider !== true) {
        throw new Error("plugin.json 缺少 keyword / keywords（无关键字的插件须声明 provider: true）");
      }

      fs.mkdirSync(dist, { recursive: true });
      fs.copyFileSync(manifestPath, path.join(dist, "plugin.json"));

      // 2) 产物自检
      const problems: string[] = [];

      const jsPath = path.join(dist, "main.js");
      if (!fs.existsSync(jsPath)) {
        problems.push("没有产出 main.js");
      } else {
        const code = fs.readFileSync(jsPath, "utf8");
        // 宿主是 new Function(code)()，ESM 语法会直接抛错
        if (/^\s*import\s[\s\S]*?from\s/m.test(code) || /^\s*import\s+["']/m.test(code)) {
          problems.push("main.js 残留 ESM import（必须是 IIFE，检查 build.lib.formats）");
        }
        if (/^\s*export\s/m.test(code)) {
          problems.push("main.js 残留 ESM export（必须是 IIFE）");
        }
        // 真正的 CommonJS 调用：require("xxx")
        if (/\brequire\s*\(\s*["']/.test(code)) {
          problems.push("main.js 含 require(\"…\")（依赖没被打包进去）");
        }
        // 插件里这些能力不存在，用了必挂
        for (const banned of ["fetch(", "XMLHttpRequest", "localStorage", "import.meta"]) {
          if (code.includes(banned)) {
            problems.push(`main.js 使用了宿主不可用的能力：${banned}`);
          }
        }
      }

      const cssPath = path.join(dist, "style.css");
      if (!fs.existsSync(cssPath)) {
        problems.push("没有产出 style.css（插件没有 import './style.css' 吗？）");
      }

      // 3) 报告
      const files = fs.existsSync(dist) ? fs.readdirSync(dist).sort() : [];
      const id = manifest.id || "(未声明 id，导入时以目录名为准)";
      console.log("\n  ya 插件产物  dist/");
      console.log(`    id        ${id}`);
      console.log(`    version   ${manifest.version || "(未声明)"}`);
      console.log(`    keyword   ${manifest.keyword ?? (manifest.keywords || []).join(", ")}`);
      console.log(`    files     ${files.join(", ")}`);
      if (dist && fs.existsSync(jsPath)) {
        console.log(`    main.js   ${(fs.statSync(jsPath).size / 1024).toFixed(1)} KB`);
      }
      if (problems.length) {
        console.log("\n  ⚠️  产物自检发现问题：");
        for (const p of problems) console.log(`    - ${p}`);
      } else {
        console.log("\n  ✅ 产物自检通过（IIFE / 无 ESM / 无不可用能力）");
      }
      console.log("\n  下一步：pnpm zip（打包）或 pnpm install:local（直接装进 ya）\n");
    },
  };
}

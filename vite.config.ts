import { defineConfig } from "vite";
import { yaPluginOutput } from "./scripts/ya-output";

/**
 * 一个配置两套行为：
 *   dev   → 普通 H5 页面（index.html + src/dev），在浏览器里模拟宿主外壳与 api
 *   build → library 模式，产出 ya 插件目录（plugin.json / main.js / style.css）
 */
export default defineConfig({
  plugins: [yaPluginOutput()],

  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "es2020",
    // 插件只能有一个 CSS：宿主把它整份注入并加作用域
    cssCodeSplit: false,
    // 小资源直接内联成 data URL：宿主 WebView 读不到插件目录里的散文件
    assetsInlineLimit: 512 * 1024,
    sourcemap: false,
    lib: {
      entry: "src/main.ts",
      // 关键：宿主用 new Function(code)() 求值，产物必须是自执行单文件
      formats: ["iife"],
      name: "YaPlugin",
      fileName: () => "main.js",
      // 宿主只认 style.css（默认会用包名，如 ya-plugin-scaffold.css）
      // 注意：vite 会自动补 .css 后缀，这里写 "style" 才会产出 style.css
      cssFileName: "style",
    },
  },

  server: {
    port: 5173,
    open: true,
  },
});

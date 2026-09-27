# ya 插件 H5 脚手架（vite + pnpm）

给 [ya](../ya) 开发插件的工程模板：**浏览器里 dev 预览，`vite build` 直接产出符合宿主要求的插件目录**。
示例插件是一个二维码生成器（用到了 npm 包 `qrcode`，正是脚手架存在的意义）。

```
plugin/                      源码工程（有 package.json / node_modules，可 git）
├── plugin.json              插件声明（build 时拷进 dist）
├── index.html               dev 预览页外壳
├── vite.config.ts           dev = 普通 H5；build = library(IIFE) 模式
├── scripts/
│   ├── ya-output.ts         构建后拷 manifest + 产物自检
│   ├── zip.mjs              打 zip（包内顶层即 plugin.json）
│   └── install-local.mjs    直接装进本机 ya 插件目录
├── src/
│   ├── main.ts              插件入口（__registerPlugin）← 真正被打包的代码
│   ├── style.css            插件样式（宿主注入并加作用域）
│   ├── types.ts             宿主 API 类型
│   └── dev/                 仅 dev 使用的假宿主，不进产物
└── dist/                    构建产物 = 插件目录
    ├── plugin.json
    ├── main.js              IIFE 单文件
    └── style.css
```

## 快速开始

```bash
pnpm install
pnpm dev          # 打开浏览器 http://localhost:5173
pnpm build        # 产出 dist/（即插件目录）
pnpm zip          # dist/ → qrcode-1.0.0.zip，可直接导入
pnpm install:local   # 或：直接装进 ~/Library/Application Support/ya/plugins/<id>
pnpm typecheck    # 只做类型检查
```

dev 页里输入 **`qr` + 空格 + 内容** 即进入插件（和真机一样，必须「关键字 + 空格」）。
页面右下「宿主调用日志」会记录每一次 `api.*` 调用，方便确认插件到底调了什么。

两个省事用法：

```bash
BROWSER=none pnpm dev          # 起服务但不开浏览器
open "http://localhost:5173/?arg=https://ya.app"   # 直接以指定参数预览（&kw=qr 可换关键字）
```

> `pnpm-workspace.yaml` 里的 `allowBuilds.esbuild: true` 是 pnpm 12+ 的必需配置
> （esbuild 要跑 postinstall，不批准的话 vite 装完也跑不起来）。

## dev 预览是怎么模拟宿主的

`src/dev/host.ts` 复刻了三件事：

1. `window.__registerPlugin` —— 插件代码靠它注册自己（宿主是 `new Function(code)()` 求值后调用）。
2. `api` 全套方法：本地能模拟的就真做（`db` → localStorage、`copyText` → 剪贴板、`notice` → toast），
   做不了的（openPath / showInFinder / trashItem…）只记日志，不会真执行。
3. 输入调度：解析「关键字 + 空格」→ `onEnter` → `onQuery`；Esc 退出；`setSubInput` 会接管输入。

`src/dev/dev.css` 的 `:root` 与宿主 `shell.css` 的 `--ya-*` 变量保持一致，所以样式预览接近真机。
**dev 目录不参与构建**，`src/main.ts` 才是产物入口。

## 构建产物的硬约束（改配置前先读）

| 约定 | 原因 |
| --- | --- |
| `formats: ["iife"]`，产物必须单文件 | 宿主用 `new Function(code)()` 求值，残留 `import`/`require`/`export` 直接抛错 |
| 不开启代码分割 / 动态 `import()` | 会产出额外 chunk，插件目录加载不到 |
| `cssCodeSplit: false` → 单个 `style.css` | 宿主整份注入并给选择器加 `.ya-plugin-<id>` 作用域 |
| `assetsInlineLimit: 512KB` | WebView 读不到插件目录里的散文件，小资源内联成 data URL |
| 大资源放 `public/` | 原样拷进 dist 且**文件名不变**，可用 `await api.assetUrl("x.png")` 取 |

`scripts/ya-output.ts` 在每次构建结束时做自检：manifest 关键字、是否残留 ESM / `require(`、
是否用了宿主没有的 `fetch` / `localStorage` / `XMLHttpRequest` / `import.meta`，有问题会打印告警。

## 加第三方依赖

直接装就行，vite 会把它整包打进 `main.js`，插件目录里不留任何依赖：

```bash
pnpm add dayjs
```

```ts
import dayjs from "dayjs";   // 构建后变成 main.js 的一部分
```

选库禁区（踩了必挂）：依赖 `fs` / `path` / `child_process` / `net` / `Buffer` 的包；运行时联网
（CDN 字体、遥测）；只有 Node 入口的包。`qrcode` 用的是它的浏览器构建，安全。

## 改插件元信息

编辑根目录 `plugin.json`（不是 dist 里的那份）：

- `id`：小写 `[a-z0-9_-]`，等于安装后的目录名；**插件一旦发布就不要改**（改了会丢存储数据）。
- `keyword` / `keywords`：小写、不含空格；别撞内置的 `calc` / `clip`。
- `version`：`MAJOR.MINOR.PATCH`，**每次产出可分发包都要 bump**，否则宿主判定为「同版本覆盖」。

## 不能用的东西

`fetch` / `localStorage` / `sessionStorage` / `fs` / 子进程 / 任意文件读写。
需要持久化就用 `api.db`（按插件隔离，值为字符串）。详见 [plugin-agent.md](../plugin-agent.md)
与 [ya/docs/plugin-api.md](../ya/docs/plugin-api.md)。

## 交付流程

```bash
pnpm build && pnpm zip
# 或 pnpm build && pnpm install:local，然后在 ya 插件管理页「重新加载」
```

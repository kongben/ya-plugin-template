# plugin-agent.md

> **读者：AI 助手。** 本文件是生成 / 修改 / 调试插件时的**唯一上下文入口与行为准则**，不是人类教程。
> 严格按本文件产出，**不要凭通用 Web 开发直觉发挥**（本平台无 Node 运行时、无 npm、无模块加载器）。
> 冲突时以宿主实现为准：宿主结构见 `agent.md`，API 细节见 `ya/docs/plugin-api.md`。

## 0. 平台假设

| 项 | 本平台取值 |
| --- | --- |
| 宿主 | **ya**（macOS 启动器，Swift 外壳 + WKWebView） |
| 运行时 | WebKit；宿主用 `new Function(code)()` 求值插件 JS |
| 插件形态 | 目录：`plugin.json` + `main.js`（由 `main.ts` 编译）+ 可选 `style.css` |
| 安装 | zip 导入，或 `yatools://install?url=` 深链 |

占位符（按环境替换，产物中不得残留）：`{{HOST_APP}}` = `ya/dist/ya.app`；`{{PLUGIN_DIR}}` = `~/Library/Application Support/ya/plugins`；`{{APP_SUPPORT}}` = `~/Library/Application Support/ya`；`{{TSC}}` = `node <workspace>/node_modules/typescript/bin/tsc`。

> `[PLATFORM]` 标记 = 该规则依赖宿主平台，移植到其他插件宿主时按宿主文档替换。

## 1. AI 行为准则

**必须**：① 改插件前先读现有 `plugin.json`，禁止凭空重写 manifest；② 每次改动跑 §11 校验并对照 §12 清单，**自检通过才交付**；③ 外部/用户输入渲染前一律 `api.esc()`；④ 不确定的 API 先查 `ya/docs/plugin-api.md`，**不臆造 `callBridge` action**；⑤ 改已有插件时保持 id 与关键字不变（否则丢用户习惯与存储数据）。

**禁止**：① 改宿主任何文件（`ya/Sources/`、`ya/dist/`、其它插件目录，见 §10.4）；② 在**插件目录**引入 npm 依赖、产物里残留 `import`/`require`（需要第三方库一律走 §8.1 脚手架，先在插件目录外打成 IIFE 单文件）；③ 使用 `fetch` / `fs` / `child_process` 等不存在的能力；④ 向 `window` 挂全局变量（插件共享同一页面全局）；⑤ 在 `onQuery` 里做长同步计算（会卡输入）。

## 2. 目录结构

```
{{PLUGIN_DIR}}/<plugin-id>/
├── plugin.json     # 必填，插件声明
├── main.ts         # 必填，源码
├── main.js         # 必填（打包时），tsc 产物
├── style.css       # 可选，宿主自动注入并加作用域
└── <assets>        # 可选，图片/字体，见 §7
```

- **id = 目录名**；`plugin.json` 的 `id` 仅作参考 `[PLATFORM]`。
- zip 顶层可直接是文件，**也允许包一层目录**；包内必须有 `plugin.json`。
- 只有 `main.ts` 时宿主会尝试本机 `tsc` 编译，**不可依赖**，务必自带 `main.js`。
- 该目录是**运行时目录**：只放 `plugin.json` + 产物 + 资源。源码工程（含 `package.json` / `node_modules`）放插件目录外，见 §8.1。

## 3. plugin.json 字段

| 字段 | 必填 | 类型 | 说明与约束 |
| --- | --- | --- | --- |
| `keyword` | ✅（与 `keywords` 二选一；declared `provider: true` 时可省） | string | 主关键字，小写、无空格 |
| `keywords` |  | string[] | 别名数组，主关键字自动并入 |
| `name` / `description` | 建议 | string \| `{en,zh}` | 显示名 / 副标题，缺省显示 id |
| `version` | 建议 | string | 语义化 `1.2.0`；导入时判定升/降级，未声明显示 `—` |
| `icon` |  | string | 图片文件名（如 `icon.png`）或 emoji（如 `🧮`）；都没有则宿主按首字母生成彩色图标 |
| `updateUrl` / `id` |  | string | 更新检查地址（返回 `{version, url?}`）/ 标识，缺省用目录名 |
| `features` |  | array | **多入口**：一个插件提供多个功能，见 §4.1 |
| `provider` |  | `true` | **结果提供者**：免关键字，把搜索原文交给 `onProvide`，结果并进宿主主列表。见 §4.3。声明后 `keyword` 变为可选 |
| `input` |  | `"visible"` | 进插件后保留宿主输入框。**不写 = 收起**（默认），交互自己实现，见 §4.2 |

```json
{
  "keyword": "calc",
  "keywords": ["calc", "math"],
  "version": "1.0.0",
  "icon": "🧮",
  "name": { "en": "Calculator", "zh": "计算器" },
  "description": { "en": "Evaluate an expression", "zh": "输入表达式计算" }
}
```

## 4. 关键字：本平台唯一的"命令声明"方式

`[PLATFORM]` 本平台**没有** `commands[]` / `tools[]` 声明式注册，触发入口就是关键字；目标宿主若支持命令数组，按宿主规范替换本节。

- 规范化：去首尾空白、转小写、**不能含空格**（空格用于分隔参数）。
- 触发：必须「关键字 + 空格」才进插件视图；只输入 `cal` 时插件只是搜索结果项，回车/Tab 才进入。
- 匹配优先级：关键字精确 > 关键字前缀 > 名称前缀 > 关键字包含 > 名称包含 > 名称全拼 > 拼音首字母 > ≥3 字符兜底子串。
- **冲突**：内置优先 → 同级按 id 字典序，先声明者占用；被抢占的关键字不再参与匹配，插件标记 `conflictWith`。
- 生成新插件前先在 `{{PLUGIN_DIR}}` 检索，避免撞已装插件（宿主 2026-09-25 起不再内置任何插件，
  原内置的 `calc` / `clipboard` 已移出为独立工程，是否在装以 `{{PLUGIN_DIR}}` 实际内容为准）。

### 4.1 多入口：`features[]`

一个插件要做多个动作（浏览 + 直接清空、翻译 + 截图翻译）时，用 `features` 而不是拆成多个插件：

```json
"features": [
  { "cmd": "clear", "title": { "en": "Clear", "zh": "清空" }, "keywords": ["clipclear"] },
  { "cmd": "files", "title": { "en": "Files only", "zh": "只看文件" } }
]
```

- `cmd` 必填，小写无空格；`title` 缺省显示 `cmd`；`keywords` 缺省为 `[cmd]`。
- feature 关键字**参与全局冲突检测**，全部被抢占则该入口不可用（不会出现在结果里）。
- **keywords 必须以插件主关键字开头**（如主关键字 `clip` → `clipclear`；`urlc` → `urlcenc`）。
  原因：宿主先用 `matchPlugins(q)` 挑插件，只在这个集合里找 features。query 比主关键字还长时
  插件自己就匹配不上了，于是入口再也不会出现在结果里；只有 query ≤ 主关键字才是前缀命中。
  这点写法上很容易漏：`ue` 这种**与主关键字无关的短词**，只在「`ue 内容` 直接带参」时能用，
  「只敲 `ue`」会让宿主什么都搜不到（插件没命中就没有 feature 可补）。
- 进入方式三种：`clear 参数`（专属关键字）/ `clip clear 参数`（主关键字 + cmd）/ `clip 参数`（主入口）。
- 插件侧：`onQuery(arg, container, api, feature)` 第四参数 `{cmd, title}`；切换入口会先触发一次
  `onFeature(feature, api)`。主入口的 `cmd` 是空串。**老插件不声明第四参数也照旧工作。**

### 4.3 结果提供者：`provider: true`（免关键字往主列表塞结果）

`[PLATFORM]` 插件有两种形态，选错形态会直接毁掉体验：

| | 接管面板型（默认） | **结果提供者**（`provider: true`） |
| --- | --- | --- |
| 触发 | 必须「关键字 + 空格」 | 每次搜索都问一次 `onProvide`（可同时保留关键字做显式入口） |
| 渲染 | 插件自己画 `container` 的 DOM | **宿主渲染**，插件只返回数据 |
| 键盘 | 插件自己处理 | 宿主管 ↑↓ / 回车 / Tab |
| 关键字 | 必填 | 可选（不写就不占关键字、不参与冲突） |
| 出现在「我的插件」组 | ✅ | 仅当它有关键字时 |

**判断规则**：用户是「主动要用这个功能」（翻译、二维码、剪贴板）→ 接管面板型；
用户是「随手粘/打了一段内容，希望顺手出个结果」（时间戳识别、文件搜索、Snippets、
Quicklinks、系统命令）→ provider。

```json
{ "id": "smart", "keywords": ["s", "smart"], "provider": true, "name": { "zh": "智能识别" } }
```

```ts
__registerPlugin({
  onQuery(arg, container, api) { /* 显式关键字时的完整面板（可选） */ },
  onProvide(query, api) {
    // query = 搜索框全部原文（未剥离关键字）。返回 [] 表示"这次没我的事"
    return [{ title: "2024-01-01", subtitle: "时间戳转日期", copy: "2024-01-01" }];
  },
});
```

条目字段：`title`（必填）/ `subtitle` / `copy`（回车复制）/ `openURL`（回车打开，与 copy 同时执行）/
`swatch`（左侧色块 CSS 颜色）/ `action`（完全自定义；给了就忽略 copy/openURL，且宿主不自动收起面板）。
可同步返回，也可返回 `Promise`。

> ⚠️ **三道护栏 —— 写 provider 前必须记住**：`onProvide` 是**每次击键都跑**的代码。
> ① 单次 > **300ms** → 丢弃结果并**本次会话停用**该 provider；② 抛异常 → 同样停用；
> ③ 单插件最多 **3 条**。
> 所以：`onProvide` 里**禁止**网络请求、禁止读大文件、禁止重计算；必须自己 `try/catch`；
> 入口处先做最便宜的守卫（长度、正则预筛）再干活。停用只影响本次会话。

### 4.2 输入框：默认收起，交互自己实现

`[PLATFORM]` 进入插件后宿主输入框**默认收起**（搜索栏离屏，只留插件视图），交互由插件自己实现。
键盘输入仍会送到 `onQuery` / `onKey`，只是用户看不到输入框。

因此：

1. **插件必须自己回显用户输入**（`onQuery` 的 `arg`），否则用户不知道自己打了什么。
   例：计算器渲染 `2+2 =`；列表类插件渲染 `🔍 过滤词`。
2. 插件全程靠输入工作的（二维码、翻译、搜索类），在 `plugin.json` 写 `"input": "visible"` 保留输入框；
   或运行时 `api.showInput("提示语…")` / `api.hideInput()` 按需切换；`api.setSubInput(fn)` 也会自动把输入框放出来。
3. 输入框支持 ⌘C/⌘V/⌘X/⌘A/⌘Z/⇧⌘Z 与右键菜单（撤销/重做/剪切/复制/粘贴/全选）；
   ← → 在框内还有可移动空间时移动光标，到头后才切换结果选中项。

## 5. 生命周期与钩子

```ts
__registerPlugin({
  onQuery(arg, container, api) {},   // 必填：参数变化时触发
  onKey(e, container, api) {},       // 可选：返回 true 表示已消费该按键
  onEnter(api) {},                   // 可选：进入插件时触发一次
  onExit() {},                       // 可选：真正退出插件时触发（**面板隐藏不触发**）
  onFeature(feature, api) {},        // 可选：切换 features 入口时触发一次
  onProvide(query, api) {},          // 可选：仅 provider 插件，返回主列表结果，见 §4.3
});
```

| 钩子 | 时机 | 注意 |
| --- | --- | --- |
| `onEnter` | 刚进入插件 | **不是回车键**；初始化 / `setSubInput` 放这里 |
| `onQuery` | 参数变化 | 写 `container.innerHTML`；`setSubInput` 生效时不再触发；第四参数是当前入口 `{cmd, title}` |
| `onFeature` | 切换 features 入口 | 主入口 `cmd` 为空串；适合重置状态/过滤条件 |
| `onKey` | 按键 | 返回 `true` 宿主不再处理；可拦截 Esc |
| `onExit` | 退出插件（Esc / 换插件 / 输入不再是本插件关键字） | 清定时器、解绑监听、存状态。**面板隐藏不触发**（见下） |
| `onProvide` | 每次搜索（provider 专用） | 返回 `ProviderItem[]` 或 Promise；300ms 超时/抛异常 → 本次会话停用；最多 3 条。见 §4.3 |

- 容器即 `#pluginView`，宿主已注入作用域 class，**直接写 `container.innerHTML`**。
- 退出是**两级**：插件内 Esc → 回搜索初始页（触发 `onExit`）；再按一次才隐藏面板。
- **面板收起来再呼出，会回到你这里**：只要用户没按 Esc 退出（只是切走 / 点外面 / 插件自己调了
  `api.hide()`），下次呼出面板时宿主直接用当前参数再问一次 `onQuery`，插件的 DOM 与状态都原样保留。
  两条对插件的要求：① `onQuery` 要**幂等**（同样的参数再跑一遍不能出错、不能重复追加 DOM —— 所以
  DOM 只 mount 一次那条铁律在这里也成立）；② 别把「保存状态」只押在 `onExit` 上，面板隐藏不触发它，
  要存就在数据变化时立即存（`api.db`）。
- 面板高度**由宿主统一决定**：进插件的那一刻宿主已经把内容视口钉成「刚离开的那份搜索结果的高度」
  （切换前后面板总高一致，不会闪），之后 `api.setExpendHeight(px)` 只是**建议值** —— 宿主会把它夹到
  统一区间，超过上限（面板 560px 封顶）的内容由容器滚动。
  所以填**内容区高度**就行（`el.getBoundingClientRect().height + 28`，+28 = `#pluginView` 上下各 14px）：
  外壳（搜索栏 / 底栏）宿主自动补，**不用自己猜**；也**不要自己写 `Math.min(MAX_HEIGHT, …)` 封顶** ——
  各写各的会让面板尺寸在每个插件之间来回换档，用户看到的就是在闪。长内容直接让它长到封顶再滚动。
- 输入法组合态（候选未上屏）不触发插件切换，不要依赖逐字母输入。
- **宿主输入框默认收起**（搜索栏离屏），但键盘输入照常送进 `onQuery` / `onKey`。
  所以**必须自己回显用户输入**（如计算器显示 `2+2 =`）；插件全程靠输入工作的，
  在 `plugin.json` 写 `"input": "visible"`，或运行时调 `api.showInput()`。

## 6. 可用 API（`api` 对象）

| 分组 | API |
| --- | --- |
| 通用 | `lang()`、`esc(html)`、`assetUrl(name)`、`callBridge(action, payload)` |
| 窗口 | `hide()`、`show()`、`setExpendHeight(px)`、`setSubInput(fn, placeholder?)`、`setSubInputValue(text)`、`removeSubInput()`、`showInput(placeholder?)`、`hideInput()` |
| 系统 | `notice(body)`、`openPath(p)`、`openURL(u)`、`showInFinder(p)`、`trashItem(p)`、`beep()`、`getPath(name)`、`getFileIcon(p)`、`getNativeId()`、`getAppInfo()`、`isDarkColors()` |
| 剪贴板 | `copyText(t)`、`getClipboardText()`、`getCopiedFiles()`、`getClipboardHistory()` |
| 剪贴板历史 | `clipboard.history()`、`clipboard.image(id)`、`clipboard.copy(id)`、`clipboard.pin(id)`、`clipboard.remove(id)`、`clipboard.clear(all?)` |
| 存储 | `db.getItem` / `db.setItem` / `db.removeItem`（按插件隔离，值为字符串） |

- `getPath` 取值：`home`、`appData`、`userData`、`temp`、`exe`、`desktop`、`documents`、`downloads`、`music`、`pictures`、`videos`、`logs`。
- 除 `lang()` / `esc()` 外异步 API 返回 Promise，需 `await`；存储落盘 `{{APP_SUPPORT}}/storage/<id>.json`，**只存字符串**。

## 7. 样式规范

- `style.css` 由宿主自动注入，**禁止自己写 `<link>` 或 `<style>`**。
- 宿主给每条选择器加 `.ya-plugin-<id>` 前缀：`.card{}` → `.ya-plugin-myid .card{}`；`:root` / `body` / `#pluginView` 映射到容器自身；`@media` 递归处理。
- 颜色用宿主变量，不要写死：`--ya-bg`、`--ya-fg`、`--ya-fg-strong`、`--ya-sub`、`--ya-muted`、
  `--ya-accent`、`--ya-sel`、`--ya-hover`、`--ya-border`、`--ya-radius`。
  宿主**跟随系统深浅色**（设置里也能手动指定），引变量即可两套配色自动跟随；
  必须写死的语义色（成功/警告/失败）要明暗都读得清（如 `#d98a1f`、`#e0483f`），
  或者在自己的 style.css 里加 `@media (prefers-color-scheme: light)` 分开给值。
- 相对 `url("a.png")` 会被宿主内联成 data URL（≤512KB/文件），JS 侧用 `await api.assetUrl("a.png")`——WebView 读权限只在宿主 `Web/` 目录内，插件目录的 `file://` 图片会加载失败。
- 禁止依赖宿主内部类名（`.item-title`、`.cell` 等），宿主改版会失效。

## 8. 依赖与构建

- **没有依赖安装步骤**：无 `package.json`、无 `node_modules`、无打包器。
- 第三方库：源码**内联进 `main.ts` 同一文件**（`--outFile` 单文件输出，无模块解析）；多文件源码用 `namespace` 或手工拼接后一次编译。
- 唯一构建步骤：

```bash
{{TSC}} main.ts --target ES2020 --lib ES2020,DOM --outFile main.js
```

- `main.ts` 顶部声明宿主注入的全局：`declare const __registerPlugin: (p: any) => void;`（可选 `declare const __lang: () => string;`）。
- `lib` 仅 `ES2020,DOM`，不使用装饰器之外的实验特性。

### 8.1 带第三方依赖：脚手架 + 产物分离

需要 `qrcode`、`dayjs`、`marked` 之类 npm 包时：**插件目录仍是零依赖运行时**，构建在**插件目录外**的源码工程里完成，只把产物拷进来。`tsc --outFile` 只合并自己的 `.ts`，**不解析 bare import（`import x from "qrcode"`）**，所以只要引库就必须换 bundler。

> **优先直接复用现成脚手架**：`ya/../plugin/`（vite + pnpm，与 `ya/` 同级）。复制它 → 改 `plugin.json` 的
> `id` / `keyword` / `version` → 写 `src/main.ts` → `pnpm build` 即产出符合要求的插件目录。
> 它已内置：`pnpm dev` 浏览器预览（假宿主 + `api` 调用日志）、IIFE 单文件构建、产物自检、
> `pnpm zip` / `pnpm install:local`。细节见 `plugin/README.md`。

```
~/ya-plugins-src/<id>/            # 源码工程：有 package.json / node_modules，可 git
├── src/main.ts  src/style.css
├── dev.html                      # 浏览器调试页，ya 的 api.* 用 mock 桩
├── build.sh
└── node_modules/
        │  构建
        ▼
{{PLUGIN_DIR}}/<id>/              # 只有：plugin.json / main.js / style.css / 资源
```

> 禁止把 `package.json`、`node_modules`、`src/`、`.ts` 源码放进 `{{PLUGIN_DIR}}`——会被索引扫描、拖慢冷启动，zip 导入还会带上垃圾。

按库的发行形态选路线：

| 库形态 | 做法 | 适用 |
| --- | --- | --- |
| 有 UMD / 单文件发行版（如 `qrcode-generator`） | 把该文件拷进插件目录，随 `main.ts` 一起 `tsc --outFile` | 最省事，零构建工具 |
| 只有 ESM/CJS npm 包（如 `qrcode`） | 源码工程 `npm i` + esbuild 打 IIFE | 通用 |

```bash
# JS：关键参数不能省
npx esbuild src/main.ts --bundle --format=iife --target=es2020 \
  --outfile={{PLUGIN_DIR}}/<id>/main.js
# CSS：单独产一个文件，由宿主注入
npx esbuild src/style.css --bundle --outfile={{PLUGIN_DIR}}/<id>/style.css
# 产物自检：不得残留模块语法
grep -nE "(^|[;{\s])(import|export)\s|[^.\w]require\(" main.js && echo "FAIL" || echo "bundle ok"
```

- **必须 `--format=iife`**：插件 JS 由宿主 `new Function(code)()` 求值，产物里不能残留 `import` / `require` / `export`，也不能用 `type="module"`。
- 不要开 code splitting、不要用动态 `import()`：会生成额外 chunk，插件目录加载不到。
- 资源仍按 §7：CSS 相对 `url()` 会被宿主内联，JS 侧用 `api.assetUrl()`，不要用 `file://` 绝对路径。

选库禁区（踩了必挂）：

- 依赖 Node API 的包：`fs` / `path` / `child_process` / `net` / `Buffer`（要 polyfill，尽量躲）。
- 运行时联网的库（CDN 字体、遥测）：`fetch` / `XHR` 在插件页不可用。
- 只有 Node 入口的包（不少库 `main` 指向 node build），确认有 browser 构建再选。
- 大包：整包会塞进单个 `main.js`，优先选精简实现（二维码用 `qrcode-generator`，别引整套工具库）。

流程：① 浏览器 dev 页 + `api` mock 跑通逻辑 → ② 构建并把产物拷进插件目录 → ③ 走 §11（第 2 步换成上面的 bundle 自检，不再跑 tsc）。

## 9. 最小可运行示例

`plugin.json`

```json
{
  "keyword": "echo",
  "keywords": ["echo"],
  "version": "1.0.0",
  "icon": "🔁",
  "name": { "en": "Echo", "zh": "回显" },
  "description": { "en": "Echo the input", "zh": "回显输入内容" }
}
```

`main.ts`

```ts
declare const __registerPlugin: (p: any) => void;

__registerPlugin({
  onQuery(arg: string, container: HTMLElement, api: any) {
    const text = arg.trim();
    container.innerHTML = text
      ? `<div class="echo-out">${api.esc(text)}</div>`
      : `<div class="echo-empty">Type something</div>`;
  },
  onKey(e: KeyboardEvent, container: HTMLElement, api: any) {
    if (e.key === "Enter") {
      const el = container.querySelector(".echo-out");
      if (el && el.textContent) {
        api.copyText(el.textContent);
        api.hide();
        return true;
      }
    }
    return false;
  },
  onExit() {},
});
```

`style.css`

```css
.echo-out { font-size: 24px; padding: 16px 4px; color: var(--ya-accent); }
.echo-empty { color: var(--ya-muted); padding: 24px 4px; font-size: 14px; }
```

构建与安装（目录名必须等于插件 id）：

```bash
cd <plugin-id> && {{TSC}} main.ts --target ES2020 --lib ES2020,DOM --outFile main.js
cd .. && zip -qr <plugin-id>.zip <plugin-id>          # 包内含 plugin.json
YA_DEBUG=1 YA_IMPORT=$PWD/<plugin-id>.zip {{HOST_APP}}/Contents/MacOS/ya
```

## 10. 约束

### 10.1 命名规范

- 插件 id / 目录名：`[a-z0-9_-]`，小写、短且有意义（导入时非法字符会被替换成 `-`）。
- 关键字：小写、无空格、2–12 字符，避免撞已装插件。
- CSS 类名加插件前缀（`.echo-*`）——宿主虽已隔离，仍便于定位。

### 10.2 版本要求

- `version` 用 `MAJOR.MINOR.PATCH`；宿主只比较数字段（`1.2` == `1.2.0`，`v` 与 `-beta`/`+build` 忽略）。
- 每次产出可分发包**必须 bump 版本**，否则判定为「同版本覆盖安装」。
- `[PLATFORM]` 不支持 `minHostVersion` / `engines`，不要写入（会被忽略）。

### 10.3 沙箱边界（可用能力上限）

| 能力 | 可用 | 途径 |
| --- | --- | --- |
| 自身键值存储 | ✅ | `api.db.*` |
| 剪贴板读写 | ✅ | `api.copyText` 等 |
| 打开文件 / Finder 显示 / 删除到废纸篓 | ✅ | `api.openPath` / `showInFinder` / `trashItem` |
| 通知、提示音、读取插件自带资源 | ✅ | `api.notice` / `beep` / `assetUrl` |
| 任意文件读写、网络请求、子进程 shell | ❌ | 无（网络只能 `api.openURL` 交给浏览器或走宿主深链安装） |
| 其它插件目录、宿主源码、`localStorage`、`fetch` | ❌ | 无（`file://` 页面下不可用，改用 `api.db`） |

### 10.4 禁止修改的路径

```
ya/Sources/**                          # 宿主源码（shell.ts / shell.css；已无内置插件）
ya/dist/**                             # 打包产物
{{APP_SUPPORT}}/plugins/<其它插件>/     # 只可写自己目录
{{APP_SUPPORT}}/storage/、keyword-overrides.json、app-cache.json
~/Library/Preferences/com.ya.app.plist
```

### 10.5 危险操作（必须用户显式触发，禁止自动执行）

- `api.trashItem()`：删除文件，只能由按键/点击触发，路径须来自用户当前选择。
- `api.openPath()` / `openURL()`：会启动外部程序，不要在 `onQuery` 里无条件调用。
- 覆盖同名插件：会替换用户已有版本，产出前确认版本已 bump、关键字未变。

## 11. 本地校验与冒烟测试

```bash
# 1) manifest 合法且至少一个关键字（provider:true 插件可无关键字）
node -e 'const j=require("./plugin.json");if(!(j.keyword||(j.keywords||[]).length))throw new Error("missing keyword");console.log("manifest ok",j.version)'
# 2) 编译零错误（零依赖插件）；用了 §8.1 脚手架的改为 bundle 自检，不要再跑 tsc
{{TSC}} main.ts --target ES2020 --lib ES2020,DOM --outFile main.js
# 3) 产物非空      4) 打包（包内含 plugin.json）
test -s main.js && echo "js ok"; cd .. && zip -qr <id>.zip <id>
# 5) 导入冒烟
YA_DEBUG=1 YA_IMPORT=$PWD/<id>.zip {{HOST_APP}}/Contents/MacOS/ya
# 期望：plugins: ... <id>(user) / imported: <id> 1.0.0 (installed)
# 结束进程用 pkill -x ya；不要用 pkill -f "...ya.app..."，会把执行命令的 shell 一起杀掉
```

冒烟步骤（导入成功后）：

1. 呼出面板，输入关键字前几个字母 → 插件出现在搜索结果「插件」分组。
2. 输入 `<keyword>` + 空格 → 进入插件视图，`onQuery` 渲染出内容。
3. 输入 `<keyword>` + 参数 → 内容随参数变化。
4. 按 Esc → 回到搜索初始页（**不是关闭面板**），再按一次才关闭。
5. provider 插件：不敲关键字直接输入内容，结果出现在主列表「智能识别」分组（§4.3）。
6. 自带样式生效，且未污染宿主界面。
7. 用了 `api.db` 的插件：退出再进入，数据应保留。
8. 高度：从搜索结果敲 `<keyword>` + 空格进入插件时，**面板不要跳动**（宿主已经把它锁成搜索结果的高度）；
   在插件里把内容增删到很矮 / 很高，面板最多长到宿主封顶，再长就在容器里滚。

调试环境变量：`YA_DEBUG=1`（打印插件索引/关键字冲突/CSS 内联）、`YA_IMPORT=<zip>`、`YA_DELETE=<id>`、`YA_INSTALL=<url>`。

## 12. 验收清单（交付前逐项打勾）

- [ ] `plugin.json` 合法 JSON，含 `keyword`/`keywords`（`provider: true` 时可省），`version` 已 bump
- [ ] 关键字小写无空格，与已装插件不冲突（宿主已无内置插件）
- [ ] 形态选对：主动型功能用接管面板型，随手型功能用 `provider: true`（§4.3）
- [ ] provider 插件：`onProvide` 里无网络/重计算，已 `try/catch`，结果 ≤3 条，冷路径 <300ms
- [ ] `main.js` 已生成且与 `main.ts` 同步（改过 `main.ts` 必须重编译；引第三方库则按 §8.1 重新 bundle）
- [ ] 无 `import` / `require` / `fetch` / `fs` 等不可用能力（bundle 产物需过 §8.1 的 `grep` 自检）
- [ ] 用了 §8.1 脚手架时：插件目录内**没有** `package.json` / `node_modules` / `src`，只有产物
- [ ] 外部输入渲染前调用 `api.esc()`；异步 API 全部 `await`，`onQuery` 无长同步阻塞
- [ ] 定时器 / 监听器在 `onExit` 清理
- [ ] 样式只用自有类名前缀 + `--ya-*` 变量，未依赖宿主内部类名
- [ ] 只读写自身目录与 `api.db`，未触碰 §10.4 路径；危险操作由用户显式触发
- [ ] §11 五条命令通过，冒烟 ①–⑥ 通过（provider 插件重点看 ⑤）
- [ ] 面板高度交给宿主：插件里**没有** `Math.min(MAX_HEIGHT, …)` 这类自己封顶，只上报内容实测高度

## 13. 常见故障速查

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| 导入报「没有找到 plugin.json」 | zip 结构不对 | 包内（或一层子目录内）放 `plugin.json` |
| 导入报「缺少 keyword / keywords」 | manifest 无可用关键字，且未声明 `provider: true` | 补 `keyword`，或声明 `"provider": true`（§4.3） |
| 输入关键字无反应 | 关键字被其它插件抢占 | 换关键字，检查 `conflictWith` |
| `onQuery` 不执行 | 已 `setSubInput` 接管输入 | 改在 subInput 回调里处理 |
| 进插件瞬间就执行了动作 | 逻辑写进了 `onEnter`（生命周期钩子，非回车） | 回车逻辑放 `onKey` |
| 插件图片不显示 | 用了相对路径或 `file://` | `api.assetUrl()` 或 CSS 相对 `url()`（宿主会内联） |
| 样式影响宿主界面 | 选择器命中宿主元素 | 类名加前缀，避免全局规则 |
| 改了插件但界面没变 | 未重编译 `main.js` / 前端缓存了实例 | 重跑 tsc（或 §8.1 重新 bundle）+ 插件管理页「重新加载」 |
| 引了 npm 包后报 `require is not defined` / `Cannot use import statement` | 产物是 ESM/CJS，宿主用 `new Function` 求值 | 按 §8.1 用 `--format=iife` 重新打包 |
| 库报 `Buffer is not defined` / `fs not found` | 选了依赖 Node API 的包 | 换纯浏览器实现（见 §8.1 选库禁区） |
| 打包后插件体积暴涨、启动变慢 | 整包塞进单个 `main.js`，或把 `node_modules` 拷进了插件目录 | 换精简库；插件目录只留产物 |
| 进插件后看不到输入框 | 宿主默认收起（§4.2） | 自己回显输入，或加 `"input": "visible"` / `api.showInput()` |
| 进插件后 `onQuery` / `onKey` 不再触发 | 插件抢占了焦点（`autofocus` 到自己的元素） | 不要在插件里抢焦点，键盘输入由宿主输入框转发 |
| provider 插件的结果时有时无 | 单次 `onProvide` 超过 300ms 被超时丢弃并**本次会话停用** | 加预筛/缓存把耗时压到 300ms 内；重启面板即恢复 |
| 进插件时面板先矮一下再撑开 / 打字时窗口一直在变尺寸 | 插件自己 clamp 了高度（`Math.min(MAX_HEIGHT, h)`），和宿主的口径对不上 | 去掉插件里的封顶，只上报内容实测高度，边界交给宿主（§4.2 面板高度） |
| 内容比预期矮，下方留了一块空白 | 宿主把视口补齐到了「搜索结果那么高」（防切换时跳动） | 正常行为，不是 bug；别为了填满而虚报高度 |
| 免关键字死活不出现结果 | 只写了 `onQuery`，没写 `onProvide` | provider 必须实现 `onProvide`（§4.3） |

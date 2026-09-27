import type {
  ClipHistoryEntry,
  PluginAPI,
  PluginFeatureContext,
  PluginInstance,
  ProviderItem,
} from "../types";

/**
 * 浏览器里的「假宿主」。
 *
 * 它复刻 ya 宿主的三件事，让 dev 预览的行为和真机一致：
 *   1. window.__registerPlugin（插件代码靠它注册自己）
 *   2. api 全套方法（本地能模拟的就真做，做不了的记录到日志面板）
 *   3. 输入调度：必须「关键字 + 空格」才进插件，之后参数变化触发 onQuery
 *   4. provider 模式（`provider: true`）：不进插件也会把输入原文交给 onProvide
 */

export interface MockOptions {
  id: string;
  keywords: string[];
  name?: string;
  /** plugin.json 的 features[]：`<关键字> <cmd> <参数>` 可切到对应入口 */
  features?: { cmd: string; keywords?: string[] }[];
  /** plugin.json 的 `provider: true`：免关键字，把搜索原文交给 onProvide */
  provider?: boolean;
  /** dev 下 onProvide 超时被禁用的门槛（毫秒，与宿主一致） */
  provideTimeout?: number;
}

/** 与宿主一致的内容视口边界，见 ya/Sources/ya/Web/ui.ts */
const PLUGIN_VIEWPORT_MIN = 240;
const PLUGIN_VIEWPORT_MAX = 560;

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" } as Record<string, string>)[c],
  );
}

/* ---- dev 剪贴板假数据 ----
   真机上这份数据由宿主 ClipboardManager 常驻维护，插件只读。
   这里造几条覆盖「文本 / 图片 / 文件 / 已收藏」四种形态，够看清渲染差异。 */

let clipSeq = 0;

function clipThumb(text: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28"><rect width="28" height="28" rx="5" fill="#4da3ff"/><text x="14" y="18" font-size="12" text-anchor="middle" fill="#fff">${text}</text></svg>`;
  return "data:image/svg+xml," + encodeURIComponent(svg);
}

function clipEntry(e: Partial<ClipHistoryEntry> & { kind: ClipHistoryEntry["kind"] }): ClipHistoryEntry {
  clipSeq += 1;
  return {
    id: `clip-${clipSeq}`,
    text: "",
    paths: [],
    timestamp: Date.now() / 1000 - clipSeq * 137,
    pinned: false,
    hasImage: false,
    ...e,
  };
}

let clipboardStore: ClipHistoryEntry[] = [
  clipEntry({ kind: "text", text: "https://ya.app — 一款自己写的 Mac 启动器", pinned: true }),
  clipEntry({ kind: "text", text: "pnpm build && pnpm zip" }),
  clipEntry({ kind: "image", hasImage: true, text: "" }),
  clipEntry({
    kind: "file",
    paths: ["/Users/zhouyefei/Desktop/ya-plugin/README.md"],
    text: "/Users/zhouyefei/Desktop/ya-plugin/README.md",
  }),
  clipEntry({ kind: "text", text: "SELECT * FROM plugins WHERE keyword LIKE 'clip%';" }),
];

/// 与宿主一致：收藏置顶，其余按时间倒序
function sortedClipboard(): ClipHistoryEntry[] {
  return [...clipboardStore].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return b.timestamp - a.timestamp;
  });
}

export function createMockHost(opts: MockOptions) {
  const inputEl = document.getElementById("input") as HTMLInputElement;
  const viewEl = document.getElementById("pluginView") as HTMLDivElement;
  const logEl = document.getElementById("log") as HTMLUListElement;
  const toastEl = document.getElementById("toast") as HTMLDivElement;
  const statusEl = document.getElementById("status") as HTMLDivElement;

  let plugin: PluginInstance | null = null;
  let entered = false;
  let subInput: ((text: string) => void) | null = null;
  let activeCmd: string | null = null; // 当前入口 cmd（主入口为 ""）
  let timer: number | undefined;
  let provideToken = 0; // provider 的并发守卫：只认最后一次请求的结果
  let provideDisabled = false; // provider 超时/抛异常后本次会话停用（与宿主一致）
  let toastTimer: number | undefined;

  const kwList = opts.keywords.filter(Boolean);

  function log(text: string) {
    const li = document.createElement("li");
    li.textContent = text;
    logEl.prepend(li);
    while (logEl.children.length > 60) logEl.lastElementChild?.remove();
    // eslint-disable-next-line no-console
    console.log("[ya-mock]", text);
  }

  function toast(text: string) {
    toastEl.textContent = text;
    toastEl.classList.add("show");
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toastEl.classList.remove("show"), 1800);
  }

  function setStatus(text: string) {
    statusEl.textContent = text;
  }

  const api: PluginAPI = {
    callBridge: async (action, payload) => {
      log(`callBridge(${action}${payload !== undefined ? ", " + JSON.stringify(payload) : ""})`);
      return null;
    },
    esc: escapeHtml,
    lang: () => (navigator.language.toLowerCase().startsWith("zh") ? "zh" : "en"),

    hide: () => {
      log("hide() → 真机上面板会关闭");
      setStatus("面板已隐藏（真机行为）");
    },
    show: () => {
      log("show()");
      setStatus("面板已显示");
    },
    setExpendHeight: (height) => {
      // 与真机宿主同一套口径（对不上号的话，dev 里看着刚好，装上才发现高了/矮了）：
      // 建议值会被夹到 [下界, 上界]，超出就在容器里滚动，插件不用自己封顶。
      const h = Math.min(Math.max(height, PLUGIN_VIEWPORT_MIN), PLUGIN_VIEWPORT_MAX);
      viewEl.style.minHeight = `${PLUGIN_VIEWPORT_MIN}px`;
      viewEl.style.height = `${h}px`;
      viewEl.style.overflowY = "auto";
      log(
        `setExpendHeight(${height}) → 视口 ${h}px` +
          (h !== height ? `（宿主 clamp 到 ${PLUGIN_VIEWPORT_MIN}–${PLUGIN_VIEWPORT_MAX}）` : "")
      );
    },
    setSubInput: (handler, placeholder) => {
      subInput = handler;
      log(`setSubInput(${placeholder ? `"${placeholder}"` : ""}) → 输入由插件接管`);
      if (placeholder) inputEl.placeholder = placeholder;
    },
    setSubInputValue: (text) => {
      log(`setSubInputValue("${text}")`);
      inputEl.value = `${kwList[0] ?? ""} ${text}`;
    },
    removeSubInput: () => {
      subInput = null;
      log("removeSubInput()");
      inputEl.placeholder = `输入 ${kwList[0] ?? "keyword"} + 空格 进入插件`;
    },
    showInput: (placeholder) => {
      log(`showInput(${placeholder ? `"${placeholder}"` : ""}) → 真机上会显示出宿主输入框`);
      if (placeholder) inputEl.placeholder = placeholder;
    },
    hideInput: () => {
      log("hideInput() → 真机上会收起宿主输入框");
      inputEl.placeholder = `输入 ${kwList[0] ?? "keyword"} + 空格 进入插件`;
    },

    notice: (body) => {
      log(`notice("${body}")`);
      toast("🔔 " + body);
    },
    openPath: (p) => log(`openPath("${p}") → 真机会启动该路径`),
    openURL: (u) => {
      log(`openURL("${u}")`);
      window.open(u, "_blank");
    },
    showInFinder: (p) => log(`showInFinder("${p}")`),
    trashItem: (p) => log(`trashItem("${p}") → dev 下不真删`),
    beep: () => log("beep()"),
    getPath: async (name) => `~/${name}`,
    getFileIcon: async () =>
      "data:image/svg+xml," +
      encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" rx="6" fill="#4da3ff"/></svg>`),
    getNativeId: async () => "dev-mock",
    getAppInfo: async () => ({ name: "ya", version: "dev" }),
    isDarkColors: async () => true,
    // dev 下资源走 dev server；public/ 里的文件在根路径下
    assetUrl: async (name) => {
      log(`assetUrl("${name}")`);
      try {
        const res = await fetch("/" + name);
        if (!res.ok) return "";
        const blob = await res.blob();
        return await new Promise<string>((resolve) => {
          const fr = new FileReader();
          fr.onload = () => resolve(String(fr.result));
          fr.readAsDataURL(blob);
        });
      } catch {
        return "";
      }
    },

    copyText: (text) => {
      log(`copyText("${text.slice(0, 40)}…")`);
      navigator.clipboard?.writeText(text).then(
        () => toast("已复制到剪贴板"),
        () => toast("复制失败（浏览器权限）"),
      );
    },
    getClipboardText: async () => {
      try {
        return await navigator.clipboard.readText();
      } catch {
        toast("读剪贴板被浏览器拒绝");
        return "";
      }
    },
    getCopiedFiles: async () => [],
    getClipboardHistory: async () => sortedClipboard(),
    clipboard: {
      history: async () => sortedClipboard(),
      image: async (id: string) => {
        const e = clipboardStore.find((x) => x.id === id);
        return e?.hasImage ? clipThumb("IMG") : "";
      },
      copy: async (id: string) => {
        const e = clipboardStore.find((x) => x.id === id);
        if (!e) return false;
        log(`clipboard.copy("${id}") → ${(e.text || e.paths.join("\n")).slice(0, 40)}`);
        toast("已复制到剪贴板（dev 模拟）");
        return true;
      },
      pin: async (id: string) => {
        const e = clipboardStore.find((x) => x.id === id);
        if (e) {
          e.pinned = !e.pinned;
          log(`clipboard.pin("${id}") → pinned=${e.pinned}`);
        }
      },
      remove: async (id: string) => {
        clipboardStore = clipboardStore.filter((x) => x.id !== id);
        log(`clipboard.remove("${id}")`);
      },
      clear: async (includingPinned: boolean) => {
        const before = clipboardStore.length;
        clipboardStore = includingPinned ? [] : clipboardStore.filter((x) => x.pinned);
        log(`clipboard.clear(${includingPinned}) → 清掉 ${before - clipboardStore.length} 条`);
      },
    },

    db: {
      getItem: async (key) => localStorage.getItem(`ya-mock:${opts.id}:${key}`) ?? "",
      setItem: async (key, value) => {
        localStorage.setItem(`ya-mock:${opts.id}:${key}`, value);
        log(`db.setItem("${key}")`);
      },
      removeItem: async (key) => {
        localStorage.removeItem(`ya-mock:${opts.id}:${key}`);
        log(`db.removeItem("${key}")`);
      },
    },
  };

  function showHint() {
    const how = opts.provider
      ? `直接输入内容即可（免关键字）；也可输入 <b>${kwList[0] ?? "keyword"}</b> + 空格进入插件面板`
      : `输入 <b>${kwList[0] ?? "keyword"}</b> + 空格进入插件`;
    viewEl.innerHTML = `<div class="mock-hint">${how}</div>`;
    viewEl.style.height = "";
  }

  function enter() {
    if (entered) return;
    entered = true;
    viewEl.classList.add(`ya-plugin-${opts.id}`);
    setStatus(`已进入插件 ${opts.id}`);
    plugin?.onEnter?.(api);
  }

  /// 解析入口：<关键字> <cmd> <参数>，cmd 命不中就整体当「主入口 + 参数」
  function parseFeature(rest: string): { cmd: string; arg: string } {
    const m = /^(\S+)(?:\s([\s\S]*))?$/.exec(rest);
    if (!m) return { cmd: "", arg: rest };
    const first = m[1].toLowerCase();
    const hit = (opts.features || []).find(
      (f) => f.cmd === first || (f.keywords || []).some((k) => k.toLowerCase() === first),
    );
    return hit ? { cmd: hit.cmd, arg: m[2] ?? "" } : { cmd: "", arg: rest };
  }

  function exit() {
    if (!entered) return;
    entered = false;
    subInput = null;
    activeCmd = null;
    plugin?.onExit?.();
    viewEl.classList.remove(`ya-plugin-${opts.id}`);
    setStatus("搜索模式");
    showHint();
  }

  /// provider 通道：把输入原文交给 onProvide，把返回的条目画进结果列表。
  /// 真机上这一段是宿主主列表渲染的（插件只给数据），dev 里用最简 DOM 复刻外观。
  async function provide(raw: string) {
    if (!opts.provider || !plugin?.onProvide || provideDisabled) return;
    const id = ++provideToken;
    let items: ProviderItem[] = [];
    try {
      const out = await Promise.race([
        Promise.resolve(plugin.onProvide(raw, api)),
        new Promise<null>((r) => window.setTimeout(() => r(null), opts.provideTimeout ?? 300)),
      ]);
      if (out === null) {
        // 超时：与宿主一致 —— 本次会话不再问它，避免每次击键都卡
        provideDisabled = true;
        log("onProvide 超时（>300ms）→ 本次会话停用，与真机一致");
        showHint();
        return;
      }
      if (id !== provideToken) return; // 期间用户又改了输入，丢弃旧结果
      items = (out || []).slice(0, 3);
    } catch (e) {
      provideDisabled = true;
      log(`onProvide 抛异常 → 本次会话停用：${(e as Error)?.message ?? e}`);
      showHint();
      return;
    }
    if (!items.length) {
      showHint();
      return;
    }
    viewEl.innerHTML = "";
    for (const it of items) {
      const row = document.createElement("div");
      row.className = "mock-provide-row";
      if (it.swatch) {
        const sw = document.createElement("span");
        sw.className = "mock-provide-swatch";
        sw.style.background = it.swatch;
        row.appendChild(sw);
      }
      const title = document.createElement("div");
      title.className = "mock-provide-title";
      title.textContent = it.title;
      const sub = document.createElement("div");
      sub.className = "mock-provide-sub";
      sub.textContent = it.subtitle ?? "";
      row.appendChild(title);
      row.appendChild(sub);
      // 点击 = 回车执行：真机上宿主负责这一段，dev 里手动补上
      row.addEventListener("click", () => {
        if (it.action) return it.action();
        if (it.copy) api.copyText(it.copy);
        if (it.openURL) api.openURL(it.openURL);
        api.hide();
      });
      viewEl.appendChild(row);
    }
  }

  function dispatch(raw: string) {
    const m = /^(\S+)\s([\s\S]*)$/.exec(raw);
    if (!m || kwList.indexOf(m[1].toLowerCase()) < 0) {
      exit();
      if (opts.provider) void provide(raw);
      else showHint();
      return;
    }
    enter();
    const { cmd, arg } = parseFeature(m[2]);
    if (activeCmd !== cmd) {
      activeCmd = cmd;
      if (cmd) setStatus(`入口 ${cmd}`);
      plugin?.onFeature?.({ cmd, title: cmd || opts.id } as PluginFeatureContext, api);
    }
    if (subInput) subInput(arg);
    else plugin?.onQuery(arg, viewEl, api, { cmd, title: cmd || opts.id } as PluginFeatureContext);
  }

  inputEl.addEventListener("input", () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => dispatch(inputEl.value), 120);
  });

  // 挂在 document 上而不是 inputEl 上：真宿主也是 document 级监听（见 ya 的 shell.ts），
  // 插件自己画的输入框 / 列表才能收到按键。挂错地方会让 dev 预览的快捷键「看起来是好的」，
  // 或者在真机上重复触发（插件里再挂一次 keydown 就会执行两遍）。
  document.addEventListener("keydown", (e) => {
    if (!entered || !plugin) return;
    if (plugin.onKey && plugin.onKey(e, viewEl, api)) {
      e.preventDefault();
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      exit();
      inputEl.value = "";
    }
  });

  (window as any).__registerPlugin = (p: PluginInstance) => {
    plugin = p;
    log("插件已注册 __registerPlugin()");
  };

  inputEl.placeholder = `输入 ${kwList[0] ?? "keyword"} + 空格 进入插件`;
  showHint();
  setStatus("搜索模式");

  return {
    /** 手动触发一次查询（等价于在输入框里敲了 raw） */
    runQuery(raw: string) {
      inputEl.value = raw;
      dispatch(raw);
    },
    /**
     * dev 便利：/?arg=xxx（可选 &kw=qr）直接以指定参数进入插件，省去每次手敲。
     * 必须在插件代码 import 完成之后调用，否则插件还没注册。
     */
    applyUrlParams() {
      const params = new URLSearchParams(location.search);
      const cmd = params.get("cmd") ?? "";
      const arg = params.get("arg");
      if (arg === null && !cmd) return;
      const kw = params.get("kw") ?? kwList[0] ?? "";
      // 注意别用 filter(Boolean)：arg 为空串时也要保留「关键字 + 空格」的尾随空格，否则进不了插件
      const query = cmd ? `${kw} ${cmd} ${arg ?? ""}` : `${kw} ${arg ?? ""}`;
      this.runQuery(query);
    },
  };
}

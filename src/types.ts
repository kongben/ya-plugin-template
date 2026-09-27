/// 宿主注入的 API 与插件形态（与 ya/docs/plugin-api.md 一致，dev 预览也按这套实现）

export interface PluginAPI {
  // 通用
  callBridge(action: string, payload?: any): Promise<any>;
  esc(html: string): string;
  lang(): string;
  // 窗口
  hide(): void;
  show(): void;
  /// 告诉宿主插件内容区要多少 px 高（**不含**搜索栏/底栏，宿主自动补）。
  /// 这只是「建议值」：宿主会把它夹到统一区间（下界 = 当前搜索结果的高度，上界 = 面板封顶），
  /// 超出就在容器里滚动。插件**不要**自己写 Math.min(MAX_HEIGHT, …) 那套封顶 ——
  /// 各写各的会让「搜索 → 插件」切换时面板尺寸换一档，看着就是在闪。
  setExpendHeight(height: number): void;
  setSubInput(handler: (text: string) => void, placeholder?: string): void;
  setSubInputValue(text: string): void;
  removeSubInput(): void;
  // 宿主输入框：进插件后默认收起（交互交给插件），需要输入的插件可再要回来
  showInput(placeholder?: string): void;
  hideInput(): void;
  // 系统
  notice(body: string): void;
  openPath(path: string): void;
  openURL(url: string): void;
  showInFinder(path: string): void;
  trashItem(path: string): void;
  beep(): void;
  getPath(name: string): Promise<string>;
  getFileIcon(pathOrExt: string): Promise<string>;
  getNativeId(): Promise<string>;
  getAppInfo(): Promise<{ name: string; version: string }>;
  isDarkColors(): Promise<boolean>;
  assetUrl(name: string): Promise<string>;
  // 剪贴板
  copyText(text: string): void;
  getClipboardText(): Promise<string>;
  getCopiedFiles(): Promise<any[]>;
  getClipboardHistory(): Promise<ClipHistoryEntry[]>;
  // 剪贴板历史（结构化：文本 / 图片 / 文件）
  clipboard: {
    history(): Promise<ClipHistoryEntry[]>;
    image(id: string): Promise<string>; // 缩略图 data URL
    copy(id: string): Promise<boolean>; // 把某条写回系统剪贴板
    pin(id: string): Promise<any>; // 收藏 / 取消收藏
    remove(id: string): Promise<any>;
    clear(includingPinned?: boolean): Promise<any>;
  };
  // 存储（按插件隔离，值只能是字符串）
  db: {
    getItem(key: string): Promise<string>;
    setItem(key: string, value: string): Promise<any>;
    removeItem(key: string): Promise<any>;
  };
}

/// 剪贴板历史条目（文本 / 图片 / 文件）
export interface ClipHistoryEntry {
  id: string;
  kind: "text" | "image" | "file";
  text: string; // 文本内容；file 类型为换行拼接的路径
  paths: string[]; // 文件路径（仅 file 类型）
  timestamp: number; // 秒级时间戳
  pinned: boolean;
  hasImage: boolean; // 有缩略图时可取 api.clipboard.image(id)
}

/// 当前入口（plugin.json features[] 中的一项；主入口 cmd 为空串）
export interface PluginFeatureContext {
  cmd: string;
  title: string;
}

/// 结果提供者（plugin.json 的 `provider: true`）往宿主主结果列表里贡献的一条结果。
///
/// 与「接管面板型」的区别：这一条由宿主渲染、宿主管键盘导航与回车执行，
/// 插件只回答「显示什么」和「做什么」，完全不碰 DOM。
export interface ProviderItem {
  title: string;
  subtitle?: string;
  /// 回车要复制的文本（没给 action 时的默认动作）
  copy?: string;
  /// 回车要打开的链接（有值时同时打开与复制）
  openURL?: string;
  /// 左侧小色块（CSS 颜色值，颜色识别用）
  swatch?: string;
  /// 完全自定义动作；给了它就忽略 copy / openURL，且宿主不会自动收起面板
  action?: () => void;
}

export interface PluginInstance {
  onQuery(
    arg: string,
    container: HTMLElement,
    api: PluginAPI,
    feature?: PluginFeatureContext,
  ): void;
  onKey?(e: KeyboardEvent, container: HTMLElement, api: PluginAPI): boolean;
  onEnter?(api: PluginAPI): void;
  onExit?(): void;
  onFeature?(feature: PluginFeatureContext, api: PluginAPI): void;

  /// 结果提供者专用：宿主每次搜索都把输入原文交给你，返回要插进主列表的结果。
  ///
  /// 这是**每次击键都会跑**的代码，宿主有三道护栏：单次 300ms 超时（超时当没结果）、
  /// 抛异常就本次会话停用、单插件最多 3 条。所以这里必须快、必须不抛异常。
  /// 返回空数组表示「这次没我的事」。可同步返回，也可返回 Promise。
  onProvide?(query: string, api: PluginAPI): ProviderItem[] | Promise<ProviderItem[]>;
}

declare global {
  // 宿主在 eval 插件代码前挂到 window 上
  // eslint-disable-next-line no-var
  function __registerPlugin(plugin: PluginInstance): void;
}

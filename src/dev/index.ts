import "./dev.css";
import manifest from "../../plugin.json";
import { createMockHost } from "./host";

// dev 只做一件事：搭好假宿主，然后加载真正的插件源码（和宿主一样走注册流程）。
// 必须等 __registerPlugin 挂上之后再 import 插件代码，所以这里用动态 import。
// 显式定型而不是直接用 manifest：plugin.json 里的 features / provider 是可选的，
// 不写这两个字段的插件 TS 会报「属性不存在」。
const m = manifest as unknown as {
  id: string;
  keyword?: string;
  keywords?: string[];
  name?: string | { zh?: string; en?: string };
  features?: { cmd: string; keywords?: string[] }[];
  provider?: boolean;
};

const host = createMockHost({
  id: m.id,
  keywords: m.keywords ?? (m.keyword ? [m.keyword] : []),
  name: typeof m.name === "string" ? m.name : m.name?.zh,
  features: m.features ?? [],
  provider: m.provider === true,
});

await import("../main");

// 支持 /?arg=xxx 直接以指定参数预览
host.applyUrlParams();

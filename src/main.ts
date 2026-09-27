import QRCode from "qrcode";
import "./style.css";
import type { PluginAPI } from "./types";

/**
 * 示例插件：把输入文字转成二维码。
 * 它同时演示了脚手架存在的意义 —— `qrcode` 是 npm 包，
 * 构建时会被 vite 整包打进 main.js（IIFE），插件目录里不留任何依赖。
 */

const SIZE = 220;
let current = "";

function render(container: HTMLElement, dataUrl: string, text: string) {
  container.innerHTML = `
    <div class="qr-wrap">
      <img class="qr-img" src="${dataUrl}" alt="QR" />
      <div class="qr-text">${escapeHtml(text)}</div>
      <div class="qr-tip">Enter 复制原文 · Esc 退回搜索</div>
    </div>`;
}

// 宿主有 api.esc()，但构建产物里不能假设顺序，这里自带一份
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" } as Record<string, string>)[c],
  );
}

__registerPlugin({
  onEnter(api: PluginAPI) {
    api.setExpendHeight(340);
  },

  async onQuery(arg: string, container: HTMLElement, api: PluginAPI) {
    const text = arg.trim();
    if (!text) {
      container.innerHTML = `<div class="qr-empty">输入内容后生成二维码</div>`;
      api.setExpendHeight(200);
      return;
    }
    current = text;
    try {
      // type: "svg" 不走 canvas，缩放更清晰；宿主 WebView 支持内联 SVG
      const svg = await QRCode.toString(text, {
        type: "svg",
        width: SIZE,
        margin: 1,
        errorCorrectionLevel: "M",
      });
      const url = "data:image/svg+xml," + encodeURIComponent(svg);
      render(container, url, text);
      api.setExpendHeight(340);
    } catch (e) {
      container.innerHTML = `<div class="qr-error">生成失败：${escapeHtml(String(e))}</div>`;
    }
  },

  onKey(e: KeyboardEvent, container: HTMLElement, api: PluginAPI) {
    if (e.key === "Enter" && current) {
      api.copyText(current);
      api.notice("已复制原文");
      api.hide();
      return true; // 已消费，宿主不再处理
    }
    return false;
  },

  onExit() {
    current = "";
  },
});

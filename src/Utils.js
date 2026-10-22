// Font .ttf tĩnh có tiếng Việt, đặt trong public/fonts/
// Regular là bắt buộc. Bold / Italic / BoldItalic có thì dùng, không có thì giả lập.
export const FONT_BASE = "/fonts/Roboto-";
export const FONT_FILES = ["Regular", "Bold", "Italic", "BoldItalic"];

export const CSS_FAMILY = {
  sans: "Arial, Helvetica, sans-serif",
  serif: '"Times New Roman", Times, serif',
  mono: '"Courier New", Courier, monospace',
};

export const uid = () => Math.random().toString(36).slice(2, 10);

export const hexToRgb = (hex) => {
  const n = parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

export const toHex = (c) =>
  "#" + c.map((v) => v.toString(16).padStart(2, "0")).join("");

// Đo bề rộng chữ (đơn vị pt) để vẽ khung chọn cho khớp
let mctx = null;
export const measureText = (text, { fs, bold, italic, family }) => {
  mctx = mctx || document.createElement("canvas").getContext("2d");
  mctx.font = `${italic ? "italic " : ""}${bold ? "bold " : ""}${fs}px ${
    CSS_FAMILY[family || "sans"]
  }`;
  return mctx.measureText(text).width;
};

// Đoán đậm / nghiêng / họ font của chữ gốc từ font mà pdf.js đã nạp
export function fontStyleOf(page, it) {
  let name = "";
  let bold = false;
  let italic = false;
  try {
    if (page.commonObjs.has(it.fontName)) {
      const f = page.commonObjs.get(it.fontName);
      name = f.name || f.fallbackName || "";
      bold = !!(f.bold || f.black);
      italic = !!f.italic;
    }
  } catch {
    /* font chưa sẵn sàng */
  }
  const s = `${name} ${it.ff || ""}`.toLowerCase();
  if (/bold|black|heavy|semibold|demi/.test(s)) bold = true;
  if (/italic|oblique/.test(s)) italic = true;
  const family = /courier|mono|consolas|menlo/.test(s)
    ? "mono"
    : /sans|arial|helvet|calibri|tahoma|verdana|segoe|roboto/.test(s)
      ? "sans"
      : /times|serif|georgia|garamond|cambria|minion|palatino/.test(s)
        ? "serif"
        : "sans";
  return { bold, italic, family };
}

import {
  PDFDocument,
  StandardFonts,
  rgb,
  degrees,
  BlendMode,
  LineCapStyle,
} from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { FONT_BASE, FONT_FILES, CSS_FAMILY, hexToRgb } from "./Utils";

const STD = {
  sans: [
    "Helvetica",
    "HelveticaBold",
    "HelveticaOblique",
    "HelveticaBoldOblique",
  ],
  serif: [
    "TimesRoman",
    "TimesRomanBold",
    "TimesRomanItalic",
    "TimesRomanBoldItalic",
  ],
  mono: ["Courier", "CourierBold", "CourierOblique", "CourierBoldOblique"],
};

const color = (hex) => {
  const [r, g, b] = hexToRgb(hex);
  return rgb(r / 255, g / 255, b / 255);
};

/**
 * @param sources Map<id, {bytes}>
 * @param pages   [{id, src, idx, rot, blank?, w?, h?}] theo thứ tự xuất
 * @param edits   [{pageId, kind, ...}]
 */
export async function exportPdf({ sources, pages, edits }) {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  let rasterized = 0;

  /* ---------- font ---------- */
  const stdCache = new Map();
  const getStd = async (fam, b, i) => {
    const name = STD[fam][(b ? 1 : 0) + (i ? 2 : 0)];
    if (!stdCache.has(name))
      stdCache.set(name, await doc.embedFont(StandardFonts[name]));
    return stdCache.get(name);
  };

  const ttfCache = new Map();
  const loadTtf = async (idx) => {
    if (ttfCache.has(idx)) return ttfCache.get(idx);
    let f = null;
    try {
      const r = await fetch(`${FONT_BASE}${FONT_FILES[idx]}.ttf`);
      if (r.ok && !(r.headers.get("content-type") || "").includes("html")) {
        f = await doc.embedFont(await r.arrayBuffer(), { subset: true });
      }
    } catch {
      f = null;
    }
    ttfCache.set(idx, f);
    return f;
  };
  const getCustom = async (b, i) => {
    const exact = await loadTtf((b ? 1 : 0) + (i ? 2 : 0));
    if (exact) return { font: exact, fakeB: false, fakeI: false };
    const reg = await loadTtf(0);
    return reg ? { font: reg, fakeB: b, fakeI: i } : null;
  };

  /* ---------- vẽ từng loại chỉnh sửa ---------- */
  const drawText = async (pg, e) => {
    if (e.kind === "item") {
      const b = e.bg || [255, 255, 255];
      pg.drawRectangle({
        x: e.x - 1,
        y: e.y - e.fs * 0.28,
        width: e.w + 2,
        height: e.fs * 1.2,
        color: rgb(b[0] / 255, b[1] / 255, b[2] / 255),
      });
    }
    if (!e.text) return;

    const col = color(e.color);
    const isB = !!e.bold;
    const isI = !!e.italic;
    const draw = (font, fakeB, fakeI) => {
      const o = { x: e.x, y: e.y, size: e.fs, font, color: col };
      if (fakeI) o.ySkew = degrees(12);
      pg.drawText(e.text, o);
      if (fakeB) pg.drawText(e.text, { ...o, x: e.x + e.fs * 0.025 });
    };

    const c = await getCustom(isB, isI);
    if (c) return draw(c.font, c.fakeB, c.fakeI);

    const sf = await getStd(e.family || "sans", isB, isI);
    let ok = true;
    try {
      sf.encodeText(e.text);
    } catch {
      ok = false;
    }
    if (ok) return draw(sf, false, false);

    // Chữ có dấu tiếng Việt mà không có font → vẽ thành ảnh PNG
    const k = 4;
    const cv = document.createElement("canvas");
    const g = cv.getContext("2d");
    const font = `${isI ? "italic " : ""}${isB ? "bold " : ""}${e.fs * k}px ${
      CSS_FAMILY[e.family || "sans"]
    }`;
    g.font = font;
    cv.width = Math.ceil(g.measureText(e.text).width) + 8;
    cv.height = Math.ceil(e.fs * k * 1.4);
    g.font = font;
    g.fillStyle = e.color;
    g.fillText(e.text, 4, e.fs * k * 1.1);
    const img = await doc.embedPng(cv.toDataURL("image/png").split(",")[1]);
    pg.drawImage(img, {
      x: e.x - 4 / k,
      y: e.y - e.fs * 0.3,
      width: cv.width / k,
      height: cv.height / k,
    });
    rasterized++;
  };

  const imgCache = new Map();
  const drawEdit = async (pg, e) => {
    switch (e.kind) {
      case "item":
      case "new":
        return drawText(pg, e);
      case "rect":
        return pg.drawRectangle({
          x: e.x,
          y: e.y,
          width: e.w,
          height: e.h,
          color: color(e.color),
          opacity: e.opacity ?? 1,
          ...(e.multiply ? { blendMode: BlendMode.Multiply } : {}),
        });
      case "ink": {
        const c = color(e.color);
        for (let i = 1; i < e.pts.length; i++) {
          pg.drawLine({
            start: { x: e.pts[i - 1][0], y: e.pts[i - 1][1] },
            end: { x: e.pts[i][0], y: e.pts[i][1] },
            thickness: e.width,
            color: c,
            lineCap: LineCapStyle.Round,
          });
        }
        return;
      }
      case "image": {
        if (!imgCache.has(e.url))
          imgCache.set(e.url, await doc.embedPng(e.bytes));
        return pg.drawImage(imgCache.get(e.url), {
          x: e.x,
          y: e.y,
          width: e.w,
          height: e.h,
        });
      }
      default:
    }
  };

  /* ---------- dựng lại tài liệu theo thứ tự trang ---------- */
  const libs = new Map();
  const getLib = async (id) => {
    if (!libs.has(id)) {
      libs.set(
        id,
        await PDFDocument.load(sources.get(id).bytes.slice(), {
          ignoreEncryption: true,
        }),
      );
    }
    return libs.get(id);
  };

  // Sao chép trước các trang duy nhất của mỗi file nguồn (dùng chung tài nguyên)
  const need = new Map();
  pages.forEach((p) => {
    if (p.blank) return;
    if (!need.has(p.src)) need.set(p.src, new Set());
    need.get(p.src).add(p.idx - 1);
  });
  const pre = new Map();
  for (const [src, set] of need) {
    const idxs = [...set];
    const copied = await doc.copyPages(await getLib(src), idxs);
    idxs.forEach((ix, i) => pre.set(`${src}:${ix}`, copied[i]));
  }

  const used = new Set();
  for (const p of pages) {
    let pg;
    if (p.blank) {
      pg = doc.addPage([p.w, p.h]);
    } else {
      const k = `${p.src}:${p.idx - 1}`;
      let cp;
      if (!used.has(k)) {
        cp = pre.get(k);
        used.add(k);
      } else {
        [cp] = await doc.copyPages(await getLib(p.src), [p.idx - 1]); // trang nhân bản
      }
      pg = doc.addPage(cp);
    }
    if (p.rot)
      pg.setRotation(
        degrees((((pg.getRotation().angle + p.rot) % 360) + 360) % 360),
      );

    for (const e of edits) {
      if (e.pageId === p.id) await drawEdit(pg, e);
    }
  }

  return { bytes: await doc.save(), rasterized };
}

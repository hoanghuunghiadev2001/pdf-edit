import { useState, useRef, useEffect } from "react";
import {
  Button,
  Upload,
  Tooltip,
  ColorPicker,
  InputNumber,
  Dropdown,
  message,
  ConfigProvider,
  theme,
  Spin,
} from "antd";
import {
  FilePdfOutlined,
  UploadOutlined,
  DownloadOutlined,
  EditOutlined,
  FontSizeOutlined,
  UndoOutlined,
  RedoOutlined,
  BoldOutlined,
  ItalicOutlined,
  ZoomInOutlined,
  ZoomOutOutlined,
  BorderOutlined,
  HighlightOutlined,
  GatewayOutlined,
  PictureOutlined,
  SelectOutlined,
  RotateRightOutlined,
  DeleteOutlined,
  CopyOutlined,
  FileAddOutlined,
  FileOutlined,
  FileImageOutlined,
  PlusOutlined,
  ExportOutlined,
  SwapOutlined,
  CheckSquareOutlined,
  ScanOutlined,
} from "@ant-design/icons";
import * as pdfjsLib from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { createWorker } from "tesseract.js";
import "./App.css";
import PageView from "./PageView";
import PageThumb from "./PageThumb";
import { exportPdf } from "./ExportPdf";
import { uid } from "./Utils";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

const PAGE_MIME = "application/x-pe-pages";
const PRESET = { a4: [595, 842], a4l: [842, 595], letter: [612, 792] };
const EMPTY = { past: [], present: { pages: [], edits: [] }, future: [] };
const isPdf = (f) => f.type === "application/pdf" || /\.pdf$/i.test(f.name);
const isImg = (f) => f.type.startsWith("image/");

// Mọi ảnh → PNG (exportPdf chỉ embedPng)
const imageToPng = (file) =>
  new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const cv = document.createElement("canvas");
      cv.width = img.naturalWidth;
      cv.height = img.naturalHeight;
      cv.getContext("2d").drawImage(img, 0, 0);
      cv.toBlob(async (blob) => {
        URL.revokeObjectURL(url);
        if (!blob) return reject(new Error("toBlob failed"));
        resolve({
          bytes: new Uint8Array(await blob.arrayBuffer()),
          url: URL.createObjectURL(blob),
          mime: "image/png",
          aspect: img.naturalHeight / img.naturalWidth,
        });
      }, "image/png");
    };
    img.onerror = reject;
    img.src = url;
  });

// Ảnh → 1 trang PDF (A4, tự chọn dọc/ngang, ảnh nằm giữa)
const imageToPage = async (file) => {
  const im = await imageToPng(file);
  const land = im.aspect < 1;
  const [W, H] = land ? PRESET.a4l : PRESET.a4;
  let w = W;
  let h = W * im.aspect;
  if (h > H) {
    h = H;
    w = H / im.aspect;
  }
  const page = { id: uid(), blank: true, w: W, h: H, rot: 0 };
  const edit = {
    key: uid(),
    pageId: page.id,
    kind: "image",
    x: (W - w) / 2,
    y: (H - h) / 2,
    w,
    h,
    url: im.url,
    bytes: im.bytes,
    mime: im.mime,
  };
  return { page, edit };
};

const INSERT_ITEMS = [
  {
    key: "blank",
    label: "Trang trắng",
    icon: <FileOutlined />,
    children: [
      { key: "blank:same:before", label: "Cùng cỡ - phía trước" },
      { key: "blank:same:after", label: "Cùng cỡ - phía sau" },
      { key: "blank:a4:after", label: "A4 dọc - phía sau" },
      { key: "blank:a4l:after", label: "A4 ngang - phía sau" },
      { key: "blank:letter:after", label: "Letter - phía sau" },
    ],
  },
  {
    key: "pdf",
    label: "Từ file PDF",
    icon: <FileAddOutlined />,
    children: [
      { key: "pdf:before", label: "Phía trước" },
      { key: "pdf:after", label: "Phía sau" },
    ],
  },
  {
    key: "img",
    label: "Từ ảnh (1 ảnh = 1 trang)",
    icon: <FileImageOutlined />,
    children: [
      { key: "img:before", label: "Phía trước" },
      { key: "img:after", label: "Phía sau" },
    ],
  },
];

export default function App() {
  const [msg, ctx] = message.useMessage();
  const rootRef = useRef(null);
  const pdfInputRef = useRef(null);
  const imgInputRef = useRef(null);
  const openInputRef = useRef(null);
  const pendingRef = useRef({ index: 0 });
  const anchorRef = useRef(null);
  const dragCount = useRef(0);
  const lockUntil = useRef(0);
  const raf = useRef(0);
  const keyRef = useRef(null);
  const workerRef = useRef(null); // tesseract worker

  // lịch sử (hoàn tác / làm lại) cho cả trang lẫn chỉnh sửa
  const [hist, setHist] = useState(EMPTY);
  const { pages, edits } = hist.present;
  const [sources, setSources] = useState(() => new Map());
  const [current, setCurrent] = useState(null);
  const [selected, setSelected] = useState(null); // đối tượng đang chọn
  const [sel, setSel] = useState([]); // trang đang chọn ở thanh bên
  const [ocr, setOcr] = useState({}); // "src:idx" -> [dòng chữ OCR]

  const [fileName, setFileName] = useState("Chưa chọn file PDF");
  const [loading, setLoading] = useState(false);
  const [scale, setScale] = useState(1.5);
  const [tool, setTool] = useState("edit");
  const [color, setColor] = useState("#000000");
  const [fillColor, setFillColor] = useState("#ffffff");
  const [fontSize, setFontSize] = useState(12);
  const [penWidth, setPenWidth] = useState(2);
  const [newBold, setNewBold] = useState(false);
  const [newItalic, setNewItalic] = useState(false);
  const [imageDraft, setImageDraft] = useState(null);
  const [fileOver, setFileOver] = useState(false);
  const [dropHint, setDropHint] = useState(null);

  const hasDoc = pages.length > 0;
  const curIndex = pages.findIndex((p) => p.id === current);
  const selSet = new Set(sel);
  const selIds = pages.filter((p) => selSet.has(p.id)).map((p) => p.id);
  const targetIds = selIds.length ? selIds : current ? [current] : [];

  /* ---------- lịch sử ---------- */
  const apply = (fn) =>
    setHist((h) => {
      const next = fn(h.present);
      if (next === h.present) return h;
      return {
        past: [...h.past.slice(-99), h.present],
        present: next,
        future: [],
      };
    });
  const undo = () =>
    setHist((h) =>
      h.past.length
        ? {
            past: h.past.slice(0, -1),
            present: h.past[h.past.length - 1],
            future: [h.present, ...h.future],
          }
        : h,
    );
  const redo = () =>
    setHist((h) =>
      h.future.length
        ? {
            past: [...h.past, h.present],
            present: h.future[0],
            future: h.future.slice(1),
          }
        : h,
    );

  /* ---------- chỉnh sửa nội dung ---------- */
  const onAdd = (ed) => {
    apply((d) => ({ ...d, edits: [...d.edits, ed] }));
    if (ed.kind !== "item" && ed.kind !== "new") setSelected(ed.key);
  };
  const onUpdate = (ed) =>
    apply((d) => ({
      ...d,
      edits: d.edits.map((e) => (e.key === ed.key ? ed : e)),
    }));
  const onRemove = (key) => {
    apply((d) => ({ ...d, edits: d.edits.filter((e) => e.key !== key) }));
    setSelected((s) => (s === key ? null : s));
  };

  /* ---------- điều hướng ---------- */
  const scrollToPage = (id) => {
    lockUntil.current = Date.now() + 700;
    rootRef.current
      ?.querySelector(`.pe-page[data-pid="${id}"]`)
      ?.scrollIntoView({ block: "start", behavior: "smooth" });
  };
  const goto = (n) => {
    const p = pages[n - 1];
    if (!p) return;
    setCurrent(p.id);
    scrollToPage(p.id);
  };

  // cuộn trang chính → cập nhật trang hiện tại
  const onScroll = () => {
    if (raf.current || Date.now() < lockUntil.current) return;
    raf.current = requestAnimationFrame(() => {
      raf.current = 0;
      const root = rootRef.current;
      if (!root) return;
      const mid = root.getBoundingClientRect().top + root.clientHeight / 2;
      let best = null;
      let bd = Infinity;
      root.querySelectorAll(".pe-page").forEach((el) => {
        const r = el.getBoundingClientRect();
        const d =
          mid < r.top ? r.top - mid : mid > r.bottom ? mid - r.bottom : 0;
        if (d < bd) {
          bd = d;
          best = el.dataset.pid;
        }
      });
      if (best) setCurrent(best);
    });
  };

  // thanh bên tự cuộn tới thumbnail của trang hiện tại
  useEffect(() => {
    if (!current) return;
    document
      .querySelector(`.pe-thumb[data-tid="${current}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [current]);

  /* ---------- nạp file (PDF / ảnh) tại một vị trí ---------- */
  const insertFiles = async (files, index, fresh = false) => {
    const list = files.filter((f) => isPdf(f) || isImg(f));
    if (!list.length) return msg.error("Chỉ hỗ trợ file PDF hoặc ảnh!");
    try {
      setLoading(true);
      const newPages = [];
      const newEdits = [];
      const newSources = [];
      for (const f of list) {
        try {
          if (isPdf(f)) {
            const bytes = new Uint8Array(await f.arrayBuffer());
            const pdf = await pdfjsLib.getDocument({ data: bytes.slice() })
              .promise;
            const sid = uid();
            newSources.push([sid, { bytes, pdf }]);
            for (let i = 1; i <= pdf.numPages; i++)
              newPages.push({ id: uid(), src: sid, idx: i, rot: 0 });
          } else {
            const { page, edit } = await imageToPage(f);
            newPages.push(page);
            newEdits.push(edit);
          }
        } catch (err) {
          console.error(err);
          msg.error(`Không đọc được: ${f.name}`);
        }
      }
      if (!newPages.length) return;

      setSources((m) => {
        const n = fresh ? new Map() : new Map(m);
        newSources.forEach(([k, v]) => n.set(k, v));
        return n;
      });
      if (fresh) {
        setHist({
          past: [],
          present: { pages: newPages, edits: newEdits },
          future: [],
        });
        setOcr({});
        setFileName((list.find(isPdf) || list[0]).name);
      } else {
        apply((d) => {
          const at = Math.max(0, Math.min(index, d.pages.length));
          return {
            pages: [...d.pages.slice(0, at), ...newPages, ...d.pages.slice(at)],
            edits: [...d.edits, ...newEdits],
          };
        });
      }
      setSelected(null);
      setCurrent(newPages[0].id);
      setSel(newPages.map((p) => p.id));
      msg.success(`Đã thêm ${newPages.length} trang`);
      setTimeout(() => scrollToPage(newPages[0].id), 80);
    } finally {
      setLoading(false);
    }
  };

  const openFiles = (files) => insertFiles(files, 0, true);

  /* ---------- thao tác trang ---------- */
  const pageSize = async (entry) => {
    let w;
    let h;
    if (entry.blank) {
      w = entry.w;
      h = entry.h;
    } else {
      const p = await sources.get(entry.src).pdf.getPage(entry.idx);
      const vp = p.getViewport({ scale: 1 });
      w = vp.width;
      h = vp.height;
    }
    if ((entry.rot || 0) % 180) [w, h] = [h, w];
    return [Math.round(w * 100) / 100, Math.round(h * 100) / 100];
  };

  const insertBlank = async (refId, preset, pos) => {
    const ref = pages.find((p) => p.id === refId) || pages[0];
    if (!ref) return;
    const [w, h] = preset === "same" ? await pageSize(ref) : PRESET[preset];
    const blank = { id: uid(), blank: true, w, h, rot: 0 };
    apply((d) => {
      const i = d.pages.findIndex((p) => p.id === ref.id);
      const at = i + (pos === "after" ? 1 : 0);
      return {
        ...d,
        pages: [...d.pages.slice(0, at), blank, ...d.pages.slice(at)],
      };
    });
    setCurrent(blank.id);
    setSel([blank.id]);
    setTimeout(() => scrollToPage(blank.id), 80);
  };

  // key dạng "blank:same:before" | "pdf:after" | "img:before"
  const handleInsert = (refId, key) => {
    const [kind, a, b] = key.split(":");
    if (kind === "blank") return insertBlank(refId, a, b);
    const i = pages.findIndex((p) => p.id === refId);
    pendingRef.current = { index: i + (a === "after" ? 1 : 0) };
    (kind === "pdf" ? pdfInputRef : imgInputRef).current?.click();
  };

  const rotatePages = (ids) => {
    const set = new Set(ids);
    apply((d) => ({
      ...d,
      pages: d.pages.map((p) =>
        set.has(p.id) ? { ...p, rot: ((p.rot || 0) + 90) % 360 } : p,
      ),
    }));
  };

  const duplicatePages = (ids) => {
    const set = new Set(ids);
    apply((d) => {
      const out = [];
      const more = [];
      d.pages.forEach((p) => {
        out.push(p);
        if (!set.has(p.id)) return;
        const cp = { ...p, id: uid() };
        out.push(cp);
        d.edits
          .filter((e) => e.pageId === p.id)
          .forEach((e) => more.push({ ...e, key: uid(), pageId: cp.id }));
      });
      return { pages: out, edits: [...d.edits, ...more] };
    });
  };

  const deletePages = (ids) => {
    const set = new Set(ids);
    if (!set.size) return;
    if (set.size >= pages.length)
      return msg.warning("Phải giữ lại ít nhất 1 trang");
    const first = pages.findIndex((p) => set.has(p.id));
    const rest = pages.filter((p) => !set.has(p.id));
    const next = rest[Math.min(first, rest.length - 1)];
    apply((d) => ({
      pages: d.pages.filter((p) => !set.has(p.id)),
      edits: d.edits.filter((e) => !set.has(e.pageId)),
    }));
    setCurrent(next.id);
    setSel([]);
    setSelected(null);
  };

  const reversePages = () =>
    apply((d) => ({ ...d, pages: [...d.pages].reverse() }));

  const movePages = (ids, targetId, after) =>
    apply((d) => {
      const set = new Set(ids);
      if (set.has(targetId)) return d;
      const moving = d.pages.filter((p) => set.has(p.id));
      const rest = d.pages.filter((p) => !set.has(p.id));
      let at = rest.findIndex((p) => p.id === targetId);
      if (at < 0) return d;
      if (after) at++;
      return {
        ...d,
        pages: [...rest.slice(0, at), ...moving, ...rest.slice(at)],
      };
    });

  const selectBy = (fn) =>
    setSel(pages.filter((p, i) => fn(p, i)).map((p) => p.id));

  const clickThumb = (id, ev) => {
    if (ev.shiftKey && anchorRef.current) {
      const a = pages.findIndex((p) => p.id === anchorRef.current);
      const b = pages.findIndex((p) => p.id === id);
      const [lo, hi] = a < b ? [a, b] : [b, a];
      setSel(pages.slice(lo, hi + 1).map((p) => p.id));
      return setCurrent(id);
    }
    if (ev.ctrlKey || ev.metaKey) {
      anchorRef.current = id;
      return setSel((s) =>
        s.includes(id) ? s.filter((x) => x !== id) : [...s, id],
      );
    }
    anchorRef.current = id;
    setSel([id]);
    setCurrent(id);
    scrollToPage(id);
  };

  const toggleThumb = (id) => {
    anchorRef.current = id;
    setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  };

  /* ---------- kéo thả ---------- */
  const hasType = (e, t) => Array.from(e.dataTransfer?.types || []).includes(t);

  const hitPage = (e) => {
    const el = e.target.closest?.("[data-tid],[data-pid]");
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {
      id: el.dataset.tid || el.dataset.pid,
      after: e.clientY > r.top + r.height / 2,
      thumb: !!el.dataset.tid,
    };
  };

  const onThumbDragStart = (e, id) => {
    const ids = selSet.has(id) ? selIds : [id];
    if (!selSet.has(id)) setSel([id]);
    e.dataTransfer.setData(PAGE_MIME, JSON.stringify(ids));
    e.dataTransfer.effectAllowed = "move";
  };

  const rootDragEnter = (e) => {
    if (!hasType(e, "Files")) return;
    dragCount.current++;
    setFileOver(true);
  };
  const rootDragLeave = (e) => {
    if (!hasType(e, "Files")) return;
    dragCount.current = Math.max(0, dragCount.current - 1);
    if (!dragCount.current) {
      setFileOver(false);
      setDropHint(null);
    }
  };
  const rootDragOver = (e) => {
    const files = hasType(e, "Files");
    if (!files && !hasType(e, PAGE_MIME)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = files ? "copy" : "move";
    const h = hitPage(e);
    if (h?.thumb)
      setDropHint((p) =>
        p && p.id === h.id && p.after === h.after
          ? p
          : { id: h.id, after: h.after },
      );
    else setDropHint((p) => (p ? null : p));
  };
  const rootDrop = (e) => {
    const files = hasType(e, "Files");
    if (!files && !hasType(e, PAGE_MIME)) return;
    e.preventDefault();
    dragCount.current = 0;
    setFileOver(false);
    setDropHint(null);
    const h = hitPage(e);

    if (files) {
      const list = Array.from(e.dataTransfer.files);
      if (!hasDoc) return openFiles(list);
      let index = pages.length;
      if (h) {
        const i = pages.findIndex((p) => p.id === h.id);
        if (i >= 0) index = i + (h.after ? 1 : 0);
      }
      return insertFiles(list, index);
    }
    try {
      const ids = JSON.parse(e.dataTransfer.getData(PAGE_MIME));
      if (h?.thumb) movePages(ids, h.id, h.after);
    } catch {
      /* bỏ qua */
    }
  };

  /* ---------- phím tắt ---------- */
  keyRef.current = (ev) => {
    if (ev.target.closest?.("input,textarea")) return;
    const mod = ev.ctrlKey || ev.metaKey;
    const k = ev.key.toLowerCase();
    if (mod && k === "z") {
      ev.preventDefault();
      return ev.shiftKey ? redo() : undo();
    }
    if (mod && k === "y") {
      ev.preventDefault();
      return redo();
    }
    if (ev.key === "Delete" || ev.key === "Backspace") {
      if (selected) return onRemove(selected);
      if (ev.key === "Delete" && selIds.length) deletePages(selIds);
    }
  };
  useEffect(() => {
    const h = (ev) => keyRef.current(ev);
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  // giải phóng tesseract worker khi thoát
  useEffect(
    () => () => {
      workerRef.current?.terminate?.();
    },
    [],
  );

  /* ---------- chèn ảnh (con dấu lên trang) ---------- */
  const pickImage = async (file) => {
    try {
      setImageDraft(await imageToPng(file));
      setTool("image");
      msg.info("Bấm vào trang để đặt ảnh");
    } catch (err) {
      console.error(err);
      msg.error("Không đọc được ảnh này!");
    }
    return false;
  };

  /* ---------- OCR cho file scan ---------- */
  const runOcr = async (ids) => {
    const map = new Map();
    pages.forEach((p) => {
      const k = `${p.src}:${p.idx}`;
      if (ids.includes(p.id) && !p.blank && !ocr[k]) map.set(k, p);
    });
    const todo = [...map.entries()];
    if (!todo.length)
      return msg.info(
        "Các trang này đã nhận dạng rồi (hoặc là trang trắng / ảnh chèn)",
      );

    const say = (content, type = "loading", duration = 0) =>
      msg.open({ key: "ocr", type, content, duration });

    try {
      say("Đang tải bộ nhận dạng tiếng Việt (lần đầu hơi lâu)...");
      if (!workerRef.current) workerRef.current = await createWorker("vie");
      const worker = workerRef.current;

      for (let n = 0; n < todo.length; n++) {
        const [key, entry] = todo[n];
        say(`Đang nhận dạng trang ${n + 1}/${todo.length}...`);

        const page = await sources.get(entry.src).pdf.getPage(entry.idx);
        const S = 2.5; // tỉ lệ render để OCR chính xác hơn
        const vp = page.getViewport({ scale: S });
        const cv = document.createElement("canvas");
        cv.width = vp.width;
        cv.height = vp.height;
        await page.render({
          canvas: cv,
          canvasContext: cv.getContext("2d"),
          viewport: vp,
        }).promise;

        const { data } = await worker.recognize(cv, {}, { blocks: true });
        const lines =
          data.lines ||
          (data.blocks || []).flatMap((b) =>
            (b.paragraphs || []).flatMap((pa) => pa.lines || []),
          );

        const items = [];
        lines.forEach((l, i) => {
          const text = (l.text || "").trim();
          const { x0, y0, x1, y1 } = l.bbox;
          const h = y1 - y0;
          if (!text || h < 6 || l.confidence < 30) return;
          const [px, py] = vp.convertToPdfPoint(x0, y1 - h * 0.17); // đường cơ sở
          const [qx] = vp.convertToPdfPoint(x1, y1);
          items.push({
            key: `ocr${i}`,
            str: text,
            x: px,
            y: py,
            w: Math.abs(qx - px),
            fs: (h * 0.85) / S,
            fontName: "",
            ff: "",
          });
        });
        setOcr((m) => ({ ...m, [key]: items }));
      }
      say('Nhận dạng xong! Chọn "Sửa chữ" rồi bấm vào dòng chữ.', "success", 3);
      setTool("edit");
    } catch (err) {
      console.error(err);
      say("OCR thất bại (kiểm tra mạng để tải dữ liệu tiếng Việt)", "error", 4);
    }
  };

  /* ---------- xuất ---------- */
  const doExport = async (ids) => {
    try {
      setLoading(true);
      const set = ids ? new Set(ids) : null;
      const pg = set ? pages.filter((p) => set.has(p.id)) : pages;
      const ed = set ? edits.filter((e) => set.has(e.pageId)) : edits;
      const { bytes, rasterized } = await exportPdf({
        sources,
        pages: pg,
        edits: ed,
      });
      const url = URL.createObjectURL(
        new Blob([bytes], { type: "application/pdf" }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download =
        fileName.replace(/\.pdf$/i, "") +
        (set ? `-trich-${pg.length}-trang` : "-edited") +
        ".pdf";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      if (rasterized)
        msg.warning(
          `${rasterized} đoạn chữ tiếng Việt được vẽ thành ảnh (thiếu font .ttf trong public/fonts)`,
        );
      else msg.success("Đã xuất PDF!");
    } catch (err) {
      console.error(err);
      msg.error("Xuất PDF thất bại!");
    } finally {
      setLoading(false);
    }
  };

  /* ---------- input file ẩn ---------- */
  const onPickInsert = (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    if (files.length) insertFiles(files, pendingRef.current.index);
  };
  const onPickOpen = (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    if (!files.length) return;
    if (
      hasDoc &&
      !window.confirm("Mở file mới sẽ bỏ tài liệu hiện tại. Tiếp tục?")
    )
      return;
    openFiles(files);
  };
  const askInsertAt = (kind, index) => {
    pendingRef.current = { index };
    (kind === "pdf" ? pdfInputRef : imgInputRef).current?.click();
  };

  const toolBtn = (key, icon, label, tip) => (
    <Tooltip title={tip}>
      <Button
        type={tool === key ? "primary" : "text"}
        icon={icon}
        onClick={() => {
          setTool(key);
          if (key !== "select") setSelected(null);
        }}
      >
        {label}
      </Button>
    </Tooltip>
  );

  const selectMenu = {
    items: [
      { key: "all", label: "Chọn tất cả" },
      { key: "none", label: "Bỏ chọn" },
      { key: "odd", label: "Trang lẻ (1, 3, 5…)" },
      { key: "even", label: "Trang chẵn (2, 4, 6…)" },
      { key: "inv", label: "Đảo vùng chọn" },
    ],
    onClick: ({ key }) => {
      if (key === "all") selectBy(() => true);
      else if (key === "none") setSel([]);
      else if (key === "odd") selectBy((_, i) => i % 2 === 0);
      else if (key === "even") selectBy((_, i) => i % 2 === 1);
      else selectBy((p) => !selSet.has(p.id));
    },
  };

  const ocrMenu = {
    items: [
      { key: "cur", label: "Trang hiện tại" },
      { key: "sel", label: "Các trang đã chọn" },
      { key: "all", label: "Toàn bộ tài liệu" },
    ],
    onClick: ({ key }) =>
      runOcr(
        key === "all"
          ? pages.map((p) => p.id)
          : key === "sel" && selIds.length
            ? selIds
            : current
              ? [current]
              : [],
      ),
  };

  return (
    <ConfigProvider theme={{ algorithm: theme.darkAlgorithm }}>
      {ctx}
      <input
        ref={pdfInputRef}
        type="file"
        hidden
        multiple
        accept="application/pdf"
        onChange={onPickInsert}
      />
      <input
        ref={imgInputRef}
        type="file"
        hidden
        multiple
        accept="image/*"
        onChange={onPickInsert}
      />
      <input
        ref={openInputRef}
        type="file"
        hidden
        accept="application/pdf,image/*"
        onChange={onPickOpen}
      />

      <div
        className="pe-root"
        onDragEnter={rootDragEnter}
        onDragLeave={rootDragLeave}
        onDragOver={rootDragOver}
        onDrop={rootDrop}
      >
        <header className="pe-header">
          <div className="pe-brand">
            <div className="pe-logo">
              <FilePdfOutlined />
            </div>
            <div>
              <h1>PDF Editor Pro</h1>
              <span>{fileName}</span>
            </div>
          </div>

          {hasDoc && (
            <div className="pe-group">
              {toolBtn(
                "edit",
                <EditOutlined />,
                "Sửa chữ",
                "Bấm vào chữ có sẵn để sửa",
              )}
              {toolBtn(
                "add",
                <FontSizeOutlined />,
                "Thêm chữ",
                "Bấm vào trang để thêm chữ mới",
              )}
              {toolBtn("rect", <BorderOutlined />, "Che", "Kéo để vẽ ô che")}
              {toolBtn(
                "hl",
                <HighlightOutlined />,
                "Tô sáng",
                "Kéo để tô sáng",
              )}
              {toolBtn("ink", <GatewayOutlined />, "Vẽ", "Vẽ tay")}
              <Upload
                beforeUpload={pickImage}
                showUploadList={false}
                accept="image/*"
              >
                <Button
                  type={tool === "image" ? "primary" : "text"}
                  icon={<PictureOutlined />}
                >
                  Ảnh
                </Button>
              </Upload>
              {toolBtn(
                "select",
                <SelectOutlined />,
                "Chọn",
                "Chọn / kéo / đổi cỡ đối tượng",
              )}
              <span className="pe-sep" />
              <Tooltip title="Màu chữ / nét vẽ">
                <ColorPicker
                  value={color}
                  onChange={(c) => setColor(c.toHexString())}
                  size="small"
                />
              </Tooltip>
              <Tooltip title="Màu ô che">
                <ColorPicker
                  value={fillColor}
                  onChange={(c) => setFillColor(c.toHexString())}
                  size="small"
                />
              </Tooltip>
              <Tooltip title="Cỡ chữ">
                <InputNumber
                  min={6}
                  max={96}
                  value={fontSize}
                  onChange={(v) => setFontSize(v || 12)}
                  size="small"
                  style={{ width: 64 }}
                />
              </Tooltip>
              <Tooltip title="Độ dày nét vẽ">
                <InputNumber
                  min={1}
                  max={20}
                  value={penWidth}
                  onChange={(v) => setPenWidth(v || 2)}
                  size="small"
                  style={{ width: 56 }}
                />
              </Tooltip>
              <Tooltip title="Đậm (cho chữ thêm mới)">
                <Button
                  type={newBold ? "primary" : "text"}
                  icon={<BoldOutlined />}
                  onClick={() => setNewBold((v) => !v)}
                />
              </Tooltip>
              <Tooltip title="Nghiêng (cho chữ thêm mới)">
                <Button
                  type={newItalic ? "primary" : "text"}
                  icon={<ItalicOutlined />}
                  onClick={() => setNewItalic((v) => !v)}
                />
              </Tooltip>
              <span className="pe-sep" />
              <Button
                type="text"
                icon={<ZoomOutOutlined />}
                disabled={scale <= 0.5}
                onClick={() => setScale((s) => s - 0.25)}
              />
              <span className="pe-zoom">{Math.round(scale * 100)}%</span>
              <Button
                type="text"
                icon={<ZoomInOutlined />}
                disabled={scale >= 3}
                onClick={() => setScale((s) => s + 0.25)}
              />
              <span className="pe-sep" />
              <Tooltip title="Hoàn tác (Ctrl+Z)">
                <Button
                  type="text"
                  icon={<UndoOutlined />}
                  disabled={!hist.past.length}
                  onClick={undo}
                />
              </Tooltip>
              <Tooltip title="Làm lại (Ctrl+Y)">
                <Button
                  type="text"
                  icon={<RedoOutlined />}
                  disabled={!hist.future.length}
                  onClick={redo}
                />
              </Tooltip>
            </div>
          )}

          <div className="pe-actions">
            {hasDoc && (
              <>
                <span className="pe-count">{edits.length} chỉnh sửa</span>
                <span className="pe-pagenav">
                  <InputNumber
                    size="small"
                    min={1}
                    max={pages.length}
                    value={curIndex + 1 || 1}
                    onChange={(v) => v && goto(v)}
                    style={{ width: 56 }}
                  />
                  <span>/ {pages.length}</span>
                </span>
                <Dropdown menu={ocrMenu}>
                  <Tooltip title="Nhận dạng chữ trên ảnh scan để sửa được">
                    <Button icon={<ScanOutlined />}>OCR</Button>
                  </Tooltip>
                </Dropdown>
                <Button
                  icon={<FileAddOutlined />}
                  onClick={() => askInsertAt("pdf", pages.length)}
                >
                  Ghép PDF
                </Button>
              </>
            )}
            <Button
              icon={<UploadOutlined />}
              onClick={() => openInputRef.current?.click()}
            >
              Mở PDF
            </Button>
            <Button
              type="primary"
              danger
              disabled={!hasDoc}
              icon={<DownloadOutlined />}
              onClick={() => doExport(null)}
            >
              Tải PDF về
            </Button>
          </div>
        </header>

        <div className="pe-body">
          {hasDoc && (
            <aside className="pe-side">
              <div className="pe-side-head">
                <div className="pe-side-info">
                  {pages.length} trang
                  {selIds.length ? ` · chọn ${selIds.length}` : ""}
                </div>
                <div className="pe-side-btns">
                  <Dropdown menu={selectMenu} trigger={["click"]}>
                    <Tooltip title="Chọn trang">
                      <Button
                        size="small"
                        type="text"
                        icon={<CheckSquareOutlined />}
                      />
                    </Tooltip>
                  </Dropdown>
                  <Dropdown
                    trigger={["click"]}
                    menu={{
                      items: INSERT_ITEMS,
                      onClick: ({ key }) =>
                        handleInsert(current || pages[0].id, key),
                    }}
                  >
                    <Tooltip title="Chèn quanh trang hiện tại">
                      <Button
                        size="small"
                        type="text"
                        icon={<PlusOutlined />}
                      />
                    </Tooltip>
                  </Dropdown>
                  <Tooltip title="Xoay trang đã chọn">
                    <Button
                      size="small"
                      type="text"
                      icon={<RotateRightOutlined />}
                      onClick={() => rotatePages(targetIds)}
                    />
                  </Tooltip>
                  <Tooltip title="Nhân bản trang đã chọn">
                    <Button
                      size="small"
                      type="text"
                      icon={<CopyOutlined />}
                      onClick={() => duplicatePages(targetIds)}
                    />
                  </Tooltip>
                  <Tooltip title="Xuất riêng trang đã chọn ra PDF mới">
                    <Button
                      size="small"
                      type="text"
                      icon={<ExportOutlined />}
                      onClick={() => doExport(targetIds)}
                    />
                  </Tooltip>
                  <Tooltip title="Đảo thứ tự toàn bộ trang">
                    <Button
                      size="small"
                      type="text"
                      icon={<SwapOutlined />}
                      onClick={reversePages}
                    />
                  </Tooltip>
                  <Tooltip title="Xóa trang đã chọn (Delete)">
                    <Button
                      size="small"
                      type="text"
                      danger
                      icon={<DeleteOutlined />}
                      onClick={() => deletePages(targetIds)}
                    />
                  </Tooltip>
                </div>
              </div>

              <div className="pe-side-list">
                {pages.map((p, i) => (
                  <PageThumb
                    key={p.id}
                    entry={p}
                    source={p.blank ? null : sources.get(p.src)}
                    index={i}
                    checked={selSet.has(p.id)}
                    current={current === p.id}
                    hint={
                      dropHint && dropHint.id === p.id
                        ? dropHint.after
                          ? "after"
                          : "before"
                        : null
                    }
                    insertItems={INSERT_ITEMS}
                    onClick={(ev) => clickThumb(p.id, ev)}
                    onToggle={() => toggleThumb(p.id)}
                    onDragStart={(ev) => onThumbDragStart(ev, p.id)}
                    onDragEnd={() => setDropHint(null)}
                    onRotate={() => rotatePages([p.id])}
                    onDuplicate={() => duplicatePages([p.id])}
                    onDelete={() => deletePages([p.id])}
                    onInsert={(key) => handleInsert(p.id, key)}
                  />
                ))}
              </div>
            </aside>
          )}

          <main className="pe-main" ref={rootRef} onScroll={onScroll}>
            <Spin spinning={loading} tip="Đang xử lý...">
              {!hasDoc ? (
                <div className="pe-empty">
                  <FilePdfOutlined />
                  <h2>Chưa chọn file PDF</h2>
                  <p>
                    Kéo thả file PDF (hoặc ảnh) vào đây, hoặc bấm nút bên dưới.
                  </p>
                  <Button
                    type="primary"
                    danger
                    size="large"
                    icon={<UploadOutlined />}
                    onClick={() => openInputRef.current?.click()}
                  >
                    Tải file PDF
                  </Button>
                </div>
              ) : (
                <div className="pe-pages">
                  {pages.map((p) => (
                    <PageView
                      key={p.id}
                      entry={p}
                      source={p.blank ? null : sources.get(p.src)}
                      scale={scale}
                      tool={tool}
                      edits={edits.filter((e) => e.pageId === p.id)}
                      selected={selected}
                      current={current === p.id}
                      rootRef={rootRef}
                      color={color}
                      fillColor={fillColor}
                      fontSize={fontSize}
                      penWidth={penWidth}
                      newBold={newBold}
                      newItalic={newItalic}
                      imageDraft={imageDraft}
                      ocrItems={p.blank ? null : ocr[`${p.src}:${p.idx}`]}
                      onActivate={() => setCurrent(p.id)}
                      onSelect={setSelected}
                      onAdd={onAdd}
                      onUpdate={onUpdate}
                      onRemove={onRemove}
                    />
                  ))}
                </div>
              )}
            </Spin>
          </main>
        </div>

        {fileOver && (
          <div className="pe-dropzone">
            <div>
              <FileAddOutlined />
              <h2>Thả file vào đây</h2>
              <p>
                {hasDoc
                  ? "Thả lên một trang để chèn vào vị trí đó, thả chỗ khác để ghép vào cuối"
                  : "PDF hoặc ảnh"}
              </p>
            </div>
          </div>
        )}
      </div>
    </ConfigProvider>
  );
}

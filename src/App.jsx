import { useState, useRef, useEffect } from "react";
import {
  Button,
  Upload,
  Tooltip,
  ColorPicker,
  InputNumber,
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
  PlusOutlined,
} from "@ant-design/icons";
import * as pdfjsLib from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import "./App.css";
import PageView from "./PageView";
import { exportPdf } from "./ExportPdf";
import { uid } from "./Utils";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

// Chuyển mọi ảnh về PNG (exportPdf chỉ embedPng)
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
        const bytes = new Uint8Array(await blob.arrayBuffer());
        resolve({
          bytes,
          url: URL.createObjectURL(blob),
          mime: "image/png",
          aspect: img.naturalHeight / img.naturalWidth,
        });
      }, "image/png");
    };
    img.onerror = reject;
    img.src = url;
  });

export default function App() {
  const [msg, ctx] = message.useMessage();
  const rootRef = useRef(null);

  const [sources, setSources] = useState(() => new Map()); // id -> {bytes, pdf}
  const [pages, setPages] = useState([]); // [{id, src, idx, rot, blank?, w?, h?}]
  const [edits, setEdits] = useState([]);
  const [current, setCurrent] = useState(null);
  const [selected, setSelected] = useState(null);

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

  const hasDoc = pages.length > 0;

  /* ---------- mở / thêm PDF ---------- */
  const loadPdf = async (file, append) => {
    if (file.type !== "application/pdf") {
      msg.error("Vui lòng chọn file đúng định dạng PDF!");
      return false;
    }
    try {
      setLoading(true);
      const bytes = new Uint8Array(await file.arrayBuffer());
      const pdf = await pdfjsLib.getDocument({ data: bytes.slice() }).promise;
      const sid = uid();
      const newPages = Array.from({ length: pdf.numPages }, (_, i) => ({
        id: uid(),
        src: sid,
        idx: i + 1, // 1-based
        rot: 0,
      }));
      if (append) {
        setSources((m) => new Map(m).set(sid, { bytes, pdf }));
        setPages((p) => [...p, ...newPages]);
      } else {
        setSources(new Map([[sid, { bytes, pdf }]]));
        setPages(newPages);
        setEdits([]);
        setSelected(null);
        setFileName(file.name);
      }
      setCurrent(newPages[0]?.id ?? null);
      msg.success("Mở file PDF thành công!");
    } catch (err) {
      console.error(err);
      msg.error("Không thể đọc file PDF này!");
    } finally {
      setLoading(false);
    }
    return false; // chặn upload mặc định của antd
  };

  /* ---------- chỉnh sửa ---------- */
  const onAdd = (ed) => {
    setEdits((p) => [...p, ed]);
    if (ed.kind !== "item" && ed.kind !== "new") setSelected(ed.key);
  };
  const onUpdate = (ed) =>
    setEdits((p) => p.map((e) => (e.key === ed.key ? ed : e)));
  const onRemove = (key) => {
    setEdits((p) => p.filter((e) => e.key !== key));
    setSelected((s) => (s === key ? null : s));
  };

  // Phím Delete xóa đối tượng đang chọn
  useEffect(() => {
    const h = (ev) => {
      if (ev.key !== "Delete" && ev.key !== "Backspace") return;
      if (!selected) return;
      if (ev.target.closest?.("input,textarea")) return;
      onRemove(selected);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [selected]);

  /* ---------- thao tác trang ---------- */
  const curIndex = pages.findIndex((p) => p.id === current);

  const rotatePage = () =>
    setPages((ps) =>
      ps.map((p) =>
        p.id === current ? { ...p, rot: ((p.rot || 0) + 90) % 360 } : p,
      ),
    );

  const deletePage = () => {
    if (curIndex < 0) return;
    if (pages.length === 1) return msg.warning("Phải giữ lại ít nhất 1 trang");
    setEdits((e) => e.filter((x) => x.pageId !== current));
    const next = pages[curIndex + 1] || pages[curIndex - 1];
    setPages((ps) => ps.filter((p) => p.id !== current));
    setCurrent(next?.id ?? null);
  };

  const duplicatePage = () => {
    if (curIndex < 0) return;
    const src = pages[curIndex];
    const copy = { ...src, id: uid() };
    setPages((ps) => [
      ...ps.slice(0, curIndex + 1),
      copy,
      ...ps.slice(curIndex + 1),
    ]);
    // nhân bản cả các chỉnh sửa của trang
    setEdits((es) => [
      ...es,
      ...es
        .filter((e) => e.pageId === src.id && e.kind !== "image")
        .map((e) => ({ ...e, key: uid(), pageId: copy.id })),
      ...es
        .filter((e) => e.pageId === src.id && e.kind === "image")
        .map((e) => ({ ...e, key: uid(), pageId: copy.id })),
    ]);
  };

  const addBlank = () => {
    const ref = pages[curIndex] || pages[0];
    let w = 595;
    let h = 842;
    if (ref?.blank) {
      w = ref.w;
      h = ref.h;
    }
    const blank = { id: uid(), blank: true, w, h, rot: 0 };
    const at = curIndex < 0 ? pages.length : curIndex + 1;
    setPages((ps) => [...ps.slice(0, at), blank, ...ps.slice(at)]);
    setCurrent(blank.id);
  };

  /* ---------- chèn ảnh ---------- */
  const pickImage = async (file) => {
    try {
      const draft = await imageToPng(file);
      setImageDraft(draft);
      setTool("image");
      msg.info("Bấm vào trang để đặt ảnh");
    } catch (err) {
      console.error(err);
      msg.error("Không đọc được ảnh này!");
    }
    return false;
  };

  /* ---------- xuất PDF ---------- */
  const handleExport = async () => {
    try {
      setLoading(true);
      const { bytes, rasterized } = await exportPdf({ sources, pages, edits });
      const blob = new Blob([bytes], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName.replace(/\.pdf$/i, "") + "-edited.pdf";
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

  return (
    <ConfigProvider theme={{ algorithm: theme.darkAlgorithm }}>
      {ctx}
      <div className="pe-root">
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
              <Tooltip title="Xoay trang hiện tại">
                <Button
                  type="text"
                  icon={<RotateRightOutlined />}
                  onClick={rotatePage}
                />
              </Tooltip>
              <Tooltip title="Nhân bản trang">
                <Button
                  type="text"
                  icon={<CopyOutlined />}
                  onClick={duplicatePage}
                />
              </Tooltip>
              <Tooltip title="Thêm trang trắng">
                <Button
                  type="text"
                  icon={<PlusOutlined />}
                  onClick={addBlank}
                />
              </Tooltip>
              <Tooltip title="Xóa trang hiện tại">
                <Button
                  type="text"
                  icon={<DeleteOutlined />}
                  onClick={deletePage}
                />
              </Tooltip>
              <span className="pe-sep" />
              <Button
                type="text"
                icon={<ZoomOutOutlined />}
                disabled={scale <= 0.75}
                onClick={() => setScale((s) => s - 0.25)}
              />
              <span className="pe-zoom">{Math.round(scale * 100)}%</span>
              <Button
                type="text"
                icon={<ZoomInOutlined />}
                disabled={scale >= 3}
                onClick={() => setScale((s) => s + 0.25)}
              />
              <Button
                type="text"
                icon={<UndoOutlined />}
                disabled={!edits.length}
                onClick={() => setEdits((p) => p.slice(0, -1))}
              >
                Hoàn tác
              </Button>
            </div>
          )}

          <div className="pe-actions">
            {hasDoc && (
              <span className="pe-count">{edits.length} chỉnh sửa</span>
            )}
            {hasDoc && (
              <Upload
                beforeUpload={(f) => loadPdf(f, true)}
                showUploadList={false}
                accept="application/pdf"
              >
                <Button icon={<FileAddOutlined />}>Ghép PDF</Button>
              </Upload>
            )}
            <Upload
              beforeUpload={(f) => loadPdf(f, false)}
              showUploadList={false}
              accept="application/pdf"
            >
              <Button icon={<UploadOutlined />}>Mở PDF</Button>
            </Upload>
            <Button
              type="primary"
              danger
              disabled={!hasDoc}
              icon={<DownloadOutlined />}
              onClick={handleExport}
            >
              Tải PDF về
            </Button>
          </div>
        </header>

        <main className="pe-main" ref={rootRef}>
          <Spin spinning={loading} tip="Đang xử lý PDF...">
            {!hasDoc ? (
              <div className="pe-empty">
                <FilePdfOutlined />
                <h2>Chưa chọn file PDF</h2>
                <p>Mở file PDF từ máy tính để bắt đầu sửa chữ trực tiếp.</p>
                <Upload
                  beforeUpload={(f) => loadPdf(f, false)}
                  showUploadList={false}
                  accept="application/pdf"
                >
                  <Button
                    type="primary"
                    danger
                    size="large"
                    icon={<UploadOutlined />}
                  >
                    Tải file PDF
                  </Button>
                </Upload>
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
    </ConfigProvider>
  );
}

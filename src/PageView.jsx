/* eslint-disable react-hooks/refs */
import { useState, useRef, useEffect, useMemo } from "react";
import { Spin } from "antd";
import { CSS_FAMILY, fontStyleOf, toHex, uid, measureText } from "./Utils";

// Áp dữ liệu tạm khi đang kéo / đổi cỡ
const applyTmp = (e, t) => {
  if (!t) return e;
  if (e.kind === "ink") {
    return t.dx === undefined
      ? e
      : { ...e, pts: e.pts.map(([x, y]) => [x + t.dx, y + t.dy]) };
  }
  return { ...e, ...t };
};

function EditorInput({ style, initial, onDone }) {
  const ref = useRef(null);
  const done = useRef(false);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  const finish = (ok) => {
    if (done.current) return;
    done.current = true;
    onDone(ok, ref.current.value);
  };

  return (
    <input
      ref={ref}
      className="pe-input"
      style={style}
      defaultValue={initial}
      onKeyDown={(e) => {
        if (e.key === "Enter") finish(true);
        else if (e.key === "Escape") finish(false);
      }}
      onBlur={() => finish(true)}
    />
  );
}

export default function PageView({
  entry,
  source,
  scale,
  tool,
  edits,
  selected,
  current,
  rootRef,
  color,
  fillColor,
  fontSize,
  penWidth,
  newBold,
  newItalic,
  imageDraft,
  ocrItems,
  onActivate,
  onSelect,
  onAdd,
  onUpdate,
  onRemove,
}) {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const layerRef = useRef(null);
  const taskRef = useRef(null);

  const [page, setPage] = useState(null);
  const [items, setItems] = useState([]);
  const [visible, setVisible] = useState(false);
  const [rendered, setRendered] = useState(false);
  const [editing, setEditing] = useState(null); // { edit }
  const [draft, setDraft] = useState(null); // đang vẽ ô / nét
  const [drag, setDrag] = useState(null); // đang kéo / đổi cỡ
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const rot = entry.rot || 0;

  /* ---------- nạp trang ---------- */
  useEffect(() => {
    if (entry.blank || !source) return;
    let alive = true;
    source.pdf.getPage(entry.idx).then((p) => alive && setPage(p));
    return () => {
      alive = false;
    };
  }, [entry.blank, entry.idx, source]);

  const viewport = useMemo(() => {
    if (entry.blank) {
      const w = entry.w;
      const h = entry.h;
      return {
        width: w * scale,
        height: h * scale,
        convertToViewportPoint: (x, y) => [x * scale, (h - y) * scale],
        convertToPdfPoint: (px, py) => [px / scale, h - py / scale],
      };
    }
    return page ? page.getViewport({ scale }) : null;
  }, [entry.blank, entry.w, entry.h, page, scale]);

  /* ---------- chỉ vẽ khi trang gần vùng nhìn thấy ---------- */
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) setVisible(true);
      },
      { root: rootRef.current, rootMargin: "1200px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [rootRef]);

  /* ---------- lấy danh sách chữ ---------- */
  useEffect(() => {
    if (!visible || !page || entry.blank) return;
    let alive = true;
    (async () => {
      try {
        const tc = await page.getTextContent();
        if (!alive) return;
        setItems(
          tc.items
            .filter((it) => it.str && it.str.trim())
            .map((it, i) => {
              const t = it.transform;
              return {
                key: `${entry.id}:${i}`,
                str: it.str,
                x: t[4],
                y: t[5],
                w: it.width,
                fs: Math.hypot(t[0], t[1]),
                fontName: it.fontName,
                ff: tc.styles?.[it.fontName]?.fontFamily || "",
              };
            }),
        );
      } catch (err) {
        console.error(err);
      }
    })();
    return () => {
      alive = false;
    };
  }, [visible, page, entry.id, entry.blank]);

  // Gộp chữ gốc của PDF với chữ nhận dạng bằng OCR (file scan)
  const allItems = useMemo(
    () =>
      ocrItems?.length
        ? [
            ...items,
            ...ocrItems.map((it) => ({ ...it, key: `${entry.id}:${it.key}` })),
          ]
        : items,
    [items, ocrItems, entry.id],
  );

  // Nhận diện đậm / nghiêng sau khi font đã nạp
  const styledItems = useMemo(
    () =>
      rendered && page
        ? allItems.map((it) => ({ ...it, ...fontStyleOf(page, it) }))
        : allItems.map((it) => ({
            ...it,
            bold: false,
            italic: false,
            family: "sans",
          })),
    [allItems, rendered, page],
  );

  /* ---------- vẽ canvas ---------- */
  useEffect(() => {
    if (!visible || !page || !viewport || entry.blank) return;
    let alive = true;
    (async () => {
      const prev = taskRef.current;
      if (prev) {
        prev.cancel();
        await prev.promise.catch(() => {});
      }
      if (!alive) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width = viewport.width * dpr;
      canvas.height = viewport.height * dpr;
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      const task = page.render({
        canvas,
        canvasContext: ctx,
        viewport,
        transform: [dpr, 0, 0, dpr, 0, 0],
      });
      taskRef.current = task;
      await task.promise.catch(() => {});
      if (alive) setRendered(true);
    })();
    return () => {
      alive = false;
    };
  }, [visible, page, viewport, dpr, entry.blank]);

  if (!viewport) {
    return (
      <div
        ref={wrapRef}
        className="pe-page pe-loading"
        data-pid={entry.id}
        style={{ width: 600, height: 800 }}
      >
        <Spin />
      </div>
    );
  }

  const W = viewport.width;
  const H = viewport.height;
  const rotated = rot % 180 !== 0;

  /* ---------- tọa độ ---------- */
  const pos = (x, y) => viewport.convertToViewportPoint(x, y);
  const toPdf = (px, py) => viewport.convertToPdfPoint(px, py);

  const rectView = (x, y, w, h) => {
    const a = pos(x, y);
    const b = pos(x + w, y + h);
    return {
      left: Math.min(a[0], b[0]),
      top: Math.min(a[1], b[1]),
      width: Math.abs(a[0] - b[0]),
      height: Math.abs(a[1] - b[1]),
    };
  };

  const textBox = (e) => {
    const [px, py] = pos(e.x, e.y);
    return {
      left: px - 1,
      top: py - e.fs * scale * 0.92,
      width: Math.max(e.w * scale + 2, 10),
      height: e.fs * scale * 1.2,
    };
  };

  const inkBox = (e) => {
    const ps = e.pts.map(([x, y]) => pos(x, y));
    const xs = ps.map((p) => p[0]);
    const ys = ps.map((p) => p[1]);
    const pad = (e.width * scale) / 2;
    return {
      left: Math.min(...xs) - pad,
      top: Math.min(...ys) - pad,
      width: Math.max(...xs) - Math.min(...xs) + pad * 2,
      height: Math.max(...ys) - Math.min(...ys) + pad * 2,
    };
  };

  const boundsOf = (e) =>
    e.kind === "item" || e.kind === "new"
      ? textBox(e)
      : e.kind === "ink"
        ? inkBox(e)
        : rectView(e.x, e.y, e.w, e.h);

  // Toạ độ chuột → toạ độ cục bộ của trang (đã bù xoay trang)
  const toLocal = (ev) => {
    const r = layerRef.current.getBoundingClientRect();
    const th = (rot * Math.PI) / 180;
    const c = Math.round(Math.cos(th));
    const s = Math.round(Math.sin(th));
    const vx = ev.clientX - (r.left + r.width / 2);
    const vy = ev.clientY - (r.top + r.height / 2);
    return [vx * c + vy * s + W / 2, -vx * s + vy * c + H / 2];
  };

  const eff = (e) => (drag && drag.key === e.key ? applyTmp(e, drag.tmp) : e);

  const pathOf = (pts) =>
    pts
      .map(([x, y], i) => {
        const [px, py] = pos(x, y);
        return `${i ? "L" : "M"}${px.toFixed(1)} ${py.toFixed(1)}`;
      })
      .join(" ");

  /* ---------- lấy mẫu nền / màu chữ gốc ---------- */
  const sampleBg = (left, top, h) => {
    const c = canvasRef.current;
    if (!c) return [255, 255, 255];
    const ctx = c.getContext("2d");
    const cx = Math.max(0, Math.round((left - 3) * dpr));
    const cy = Math.max(0, Math.round((top + h / 2) * dpr));
    return Array.from(ctx.getImageData(cx, cy, 1, 1).data.slice(0, 3));
  };

  const sampleInk = (left, top, w, h, bg) => {
    const c = canvasRef.current;
    if (!c) return "#000000";
    const ctx = c.getContext("2d");
    const x0 = Math.max(0, Math.floor(left * dpr));
    const y0 = Math.max(0, Math.floor(top * dpr));
    const ww = Math.min(c.width - x0, Math.ceil(w * dpr));
    const hh = Math.min(c.height - y0, Math.ceil(h * dpr));
    if (ww <= 0 || hh <= 0) return "#000000";
    const d = ctx.getImageData(x0, y0, ww, hh).data;
    let best = 0;
    let col = [0, 0, 0];
    for (let i = 0; i < d.length; i += 4) {
      const dist =
        Math.abs(d[i] - bg[0]) +
        Math.abs(d[i + 1] - bg[1]) +
        Math.abs(d[i + 2] - bg[2]);
      if (dist > best) {
        best = dist;
        col = [d[i], d[i + 1], d[i + 2]];
      }
    }
    return best > 80 ? toHex(col) : "#000000";
  };

  /* ---------- sửa chữ ---------- */
  const openEdit = (e) => setEditing({ edit: e });

  const startEditItem = (it) => {
    if (tool !== "edit") return;
    const existing = edits.find((e) => e.key === it.key);
    if (existing) return openEdit(existing);
    const edit = {
      key: it.key,
      pageId: entry.id,
      kind: "item",
      x: it.x,
      y: it.y,
      w: it.w,
      fs: it.fs,
      orig: it.str,
      text: it.str,
      color,
      bg: null,
      bold: it.bold,
      italic: it.italic,
      family: it.family,
    };
    const b = textBox(edit);
    edit.bg = sampleBg(b.left, b.top, b.height);
    edit.color = sampleInk(b.left, b.top, b.width, b.height, edit.bg);
    edit.ink = edit.color;
    edit.bold0 = edit.bold;
    edit.italic0 = edit.italic;
    edit.color0 = edit.color;
    openEdit(edit);
  };

  const finishEdit = (ok, value) => {
    const { edit } = editing;
    setEditing(null);
    if (!ok) return;
    const exists = edits.some((e) => e.key === edit.key);

    if (edit.kind === "new") {
      if (!value.trim()) {
        if (exists) onRemove(edit.key);
        return;
      }
      const ne = { ...edit, text: value, w: measureText(value, edit) };
      return exists ? onUpdate(ne) : onAdd(ne);
    }

    const unchanged =
      value === edit.orig &&
      edit.bold === edit.bold0 &&
      edit.italic === edit.italic0 &&
      edit.color === edit.color0;
    if (unchanged) {
      if (exists) onRemove(edit.key);
    } else {
      const ne = { ...edit, text: value };
      exists ? onUpdate(ne) : onAdd(ne);
    }
  };

  /* ---------- kéo / đổi cỡ đối tượng ---------- */
  const startDrag = (ev, e, mode) => {
    ev.stopPropagation();
    onSelect(e.key);
    layerRef.current.setPointerCapture(ev.pointerId);
    setDrag({
      key: e.key,
      mode,
      start: toLocal(ev),
      base: e,
      tmp: null,
      moved: false,
    });
  };

  /* ---------- sự kiện chuột trên lớp phủ ---------- */
  const layerDown = (ev) => {
    if (ev.button !== 0 || editing) return;
    if (ev.target.closest?.(".pe-input,.pe-mini")) return;
    const [lx, ly] = toLocal(ev);

    if (tool === "add") {
      const [x, y] = toPdf(lx, ly + fontSize * scale * 0.8);
      openEdit({
        key: uid(),
        pageId: entry.id,
        kind: "new",
        x,
        y,
        w: 0,
        fs: fontSize,
        orig: "",
        text: "",
        color,
        ink: color,
        bg: null,
        bold: newBold,
        italic: newItalic,
        family: "sans",
      });
    } else if (tool === "rect" || tool === "hl") {
      layerRef.current.setPointerCapture(ev.pointerId);
      setDraft({ kind: tool, a: [lx, ly], b: [lx, ly] });
    } else if (tool === "ink") {
      layerRef.current.setPointerCapture(ev.pointerId);
      setDraft({ kind: "ink", pts: [[lx, ly]] });
    } else if (tool === "image" && imageDraft) {
      const [cx, cy] = toPdf(lx, ly);
      const w = Math.min(200, (W / scale) * 0.5);
      const h = w * imageDraft.aspect;
      onAdd({
        key: uid(),
        pageId: entry.id,
        kind: "image",
        x: cx - w / 2,
        y: cy - h / 2,
        w,
        h,
        url: imageDraft.url,
        bytes: imageDraft.bytes,
        mime: imageDraft.mime,
      });
    } else if (tool === "select") {
      onSelect(null);
    }
  };

  const layerMove = (ev) => {
    if (!draft && !drag) return;
    const [lx, ly] = toLocal(ev);

    if (draft) {
      if (draft.kind === "ink") {
        const last = draft.pts[draft.pts.length - 1];
        if (Math.hypot(lx - last[0], ly - last[1]) > 1.5) {
          setDraft({ ...draft, pts: [...draft.pts, [lx, ly]] });
        }
      } else {
        setDraft({ ...draft, b: [lx, ly] });
      }
      return;
    }

    const e = drag.base;
    let tmp;
    if (drag.mode === "move") {
      const a = toPdf(drag.start[0], drag.start[1]);
      const b = toPdf(lx, ly);
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      tmp = e.kind === "ink" ? { dx, dy } : { x: e.x + dx, y: e.y + dy };
    } else {
      const bnd = rectView(e.x, e.y, e.w, e.h);
      let cx = Math.max(lx, bnd.left + 12);
      let cy = Math.max(ly, bnd.top + 12);
      if (e.kind === "image") {
        cy = bnd.top + (cx - bnd.left) * (bnd.height / bnd.width);
      }
      const a = toPdf(bnd.left, bnd.top);
      const b = toPdf(cx, cy);
      tmp = {
        x: Math.min(a[0], b[0]),
        y: Math.min(a[1], b[1]),
        w: Math.abs(a[0] - b[0]),
        h: Math.abs(a[1] - b[1]),
      };
    }
    setDrag((d) => ({ ...d, tmp, moved: true }));
  };

  const layerUp = (ev) => {
    const lay = layerRef.current;
    if (lay?.hasPointerCapture?.(ev.pointerId))
      lay.releasePointerCapture(ev.pointerId);

    if (draft) {
      if (draft.kind === "ink") {
        if (draft.pts.length > 1) {
          onAdd({
            key: uid(),
            pageId: entry.id,
            kind: "ink",
            pts: draft.pts.map(([x, y]) => toPdf(x, y)),
            color,
            width: penWidth,
          });
        }
      } else {
        const [ax, ay] = draft.a;
        const [bx, by] = draft.b;
        if (Math.abs(bx - ax) > 4 && Math.abs(by - ay) > 4) {
          const a = toPdf(ax, ay);
          const b = toPdf(bx, by);
          const hl = draft.kind === "hl";
          onAdd({
            key: uid(),
            pageId: entry.id,
            kind: "rect",
            x: Math.min(a[0], b[0]),
            y: Math.min(a[1], b[1]),
            w: Math.abs(a[0] - b[0]),
            h: Math.abs(a[1] - b[1]),
            color: hl ? "#ffd400" : fillColor,
            opacity: hl ? 0.4 : 1,
            multiply: hl,
          });
        }
      }
      setDraft(null);
      return;
    }

    if (drag) {
      if (drag.moved) onUpdate(applyTmp(drag.base, drag.tmp));
      setDrag(null);
    }
  };

  /* ---------- hiển thị ---------- */
  const draftRect =
    draft && draft.kind !== "ink"
      ? {
          left: Math.min(draft.a[0], draft.b[0]),
          top: Math.min(draft.a[1], draft.b[1]),
          width: Math.abs(draft.b[0] - draft.a[0]),
          height: Math.abs(draft.b[1] - draft.a[1]),
        }
      : null;

  const selectedEdit =
    tool === "select" && selected
      ? edits.find((e) => e.key === selected)
      : null;

  return (
    <div
      ref={wrapRef}
      className={`pe-page${current ? " is-current" : ""}`}
      data-pid={entry.id}
      style={{ width: rotated ? H : W, height: rotated ? W : H }}
      onMouseDown={onActivate}
    >
      <div
        className="pe-rot"
        style={{
          width: W,
          height: H,
          transform: `translate(-50%, -50%) rotate(${rot}deg)`,
        }}
      >
        {!entry.blank && <canvas ref={canvasRef} />}

        <div
          ref={layerRef}
          className={`pe-layer tool-${tool}`}
          onPointerDown={layerDown}
          onPointerMove={layerMove}
          onPointerUp={layerUp}
          onPointerCancel={layerUp}
        >
          {/* vùng chữ gốc / chữ OCR bấm được */}
          {styledItems.map((it) => {
            const [px, py] = pos(it.x, it.y);
            return (
              <div
                key={it.key}
                className="pe-tx"
                style={{
                  left: px - 1,
                  top: py - it.fs * scale * 0.92,
                  width: it.w * scale + 2,
                  height: it.fs * scale * 1.2,
                }}
                onClick={() => startEditItem(it)}
              />
            );
          })}

          {/* ô che / tô sáng / ảnh */}
          {edits.map((raw) => {
            const e = eff(raw);
            if (e.kind === "rect") {
              return (
                <div
                  key={e.key}
                  className="pe-rect"
                  style={{
                    ...rectView(e.x, e.y, e.w, e.h),
                    background: e.color,
                    opacity: e.opacity,
                    mixBlendMode: e.multiply ? "multiply" : "normal",
                  }}
                  onPointerDown={(ev) =>
                    tool === "select" && startDrag(ev, raw, "move")
                  }
                />
              );
            }
            if (e.kind === "image") {
              return (
                <img
                  key={e.key}
                  className="pe-img"
                  src={e.url}
                  alt=""
                  draggable={false}
                  style={rectView(e.x, e.y, e.w, e.h)}
                  onPointerDown={(ev) =>
                    tool === "select" && startDrag(ev, raw, "move")
                  }
                />
              );
            }
            return null;
          })}

          {/* nét vẽ tay */}
          <svg className="pe-svg" width={W} height={H}>
            {edits
              .filter((e) => e.kind === "ink")
              .map((raw) => {
                const e = eff(raw);
                return (
                  <path
                    key={e.key}
                    className="pe-ink"
                    d={pathOf(e.pts)}
                    stroke={e.color}
                    strokeWidth={e.width * scale}
                    fill="none"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    onPointerDown={(ev) =>
                      tool === "select" && startDrag(ev, raw, "move")
                    }
                  />
                );
              })}
            {draft?.kind === "ink" && (
              <path
                d={draft.pts
                  .map(
                    ([x, y], i) =>
                      `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`,
                  )
                  .join(" ")}
                stroke={color}
                strokeWidth={penWidth * scale}
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )}
          </svg>

          {/* chữ đã sửa / chữ thêm mới */}
          {edits.map((raw) => {
            if (raw.kind !== "item" && raw.kind !== "new") return null;
            const e = eff(raw);
            const b = textBox(e);
            return (
              <div
                key={e.key}
                className={`pe-ed k-${e.kind}`}
                style={{
                  left: b.left,
                  top: b.top,
                  height: b.height,
                  minWidth: b.width,
                  background:
                    e.kind === "item" && e.bg
                      ? `rgb(${e.bg.join(",")})`
                      : "transparent",
                  color: e.color,
                  fontFamily: CSS_FAMILY[e.family || "sans"],
                  fontSize: e.fs * scale,
                  lineHeight: `${b.height}px`,
                  fontWeight: e.bold ? 700 : 400,
                  fontStyle: e.italic ? "italic" : "normal",
                }}
                onClick={() => tool === "edit" && openEdit(raw)}
                onDoubleClick={() => tool === "select" && openEdit(raw)}
                onPointerDown={(ev) =>
                  tool === "select" &&
                  e.kind === "new" &&
                  startDrag(ev, raw, "move")
                }
              >
                {e.text}
              </div>
            );
          })}

          {/* khung đang vẽ */}
          {draftRect && (
            <div
              className="pe-rect"
              style={{
                ...draftRect,
                background: draft.kind === "hl" ? "#ffd400" : fillColor,
                opacity: draft.kind === "hl" ? 0.4 : 0.85,
                outline: "1px dashed #1677ff",
              }}
            />
          )}

          {/* khung chọn + tay nắm đổi cỡ */}
          {selectedEdit &&
            (() => {
              const e = eff(selectedEdit);
              const b = boundsOf(e);
              const resizable = e.kind === "rect" || e.kind === "image";
              return (
                <div
                  className="pe-sel"
                  style={{
                    left: b.left - 2,
                    top: b.top - 2,
                    width: b.width + 4,
                    height: b.height + 4,
                  }}
                >
                  {resizable && (
                    <div
                      className="pe-handle"
                      onPointerDown={(ev) =>
                        startDrag(ev, selectedEdit, "resize")
                      }
                    />
                  )}
                </div>
              );
            })()}

          {/* ô nhập chữ + thanh B / I / màu */}
          {editing &&
            (() => {
              const ed = editing.edit;
              const b = textBox(ed);
              const patch = (p) =>
                setEditing((s) => ({ edit: { ...s.edit, ...p } }));
              const keep = (fn) => (ev) => {
                ev.preventDefault(); // giữ focus trong ô nhập
                fn();
              };
              return (
                <>
                  <div
                    className="pe-mini"
                    style={{ left: b.left - 2, top: Math.max(b.top - 40, 2) }}
                  >
                    <button
                      type="button"
                      className={ed.bold ? "on" : ""}
                      style={{ fontWeight: 700 }}
                      onMouseDown={keep(() => patch({ bold: !ed.bold }))}
                    >
                      B
                    </button>
                    <button
                      type="button"
                      className={ed.italic ? "on" : ""}
                      style={{ fontStyle: "italic" }}
                      onMouseDown={keep(() => patch({ italic: !ed.italic }))}
                    >
                      I
                    </button>
                    {[ed.ink || ed.color, "#000000", "#dc2626", "#1677ff"].map(
                      (c, i) => (
                        <button
                          key={i}
                          type="button"
                          className="sw"
                          title={i === 0 ? "Màu gốc" : c}
                          style={{
                            background: c,
                            outline: ed.color === c ? "2px solid #fff" : "none",
                          }}
                          onMouseDown={keep(() => patch({ color: c }))}
                        />
                      ),
                    )}
                  </div>
                  <EditorInput
                    initial={ed.text}
                    onDone={finishEdit}
                    style={{
                      left: b.left - 2,
                      top: b.top - 2,
                      height: b.height + 4,
                      width: Math.max(b.width + 40, 140),
                      fontSize: ed.fs * scale,
                      color: ed.color,
                      fontFamily: CSS_FAMILY[ed.family || "sans"],
                      fontWeight: ed.bold ? 700 : 400,
                      fontStyle: ed.italic ? "italic" : "normal",
                    }}
                  />
                </>
              );
            })()}
        </div>
      </div>
    </div>
  );
}

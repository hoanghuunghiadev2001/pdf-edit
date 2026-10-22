import { useState, useRef, useEffect } from "react";
import { Button, Checkbox, Dropdown, Tooltip } from "antd";
import {
  RotateRightOutlined,
  CopyOutlined,
  DeleteOutlined,
  PlusOutlined,
} from "@ant-design/icons";

const THUMB = 140;

export default function PageThumb({
  entry,
  source,
  index,
  checked,
  current,
  hint, // 'before' | 'after' | null
  insertItems,
  onClick,
  onToggle,
  onDragStart,
  onDragEnd,
  onRotate,
  onDuplicate,
  onDelete,
  onInsert,
}) {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const [visible, setVisible] = useState(false);
  const [box, setBox] = useState({ w: THUMB, h: Math.round(THUMB * 1.414) });
  const rot = entry.rot || 0;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => e.isIntersecting && setVisible(true),
      { rootMargin: "400px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // trang trắng: kích thước tính trực tiếp
  const blankBox = entry.blank
    ? rot % 180
      ? { w: THUMB, h: Math.round((THUMB * entry.w) / entry.h) }
      : { w: THUMB, h: Math.round((THUMB * entry.h) / entry.w) }
    : null;

  useEffect(() => {
    if (!visible || entry.blank || !source) return;
    let alive = true;
    let task = null;
    (async () => {
      const page = await source.pdf.getPage(entry.idx);
      if (!alive) return;
      const rotation = ((((page.rotate || 0) + rot) % 360) + 360) % 360;
      const base = page.getViewport({ scale: 1, rotation });
      const s = THUMB / base.width;
      const vp = page.getViewport({ scale: s, rotation });
      const c = canvasRef.current;
      if (!c) return;
      c.width = vp.width * dpr;
      c.height = vp.height * dpr;
      c.style.width = `${vp.width}px`;
      c.style.height = `${vp.height}px`;
      setBox({ w: Math.round(vp.width), h: Math.round(vp.height) });
      task = page.render({
        canvas: c,
        canvasContext: c.getContext("2d"),
        viewport: vp,
        transform: [dpr, 0, 0, dpr, 0, 0],
      });
      try {
        await task.promise;
      } catch {
        /* bị hủy */
      }
    })();
    return () => {
      alive = false;
      task?.cancel();
    };
  }, [visible, entry.idx, entry.blank, rot, source, dpr]);

  const b = blankBox || box;
  const stop = (fn) => (ev) => {
    ev.stopPropagation();
    fn();
  };

  return (
    <div
      ref={wrapRef}
      data-tid={entry.id}
      draggable
      className={`pe-thumb${current ? " is-current" : ""}${checked ? " is-checked" : ""}`}
      onClick={onClick}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    >
      {hint === "before" && <div className="pe-drop pe-drop-top" />}
      <div className="pe-thumb-box" style={{ width: b.w, height: b.h }}>
        {entry.blank ? (
          <div className="pe-thumb-blank" />
        ) : (
          <canvas ref={canvasRef} />
        )}

        <div className="pe-thumb-check" onClick={(e) => e.stopPropagation()}>
          <Checkbox checked={checked} onChange={onToggle} />
        </div>

        <div className="pe-thumb-tools" onClick={(e) => e.stopPropagation()}>
          <Tooltip title="Xoay">
            <Button
              size="small"
              type="text"
              icon={<RotateRightOutlined />}
              onClick={stop(onRotate)}
            />
          </Tooltip>
          <Tooltip title="Nhân bản">
            <Button
              size="small"
              type="text"
              icon={<CopyOutlined />}
              onClick={stop(onDuplicate)}
            />
          </Tooltip>
          <Dropdown
            trigger={["click"]}
            menu={{ items: insertItems, onClick: ({ key }) => onInsert(key) }}
          >
            <Tooltip title="Chèn vào đây">
              <Button size="small" type="text" icon={<PlusOutlined />} />
            </Tooltip>
          </Dropdown>
          <Tooltip title="Xóa trang">
            <Button
              size="small"
              type="text"
              danger
              icon={<DeleteOutlined />}
              onClick={stop(onDelete)}
            />
          </Tooltip>
        </div>
      </div>
      <div className="pe-thumb-num">{index + 1}</div>
      {hint === "after" && <div className="pe-drop pe-drop-bottom" />}
    </div>
  );
}

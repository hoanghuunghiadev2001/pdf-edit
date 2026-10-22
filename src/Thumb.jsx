import { useState, useRef, useEffect } from "react";

const TW = 96; // bề rộng thumbnail

function Thumb({
  entry,
  source,
  index,
  current,
  checked,
  dragging,
  drop,
  onClick,
  onToggle,
  dragProps,
}) {
  const canvasRef = useRef(null);
  const [ratio, setRatio] = useState(entry.blank ? entry.h / entry.w : 1.414);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  useEffect(() => {
    if (entry.blank || !source) return;
    let alive = true;
    let task = null;
    (async () => {
      const p = await source.pdf.getPage(entry.idx);
      const base = p.getViewport({ scale: 1 });
      const vp = p.getViewport({ scale: (TW / base.width) * dpr });
      if (!alive) return;
      setRatio(base.height / base.width);
      const c = canvasRef.current;
      if (!c) return;
      c.width = vp.width;
      c.height = vp.height;
      task = p.render({
        canvas: c,
        canvasContext: c.getContext("2d"),
        viewport: vp,
      });
      await task.promise.catch(() => {});
    })();
    return () => {
      alive = false;
      task?.cancel();
    };
  }, [entry.blank, entry.idx, source, dpr]);

  const th = TW * ratio;
  const rotated = entry.rot % 180 !== 0;

  return (
    <div
      className={`th${current ? " cur" : ""}${dragging ? " dragging" : ""}${
        drop ? ` drop-${drop}` : ""
      }`}
      draggable
      onClick={onClick}
      {...dragProps}
    >
      <label className="th-check" onClick={(e) => e.stopPropagation()}>
        <input type="checkbox" checked={checked} onChange={onToggle} />
      </label>
      <div
        className="th-box"
        style={{ width: rotated ? th : TW, height: rotated ? TW : th }}
      >
        <div
          className="th-rot"
          style={{
            width: TW,
            height: th,
            transform: `translate(-50%, -50%) rotate(${entry.rot}deg)`,
          }}
        >
          {!entry.blank && (
            <canvas ref={canvasRef} style={{ width: TW, height: th }} />
          )}
        </div>
      </div>
      <div className="th-num">{index + 1}</div>
    </div>
  );
}

export default function Thumbs({
  pages,
  sources,
  currentId,
  checked,
  onCurrent,
  onToggle,
  onMove,
}) {
  const [dragIds, setDragIds] = useState(null);
  const [over, setOver] = useState(null); // vị trí chèn (0..n)

  const end = () => {
    setDragIds(null);
    setOver(null);
  };

  return (
    <div className="th-list">
      {pages.map((p, i) => {
        let drop = null;
        if (dragIds && over === i) drop = "before";
        else if (dragIds && over === pages.length && i === pages.length - 1)
          drop = "after";

        return (
          <Thumb
            key={p.id}
            entry={p}
            source={sources.get(p.src)}
            index={i}
            current={p.id === currentId}
            checked={checked.has(p.id)}
            dragging={!!dragIds && dragIds.includes(p.id)}
            drop={drop}
            onClick={() => onCurrent(p.id)}
            onToggle={() => onToggle(p.id)}
            dragProps={{
              onDragStart: (e) => {
                const ids = checked.has(p.id)
                  ? pages.filter((x) => checked.has(x.id)).map((x) => x.id)
                  : [p.id];
                setDragIds(ids);
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", p.id);
              },
              onDragOver: (e) => {
                if (!dragIds) return;
                e.preventDefault();
                const r = e.currentTarget.getBoundingClientRect();
                setOver(e.clientY < r.top + r.height / 2 ? i : i + 1);
              },
              onDrop: (e) => {
                e.preventDefault();
                if (dragIds && over != null) onMove(dragIds, over);
                end();
              },
              onDragEnd: end,
            }}
          />
        );
      })}
    </div>
  );
}

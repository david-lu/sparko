import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { GripHorizontal, GripVertical } from "lucide-react";

export const PANEL_DIVIDER_SIZE = 8;

export function panelResizeBounds(
  total: number,
  minBefore: number,
  minAfter: number,
) {
  if (total <= minBefore + minAfter) {
    const fixed =
      minBefore + minAfter > 0
        ? (minBefore / (minBefore + minAfter)) * 100
        : 50;
    return { min: fixed, max: fixed };
  }
  return {
    min: (minBefore / total) * 100,
    max: 100 - (minAfter / total) * 100,
  };
}

type Props = {
  orientation: "horizontal" | "vertical";
  label: string;
  controls: string;
  value: number;
  minBefore: number;
  minAfter: number;
  getPanes: () => [HTMLElement | null, HTMLElement | null];
  onChange: (value: number) => void;
  onCommit: (value: number) => void;
  onCancel: () => void;
};

/** A single focusable resize target shared by every panel boundary. */
export function PanelDivider(props: Props) {
  const { orientation, label, controls, value, minBefore, minAfter } = props;
  const latest = useRef(props);
  latest.current = props;
  const element = useRef<HTMLDivElement>(null);
  const [total, setTotal] = useState(0);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{
    pointerId: number;
    start: number;
    before: number;
    total: number;
    value: number;
    min: number;
    max: number;
  } | null>(null);
  const bounds = panelResizeBounds(total, minBefore, minAfter);
  const measure = () => {
    const [before, after] = latest.current.getPanes();
    const dimension = orientation === "vertical" ? "width" : "height";
    return {
      before: before?.getBoundingClientRect()[dimension] ?? 0,
      after: after?.getBoundingClientRect()[dimension] ?? 0,
    };
  };

  useLayoutEffect(() => {
    const update = () => {
      const size = measure();
      setTotal(size.before + size.after);
    };
    const observer = new ResizeObserver(update);
    latest.current.getPanes().forEach((pane) => {
      if (pane) observer.observe(pane);
    });
    update();
    return () => observer.disconnect();
  }, [orientation]);

  useEffect(() => {
    if (!dragging) return;
    const previous = document.body.style.userSelect;
    document.body.style.userSelect = "none";
    document.body.dataset.panelResize = orientation;
    const cancelOnBlur = () => finish(false);
    window.addEventListener("blur", cancelOnBlur);
    return () => {
      window.removeEventListener("blur", cancelOnBlur);
      document.body.style.userSelect = previous;
      delete document.body.dataset.panelResize;
    };
  }, [dragging, orientation]);

  const finish = (commit: boolean) => {
    const session = drag.current;
    if (!session) return;
    drag.current = null;
    setDragging(false);
    if (element.current?.hasPointerCapture(session.pointerId))
      element.current.releasePointerCapture(session.pointerId);
    if (commit) latest.current.onCommit(session.value);
    else latest.current.onCancel();
  };

  return (
    <div
      ref={element}
      className={`panelDivider ${dragging ? "is-resizing" : ""}`}
      role="separator"
      tabIndex={0}
      aria-label={label}
      aria-controls={controls}
      aria-orientation={orientation}
      aria-valuenow={Math.round(value)}
      aria-valuemin={Math.floor(bounds.min)}
      aria-valuemax={Math.ceil(bounds.max)}
      title={`${label}: drag or use arrow keys to resize; double-click to balance`}
      onPointerDown={(event) => {
        if (event.button !== 0 || drag.current) return;
        const size = measure();
        const sum = size.before + size.after;
        if (sum <= 0) return;
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.focus();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = {
          pointerId: event.pointerId,
          start: orientation === "vertical" ? event.clientX : event.clientY,
          before: size.before,
          total: sum,
          value: (size.before / sum) * 100,
          ...panelResizeBounds(sum, minBefore, minAfter),
        };
        setDragging(true);
      }}
      onPointerMove={(event) => {
        const session = drag.current;
        if (!session || session.pointerId !== event.pointerId) return;
        const coordinate =
          orientation === "vertical" ? event.clientX : event.clientY;
        session.value = Math.max(
          session.min,
          Math.min(
            session.max,
            ((session.before + coordinate - session.start) / session.total) *
              100,
          ),
        );
        latest.current.onChange(session.value);
      }}
      onPointerUp={(event) => {
        if (drag.current?.pointerId === event.pointerId) finish(true);
      }}
      onPointerCancel={(event) => {
        if (drag.current?.pointerId === event.pointerId) finish(false);
      }}
      onLostPointerCapture={() => finish(false)}
      onDoubleClick={() =>
        latest.current.onCommit(Math.max(bounds.min, Math.min(bounds.max, 50)))
      }
      onKeyDown={(event) => {
        if (event.key === "Escape" && drag.current) {
          event.preventDefault();
          event.stopPropagation();
          finish(false);
          return;
        }
        if (drag.current) return;
        const decrement = orientation === "vertical" ? "ArrowLeft" : "ArrowUp";
        const increment =
          orientation === "vertical" ? "ArrowRight" : "ArrowDown";
        if (![decrement, increment, "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        event.stopPropagation();
        const size = measure();
        const sum = size.before + size.after;
        if (!sum) return;
        const limits = panelResizeBounds(sum, minBefore, minAfter);
        const step = ((event.shiftKey ? 40 : 10) / sum) * 100;
        const next =
          event.key === "Home"
            ? limits.min
            : event.key === "End"
              ? limits.max
              : (size.before / sum) * 100 +
                (event.key === decrement ? -step : step);
        latest.current.onCommit(
          Math.max(limits.min, Math.min(limits.max, next)),
        );
      }}
    >
      {orientation === "vertical" ? (
        <GripVertical className="resizeGrip" aria-hidden="true" />
      ) : (
        <GripHorizontal className="resizeGrip" aria-hidden="true" />
      )}
    </div>
  );
}

import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  PANEL_DIVIDER_SIZE,
  PanelDivider,
  panelResizeBounds,
} from "./PanelDivider";

type Props = {
  children: [ReactNode, ReactNode];
  direction: "row" | "column";
  label: string;
  className?: string;
  sizes: [number, number];
  minSizes: [number, number];
  onSizesChange: (sizes: [number, number]) => void;
  hideAfter?: boolean;
};

/** CSS owns pane layout; only a completed resize changes saved preferences. */
export function PanelSplit({
  children,
  direction,
  label,
  className = "",
  sizes,
  minSizes,
  onSizesChange,
  hideAfter = false,
}: Props) {
  const host = useRef<HTMLDivElement>(null);
  const before = useRef<HTMLDivElement>(null);
  const after = useRef<HTMLDivElement>(null);
  const beforeId = useId();
  const [extent, setExtent] = useState<number | null>(null);
  const [preview, setPreview] = useState<number | null>(null);
  useLayoutEffect(() => {
    const node = host.current;
    if (!node) return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect) setExtent(direction === "row" ? rect.width : rect.height);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [direction]);
  useLayoutEffect(() => setPreview(null), [hideAfter, sizes]);
  const bounds =
    extent === null
      ? { min: 0, max: 100 }
      : panelResizeBounds(
          Math.max(0, extent - PANEL_DIVIDER_SIZE),
          ...minSizes,
        );
  const desired = preview ?? (sizes[0] / (sizes[0] + sizes[1])) * 100;
  const percent = Math.max(bounds.min, Math.min(bounds.max, desired));

  return (
    <div
      ref={host}
      className={`panelSplit ${className}`}
      style={{ flexDirection: direction }}
    >
      <div
        ref={before}
        id={beforeId}
        className="panelSplitPane"
        style={{ flexGrow: hideAfter ? 1 : percent }}
      >
        {children[0]}
      </div>
      {!hideAfter && (
        <PanelDivider
          orientation={direction === "row" ? "vertical" : "horizontal"}
          label={label}
          controls={beforeId}
          value={percent}
          minBefore={minSizes[0]}
          minAfter={minSizes[1]}
          getPanes={() => [before.current, after.current]}
          onChange={setPreview}
          onCancel={() => setPreview(null)}
          onCommit={(value) => {
            setPreview(null);
            onSizesChange([value, 100 - value]);
          }}
        />
      )}
      <div
        ref={after}
        className="panelSplitPane"
        hidden={hideAfter}
        style={{ flexGrow: 100 - percent }}
      >
        {children[1]}
      </div>
    </div>
  );
}

/**
 * Resizable, reorderable stack layout used by the side inspector panels.
 */
import { ChevronRight } from "lucide-react";
import { Fragment, useEffect, useId, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { PanelDivider } from "./PanelDivider";
import { useWorkspaceLocked } from './WorkspaceLock';
import { PanelBody } from "./PanelBody";

export type CollapsiblePanelItem = {
  id: string;
  title: string;
  content: ReactNode;
  defaultCollapsed?: boolean;
};

type PanelLayoutState = {
  collapsedById: Record<string, boolean>;
  sizesById: Record<string, number>;
};

const DEFAULT_PANEL_SIZE = 1;

function normalizeExpandedPanelSizes(
  expandedIds: string[],
  sizesById: Record<string, number>,
): Record<string, number> {
  if (expandedIds.length === 0) {
    return sizesById;
  }

  const total = expandedIds.reduce(
    (sum, id) => sum + Math.max(0, sizesById[id] ?? 0),
    0,
  );
  if (total <= 0) {
    const equalSize = 1 / expandedIds.length;
    return expandedIds.reduce<Record<string, number>>(
      (next, id) => {
        next[id] = equalSize;
        return next;
      },
      { ...sizesById },
    );
  }

  return expandedIds.reduce<Record<string, number>>(
    (next, id) => {
      next[id] = Math.max(0, sizesById[id] ?? 0) / total;
      return next;
    },
    { ...sizesById },
  );
}

function buildLayoutState(items: CollapsiblePanelItem[]): PanelLayoutState {
  const collapsedById = Object.fromEntries(
    items.map((item) => [item.id, item.defaultCollapsed ?? false]),
  );
  const sizesById = Object.fromEntries(
    items.map((item) => [item.id, DEFAULT_PANEL_SIZE]),
  );
  const expandedIds = items
    .filter((item) => !collapsedById[item.id])
    .map((item) => item.id);

  return {
    collapsedById,
    sizesById: normalizeExpandedPanelSizes(expandedIds, sizesById),
  };
}

function buildCollapsedById(
  items: CollapsiblePanelItem[],
  collapsedById?: Record<string, boolean>,
): Record<string, boolean> {
  return Object.fromEntries(
    items.map((item) => [
      item.id,
      collapsedById?.[item.id] ?? item.defaultCollapsed ?? false,
    ]),
  );
}

function buildSizesById(
  items: CollapsiblePanelItem[],
  sizesById?: Record<string, number>,
): Record<string, number> {
  return Object.fromEntries(
    items.map((item) => [item.id, sizesById?.[item.id] ?? DEFAULT_PANEL_SIZE]),
  );
}

type ReorderState = {
  pointerId: number;
  activeId: string;
  startX: number;
  stackRect: DOMRect;
  targetId: string | null | undefined;
};

type ContextMenuItem = {
  label: string;
  danger?: boolean;
  onSelect: () => void;
};

type PanelContextMenuState = {
  panelId: string;
  x: number;
  y: number;
};

export function syncPanelOrder(
  currentOrder: string[],
  items: CollapsiblePanelItem[],
): string[] {
  const nextItemIds = items.map((item) => item.id);
  const nextItemIdSet = new Set(nextItemIds);
  const retainedIds = currentOrder.filter((id) => nextItemIdSet.has(id));
  const appendedIds = nextItemIds.filter((id) => !retainedIds.includes(id));
  return [...retainedIds, ...appendedIds];
}

export function movePanelId(
  panelIds: string[],
  activeId: string,
  targetId: string | null,
): string[] {
  if (!panelIds.includes(activeId)) {
    return panelIds;
  }

  const nextPanelIds = panelIds.filter((id) => id !== activeId);
  const targetIndex =
    targetId === null ? nextPanelIds.length : nextPanelIds.indexOf(targetId);

  if (targetIndex < 0) {
    nextPanelIds.push(activeId);
    return nextPanelIds;
  }

  nextPanelIds.splice(targetIndex, 0, activeId);
  return nextPanelIds;
}

export function CollapsiblePanelStack({
  items,
  orderedIds: controlledOrderedIds,
  collapsedById: controlledCollapsedById,
  sizesById: controlledSizesById,
  onOrderedIdsChange,
  onCollapsedByIdChange,
  onSizesByIdChange,
  onItemDismiss,
  onItemMoveToAdjacentLane,
  onItemPreviewAdjacentLane,
  onItemCancelAdjacentLanePreview,
  externalInsertionBeforeId,
  onInsertionResolverChange,
}: {
  items: CollapsiblePanelItem[];
  orderedIds?: string[];
  collapsedById?: Record<string, boolean>;
  sizesById?: Record<string, number>;
  onOrderedIdsChange?: (orderedIds: string[]) => void;
  onCollapsedByIdChange?: (collapsedById: Record<string, boolean>) => void;
  onSizesByIdChange?: (sizesById: Record<string, number>) => void;
  onItemDismiss?: (itemId: string) => void;
  onItemMoveToAdjacentLane?: (
    itemId: string,
    direction: "left" | "right",
    clientY: number,
  ) => void;
  onItemPreviewAdjacentLane?: (
    itemId: string,
    direction: "left" | "right",
    clientY: number,
  ) => boolean;
  onItemCancelAdjacentLanePreview?: () => void;
  externalInsertionBeforeId?: string | null;
  onInsertionResolverChange?: (
    resolver: ((clientY: number) => string | null) | null,
  ) => void;
}) {
  const locked=useWorkspaceLocked(),lockedRef=useRef(locked);lockedRef.current=locked;
  const stackRef = useRef<HTMLDivElement | null>(null);
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});
  const contextMenuRef = useRef<HTMLDivElement | null>(null);
  const stackId = useId();
  const [resizePreview, setResizePreview] = useState<Record<
    string,
    number
  > | null>(null);
  const reorderStateRef = useRef<ReorderState | null>(null);
  const onOrderedIdsChangeRef = useRef(onOrderedIdsChange);
  const onCollapsedByIdChangeRef = useRef(onCollapsedByIdChange);
  const onSizesByIdChangeRef = useRef(onSizesByIdChange);
  const onItemDismissRef = useRef(onItemDismiss);
  const onItemMoveToAdjacentLaneRef = useRef(onItemMoveToAdjacentLane);
  const onItemPreviewAdjacentLaneRef = useRef(onItemPreviewAdjacentLane);
  const onItemCancelAdjacentLanePreviewRef = useRef(
    onItemCancelAdjacentLanePreview,
  );
  const isOrderControlledRef = useRef(controlledOrderedIds !== undefined);
  const isSizesControlledRef = useRef(controlledSizesById !== undefined);
  const orderedIdsRef = useRef<string[]>([]);
  const sizesByIdRef = useRef<Record<string, number>>({});
  const collapsedByIdRef = useRef<Record<string, boolean>>({});
  const [uncontrolledOrderedIds, setUncontrolledOrderedIds] = useState(() =>
    items.map((item) => item.id),
  );
  const [activeReorderId, setActiveReorderId] = useState<string | null>(null);
  const [localInsertionBeforeId, setLocalInsertionBeforeId] = useState<
    string | null | undefined
  >(undefined);
  const [horizontalDropSide, setHorizontalDropSide] = useState<
    "left" | "right" | null
  >(null);
  const [contextMenu, setContextMenu] = useState<PanelContextMenuState | null>(
    null,
  );
  const [uncontrolledCollapsedById, setUncontrolledCollapsedById] = useState(
    () => buildLayoutState(items).collapsedById,
  );
  const [sizesById, setSizesById] = useState<Record<string, number>>(
    () => buildLayoutState(items).sizesById,
  );
  const orderedIds = useMemo(
    () => syncPanelOrder(controlledOrderedIds ?? uncontrolledOrderedIds, items),
    [controlledOrderedIds, items, uncontrolledOrderedIds],
  );

  const itemById = useMemo(
    () => new Map(items.map((item) => [item.id, item])),
    [items],
  );
  const orderedItems = useMemo(
    () =>
      orderedIds
        .map((id) => itemById.get(id))
        .filter((item): item is CollapsiblePanelItem => item !== undefined),
    [itemById, orderedIds],
  );
  const collapsedById = useMemo(
    () =>
      buildCollapsedById(
        orderedItems,
        controlledCollapsedById ?? uncontrolledCollapsedById,
      ),
    [controlledCollapsedById, orderedItems, uncontrolledCollapsedById],
  );
  const normalizedSizesById = useMemo(() => {
    const nextSizesById = buildSizesById(
      orderedItems,
      resizePreview ?? controlledSizesById ?? sizesById,
    );
    const expandedIds = orderedItems
      .filter((item) => !collapsedById[item.id])
      .map((item) => item.id);
    return normalizeExpandedPanelSizes(expandedIds, nextSizesById);
  }, [
    collapsedById,
    controlledSizesById,
    orderedItems,
    sizesById,
    resizePreview,
  ]);

  orderedIdsRef.current = orderedIds;
  collapsedByIdRef.current = collapsedById;
  sizesByIdRef.current = normalizedSizesById;
  onOrderedIdsChangeRef.current = onOrderedIdsChange;
  onCollapsedByIdChangeRef.current = onCollapsedByIdChange;
  onSizesByIdChangeRef.current = onSizesByIdChange;
  onItemDismissRef.current = onItemDismiss;
  onItemMoveToAdjacentLaneRef.current = onItemMoveToAdjacentLane;
  onItemPreviewAdjacentLaneRef.current = onItemPreviewAdjacentLane;
  onItemCancelAdjacentLanePreviewRef.current = onItemCancelAdjacentLanePreview;
  isOrderControlledRef.current = controlledOrderedIds !== undefined;
  isSizesControlledRef.current = controlledSizesById !== undefined;

  useEffect(() => {
    if (!onInsertionResolverChange) {
      return;
    }

    onInsertionResolverChange((clientY: number) => {
      for (const panelId of orderedIdsRef.current) {
        const panel = sectionRefs.current[panelId];
        if (!panel) continue;
        const rect = panel.getBoundingClientRect();
        if (clientY < rect.top + rect.height / 2) {
          return panelId;
        }
      }
      return null;
    });

    return () => onInsertionResolverChange(null);
  }, [onInsertionResolverChange]);

  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      if(lockedRef.current)return;
      const reorderState = reorderStateRef.current;
      if (reorderState?.pointerId === event.pointerId) {
        event.preventDefault();
        const horizontalDelta = event.clientX - reorderState.startX;
        const nextHorizontalDropSide =
          event.clientX > reorderState.stackRect.right + 24 ||
          (horizontalDelta > 96 &&
            event.clientX > reorderState.stackRect.right - 8)
            ? "right"
            : event.clientX < reorderState.stackRect.left - 24 ||
                (horizontalDelta < -96 &&
                  event.clientX < reorderState.stackRect.left + 8)
              ? "left"
              : null;
        if (nextHorizontalDropSide) {
          const handledByAdjacentLane =
            onItemPreviewAdjacentLaneRef.current?.(
              reorderState.activeId,
              nextHorizontalDropSide,
              event.clientY,
            ) ?? false;
          setHorizontalDropSide(
            handledByAdjacentLane ? null : nextHorizontalDropSide,
          );
          setLocalInsertionBeforeId(undefined);
          return;
        }

        setHorizontalDropSide(null);
        onItemCancelAdjacentLanePreviewRef.current?.();

        const visiblePanelIds = orderedIdsRef.current.filter(
          (id) => id !== reorderState.activeId,
        );
        let targetId: string | null = null;

        for (const panelId of visiblePanelIds) {
          const panel = sectionRefs.current[panelId];
          if (!panel) continue;
          const rect = panel.getBoundingClientRect();
          if (event.clientY < rect.top + rect.height / 2) {
            targetId = panelId;
            break;
          }
        }

        reorderState.targetId = targetId;
        setLocalInsertionBeforeId(targetId);
        return;
      }
    };

    const clearPointerState = (event: PointerEvent) => {
      if(lockedRef.current)return;
      if (reorderStateRef.current?.pointerId === event.pointerId) {
        const reorderState = reorderStateRef.current;
        const horizontalDelta = event.clientX - reorderState.startX;
        const dropSide =
          event.clientX > reorderState.stackRect.right + 24 ||
          (horizontalDelta > 96 &&
            event.clientX > reorderState.stackRect.right - 8)
            ? "right"
            : event.clientX < reorderState.stackRect.left - 24 ||
                (horizontalDelta < -96 &&
                  event.clientX < reorderState.stackRect.left + 8)
              ? "left"
              : null;
        reorderStateRef.current = null;
        setActiveReorderId(null);
        setLocalInsertionBeforeId(undefined);
        setHorizontalDropSide(null);
        if (event.type === "pointercancel") {
          onItemCancelAdjacentLanePreviewRef.current?.();
          return;
        }
        if (dropSide) {
          onItemMoveToAdjacentLaneRef.current?.(
            reorderState.activeId,
            dropSide,
            event.clientY,
          );
        } else {
          onItemCancelAdjacentLanePreviewRef.current?.();
          if (reorderState.targetId === undefined) {
            return;
          }
          const current = orderedIdsRef.current;
          const next = movePanelId(
            current,
            reorderState.activeId,
            reorderState.targetId,
          );
          const changed = !next.every((id, index) => id === current[index]);
          if (!changed) {
            return;
          }
          if (!isOrderControlledRef.current) {
            setUncontrolledOrderedIds(next);
          }
          onOrderedIdsChangeRef.current?.(next);
        }
      }
    };

    window.addEventListener("pointermove", onPointerMove);
    const cancelReorder = () => {
      reorderStateRef.current = null;
      setActiveReorderId(null);
      setLocalInsertionBeforeId(undefined);
      setHorizontalDropSide(null);
      onItemCancelAdjacentLanePreviewRef.current?.();
    };
    const escapeReorder = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && reorderStateRef.current) { event.preventDefault(); event.stopPropagation(); cancelReorder(); }
    };
    window.addEventListener('keydown', escapeReorder, true);
    window.addEventListener('blur', cancelReorder);
    window.addEventListener("pointerup", clearPointerState);
    window.addEventListener("pointercancel", clearPointerState);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener('keydown', escapeReorder, true);
      window.removeEventListener('blur', cancelReorder);
      window.removeEventListener("pointerup", clearPointerState);
      window.removeEventListener("pointercancel", clearPointerState);
    };
  }, []);
  useEffect(()=>{
    if(!locked)return;
    reorderStateRef.current=null;setActiveReorderId(null);setLocalInsertionBeforeId(undefined);setHorizontalDropSide(null);setResizePreview(null);setContextMenu(null);onItemCancelAdjacentLanePreviewRef.current?.();
  },[locked]);

  useEffect(() => {
    if (!contextMenu) return;
    contextMenuRef.current?.querySelector<HTMLButtonElement>('button')?.focus();

    const handlePointerDown = (event: PointerEvent | MouseEvent) => {
      const target = event.target;
      if (target instanceof Node && contextMenuRef.current?.contains(target)) {
        return;
      }
      setContextMenu(null);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setContextMenu(null);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("contextmenu", handlePointerDown, true);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("contextmenu", handlePointerDown, true);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [contextMenu]);

  const togglePanel = (panelId: string) => {
    if(locked)return;
    const currentCollapsedById = collapsedByIdRef.current;
    if (!currentCollapsedById[panelId]) sectionRefs.current[panelId]?.querySelectorAll('video').forEach(video => video.pause());
    const collapsedById = {
      ...currentCollapsedById,
      [panelId]: !currentCollapsedById[panelId],
    };
    const nextExpandedIds = orderedItems
      .filter((item) => !collapsedById[item.id])
      .map((item) => item.id);
    const nextSizesById = normalizeExpandedPanelSizes(
      nextExpandedIds,
      sizesByIdRef.current,
    );
    if (!isSizesControlledRef.current) {
      setSizesById(nextSizesById);
    }
    if (!controlledCollapsedById) {
      setUncontrolledCollapsedById(collapsedById);
    }
    onCollapsedByIdChangeRef.current?.(collapsedById);
  };

  const dismissPanel = (panelId: string) => {
    if(locked)return;
    onItemDismissRef.current?.(panelId);
    setContextMenu(null);
  };

  const openPanelContextMenu = (
    event: React.MouseEvent<HTMLElement>,
    panelId: string,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    if(locked)return;
    setContextMenu({
      panelId,
      x: event.clientX,
      y: event.clientY,
    });
  };

  const resizePair = (beforeId: string, afterId: string, ratio: number) => {
    const sizes = sizesByIdRef.current;
    const pairSize = (sizes[beforeId] ?? 0) + (sizes[afterId] ?? 0);
    return {
      ...sizes,
      [beforeId]: (pairSize * ratio) / 100,
      [afterId]: (pairSize * (100 - ratio)) / 100,
    };
  };
  const layoutKey = orderedIds
    .map((id) => `${id}:${collapsedById[id]}`)
    .join("|");
  useEffect(() => setResizePreview(null), [layoutKey]);

  const beginReorder = (
    event: React.PointerEvent<HTMLDivElement>,
    panelId: string,
  ) => {
    if (locked||event.button !== 0) return;
    const stack = stackRef.current;
    if (!stack) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.focus();
    reorderStateRef.current = {
      pointerId: event.pointerId,
      activeId: panelId,
      startX: event.clientX,
      stackRect: stack.getBoundingClientRect(),
      targetId: undefined,
    };
    setActiveReorderId(panelId);
  };
  const contextMenuItems =
    contextMenu === null
      ? null
      : ([
          {
            label: collapsedById[contextMenu.panelId] ? "Expand" : "Collapse",
            onSelect: () => {
              togglePanel(contextMenu.panelId);
              setContextMenu(null);
            },
          },
          {
            label: "Dismiss",
            danger: true,
            onSelect: () => dismissPanel(contextMenu.panelId),
          },
        ] satisfies ContextMenuItem[]);

  return (
    <>
      <div
        ref={stackRef}
        className={`sidePanelStack ${
          activeReorderId ? "is-reordering" : ""
        } ${horizontalDropSide ? `is-drop-${horizontalDropSide}` : ""}`.trim()}
      >
        {orderedItems.map((item, index) => {
          const collapsed = collapsedById[item.id] ?? false;
          const nextItem = orderedItems[index + 1];
          const canResizeIntoNext =
            !collapsed && nextItem !== undefined && !collapsedById[nextItem.id];
          const isReordering = activeReorderId === item.id;
          const insertionBeforeId =
            externalInsertionBeforeId !== undefined
              ? externalInsertionBeforeId
              : localInsertionBeforeId;

          return (
            <Fragment key={item.id}>
              {insertionBeforeId === item.id ? (
                <div className="sidePanelInsertionIndicator" />
              ) : null}
              <section
                id={`${stackId}-${item.id}`}
                data-panel-id={item.id}
                ref={(node) => {
                  sectionRefs.current[item.id] = node;
                }}
                className={`sidePanelSection ${
                  collapsed ? "collapsed" : "expanded"
                } ${isReordering ? "is-reordering" : ""}`.trim()}
                style={{
                  flex: collapsed
                    ? "0 0 auto"
                    : `${Math.max(normalizedSizesById[item.id] ?? 0, 0.0001)} 1 0%`,
                }}
              >
                <div
                  className="sidePanelSectionHeader"
                  onContextMenu={(event) =>
                    openPanelContextMenu(event, item.id)
                  }
                >
                  <button
                    type="button"
                    className="sidePanelSectionCollapseToggle"
                    disabled={locked}
                    title={locked?'Unlock workspace in Window to collapse panels':undefined}
                    onClick={() => togglePanel(item.id)}
                    onContextMenu={(event) =>
                      openPanelContextMenu(event, item.id)
                    }
                    aria-expanded={!collapsed}
                    aria-label={`${collapsed ? "Expand" : "Collapse"} ${item.title} panel`}
                  >
                    <span
                      className="sidePanelSectionChevron"
                      aria-hidden="true"
                    >
                      <ChevronRight size={14} strokeWidth={1.9} />
                    </span>
                  </button>
                  <div
                    className="sidePanelSectionToggle"
                    onPointerDown={(event) => beginReorder(event, item.id)}
                    onContextMenu={(event) =>
                      openPanelContextMenu(event, item.id)
                    }
                    role="button" tabIndex={locked?-1:0} aria-disabled={locked||undefined} aria-label={`Move ${item.title} panel`}
                    title={locked?'Unlock workspace in Window to move panels':'Drag to reorder or snap into another column. Alt + arrow keys moves panels.'}
                    onKeyDown={event => {
                      if(locked)return;
                      if (!event.altKey || !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
                      event.preventDefault(); event.stopPropagation();
                      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                        onItemMoveToAdjacentLane?.(item.id, event.key === 'ArrowLeft' ? 'left' : 'right', event.currentTarget.getBoundingClientRect().top);
                      } else {
                        const next = [...orderedIds], target = index + (event.key === 'ArrowUp' ? -1 : 1);
                        if (target >= 0 && target < next.length) { [next[index], next[target]] = [next[target], next[index]]; onOrderedIdsChange?.(next); }
                      }
                    }}
                  >
                    <span className="sidePanelSectionTitle">{item.title}</span>
                  </div>
                </div>
                <PanelBody className="sidePanelSectionBody inspectorPanelBody">
                  {item.content}
                </PanelBody>
              </section>
              {canResizeIntoNext ? (
                <PanelDivider
                  key={`${item.id}:${nextItem.id}`}
                  orientation="horizontal"
                  label={`${item.title} and ${nextItem.title}`}
                  controls={`${stackId}-${item.id}`}
                  value={
                    ((normalizedSizesById[item.id] ?? 0) /
                      ((normalizedSizesById[item.id] ?? 0) +
                        (normalizedSizesById[nextItem.id] ?? 0))) *
                    100
                  }
                  minBefore={120}
                  minAfter={120}
                  getPanes={() => [
                    sectionRefs.current[item.id],
                    sectionRefs.current[nextItem.id],
                  ]}
                  onChange={(value) =>
                    setResizePreview(resizePair(item.id, nextItem.id, value))
                  }
                  onCancel={() => setResizePreview(null)}
                  onCommit={(value) => {
                    const next = resizePair(item.id, nextItem.id, value);
                    if (!isSizesControlledRef.current) setSizesById(next);
                    setResizePreview(null);
                    onSizesByIdChangeRef.current?.(next);
                  }}
                />
              ) : null}
            </Fragment>
          );
        })}
        {(externalInsertionBeforeId !== undefined
          ? externalInsertionBeforeId
          : localInsertionBeforeId) === null ? (
          <div className="sidePanelInsertionIndicator is-end" />
        ) : null}
      </div>
      {contextMenu !== null &&
      contextMenuItems !== null &&
      typeof document !== "undefined"
        ? createPortal(
            <div
              ref={contextMenuRef}
              className="panelContextMenu" role="menu" aria-label="Panel actions"
              style={{ left: Math.max(0, Math.min(contextMenu.x, window.innerWidth - 170)), top: Math.max(0, Math.min(contextMenu.y, window.innerHeight - 90)) }}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => event.stopPropagation()}
              onContextMenu={(event) => event.preventDefault()}
              onKeyDown={event => {
                const buttons=Array.from(event.currentTarget.querySelectorAll('button'));
                if(event.key==='ArrowDown'||event.key==='ArrowUp') {
                  event.preventDefault();event.stopPropagation();
                  const index=buttons.indexOf(document.activeElement as HTMLButtonElement);
                  buttons[(index+(event.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length]?.focus();
                }
                if(event.key==='Escape') {
                  event.preventDefault();event.stopPropagation();
                  sectionRefs.current[contextMenu.panelId]?.querySelector<HTMLElement>('.sidePanelSectionToggle')?.focus();
                  setContextMenu(null);
                }
              }}
            >
              {contextMenuItems.map((item) => (
                <button
                  key={item.label}
                  role="menuitem"
                  className={item.danger ? "danger" : ""}
                  onClick={() => {
                    item.onSelect();
                  }}
                >
                  {item.label}
                </button>
              ))}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Check, ChevronLeft, ChevronRight, CornerDownLeft, GripVertical, LayoutTemplate, Loader2, Merge, MousePointerClick, Plus, Redo2,
  Rows2, Save, Search, Blocks, Trash2, Undo2, X,
} from 'lucide-react';
import { Modal } from '../ui/Modal';
import { WidgetGlyph } from './WidgetGlyph';
import { WIDGET_ICON, WIDGET_TONE, toneWash } from './widgetStyle';
import {
  ALL_WIDGETS, WIDGET_TEMPLATES, TILES_PER_ROW_OPTIONS, TILE_TYPES, WIDGET_CATEGORIES, WIDGET_INFO, applyTemplate,
  isRowBreak, layoutRows, makeRowBreak, matchesTemplate, mergeLayout, newRowBreakId, normalizeLayout, serializeLayout,
} from '../../lib/widgets';
import type { LayoutRow } from '../../lib/widgets';
import { useFlip } from '../../lib/useFlip';
import type { FlipRect } from '../../lib/useFlip';
import { api } from '../../services/api';
import type { LayoutItem, SavedLayout, TilesPerRow, WidgetConfig } from '../../types/weather';

interface WidgetEditorModalProps {
  widgets: LayoutItem[];
  /** Saves a new layout. The dashboard behind redraws with it straight away. */
  onChange: (next: LayoutItem[]) => void;
  onClose: () => void;
  /** Signed in, so layouts can be saved to the account. */
  signedIn: boolean;
}

/** How far a press has to travel before it counts as a drag rather than a click. */
const DRAG_THRESHOLD = 5;
/** How long a toast stays up, with its Undo, before it goes. */
const TOAST_MS = 5_000;
/** How close to the edge of the preview a drag has to come before it scrolls. */
const EDGE_SCROLL_PX = 48;

/** Preview heights, roughly in proportion to how tall each card is on the dashboard. */
const PREVIEW_HEIGHT: Partial<Record<WidgetConfig['type'], string>> = {
  'clock-daylight': 'h-14',
  'forecast-strip': 'h-24',
  hourly: 'h-24',
  'historical-chart': 'h-28',
  'current-station': 'h-20',
  'station-status': 'h-20',
};

const isWide = (w: WidgetConfig) => !TILE_TYPES.has(w.type);

/**
 * The miniature's span for each tile, on a sixty-column grid so that every row
 * width from one to six divides it. The preview shows the columns each row asks
 * for; a phone is too narrow for more than two, so there it pairs them.
 */
const COLUMN_SPAN: Record<number, string> = {
  1: 'col-span-60',
  2: 'col-span-30',
  3: 'col-span-30 sm:col-span-20',
  4: 'col-span-30 sm:col-span-15',
  5: 'col-span-30 sm:col-span-12',
  6: 'col-span-30 sm:col-span-10',
};

const visible = (item: LayoutItem) => isRowBreak(item) || item.enabled;
const isShownWidget = (item: LayoutItem): item is WidgetConfig => !isRowBreak(item) && item.enabled;

/** The order of what is on screen, to tell whether a change changed anything. */
const signature = (list: LayoutItem[]) =>
  list.filter(visible).map(i => (isRowBreak(i) ? `${i.id}:${i.columns ?? 'fit'}` : i.id)).join();

/** `id` switched on and placed beside `targetId`, or after the last widget showing when there is no target. */
function place(list: LayoutItem[], id: string, targetId: string | null, after: boolean): LayoutItem[] {
  const item = list.find(w => w.id === id);
  if (!item || isRowBreak(item)) return list;
  const rest = list.filter(w => w.id !== id);
  const at = targetId
    ? rest.findIndex(w => w.id === targetId) + (after ? 1 : 0)
    : rest.map(w => w.enabled).lastIndexOf(true) + 1;
  rest.splice(at, 0, { ...item, enabled: true });
  return rest;
}

/** `id` as the first tile of a new row, straight after `anchorId`'s row. */
function startRowAfter(list: LayoutItem[], id: string, anchorId: string, breakId: string): LayoutItem[] {
  const item = list.find(w => w.id === id);
  if (!item || isRowBreak(item)) return list;
  const rest = list.filter(w => w.id !== id);
  rest.splice(rest.findIndex(w => w.id === anchorId) + 1, 0, makeRowBreak(breakId, null), { ...item, enabled: true });
  return rest;
}

/**
 * `id` swapped with its neighbour on the dashboard, or null at the end of the
 * line. A row break counts as a neighbour, so stepping past the end of a row of
 * tiles carries the tile into the next row.
 */
function shift(list: LayoutItem[], id: string, step: -1 | 1): LayoutItem[] | null {
  const on = list.filter(visible);
  const i = on.findIndex(w => w.id === id);
  const neighbour = on[i + step];
  return i < 0 || !neighbour ? null : place(list, id, neighbour.id, step > 0);
}

const hide = (list: LayoutItem[], id: string) => list.map(w => (w.id === id && !isRowBreak(w) ? { ...w, enabled: false } : w));

const inside = (r: FlipRect, x: number, y: number) => x >= r.left && x <= r.left + r.width && y >= r.top && y <= r.top + r.height;

const distance = (r: FlipRect, x: number, y: number) => {
  const dx = Math.max(r.left - x, 0, x - (r.left + r.width));
  const dy = Math.max(r.top - y, 0, y - (r.top + r.height));
  return Math.hypot(dx, dy);
};

const within = (el: HTMLElement | null, x: number, y: number) => {
  const r = el?.getBoundingClientRect();
  return !!r && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
};

interface DragState {
  id: string;
  source: 'canvas' | 'library';
  startX: number;
  startY: number;
  x: number;
  y: number;
  /** Where in the card it was picked up, so the card stays under the pointer at the same spot. */
  grabX: number;
  grabY: number;
  width: number;
  height: number;
  active: boolean;
  /** Over the library with a card from the preview, where letting go removes it. */
  removing: boolean;
  /** The id a row started by this drag gets, so moving on from the new-row strip can take it back out. */
  newBreakId: string;
  /** The layout when the drag began, to go back to if it is cancelled. */
  base: LayoutItem[];
}

type Zone = 'canvas' | 'library' | null;

/** What rendering needs to know about a drag in progress. */
interface Dragging {
  id: string;
  source: DragState['source'];
  zone: Zone;
  width: number;
  height: number;
}

interface Toast {
  key: number;
  text: string;
  undoable: boolean;
}

/**
 * The dashboard editor. A miniature of the dashboard on the left that is
 * rearranged by dragging, and everything that can go on it on the right: single
 * widgets to drag or click in, and templates to start from. Every
 * change saves as it is made and can be undone.
 */
export const WidgetEditorModal: React.FC<WidgetEditorModalProps> = ({ widgets, onChange, onClose, signedIn }) => {
  const [past, setPast] = useState<LayoutItem[][]>([]);
  const [future, setFuture] = useState<LayoutItem[][]>([]);
  const [draft, setDraft] = useState<LayoutItem[] | null>(null);
  // Set once a press has become a drag, and cleared when it ends.
  const [dragging, setDragging] = useState<Dragging | null>(null);
  const [tab, setTab] = useState<'widgets' | 'templates'>('widgets');
  const [query, setQuery] = useState('');
  const [toast, setToast] = useState<Toast | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [flashId, setFlashId] = useState<string | null>(null);
  // Bumped by the Save button over the preview, to open the naming box in the Layouts tab.
  const [saveRequest, setSaveRequest] = useState(0);

  const shown = draft ?? widgets;
  const onScreen = shown.filter(isShownWidget);
  // While a tile is carried, a strip under each row of tiles offers to start a new row with it.
  const carriedTile = dragging ? ALL_WIDGETS.find(w => w.id === dragging.id && !isWide(w)) ?? null : null;
  const showNewRowStrips = !!carriedTile && dragging?.zone === 'canvas';
  const rows = useMemo(() => layoutRows(shown), [shown]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLOListElement>(null);
  const libraryRef = useRef<HTMLDivElement>(null);
  const ghostRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const draftRef = useRef<LayoutItem[] | null>(null);
  const focusAfter = useRef<string | null>(null);
  const rects = useFlip(canvasRef, `${signature(shown)}|${showNewRowStrips ? 'strips' : ''}`);

  const say = (text: string) => setAnnouncement(text);

  const commit = (next: LayoutItem[], message?: string) => {
    const tidy = normalizeLayout(next);
    if (signature(tidy) === signature(widgets)) return;
    setPast(p => [...p.slice(-49), widgets]);
    setFuture([]);
    onChange(tidy);
    if (message) {
      setToast(t => ({ key: (t?.key ?? 0) + 1, text: message, undoable: true }));
      say(message);
    }
  };

  const undo = () => {
    const prev = past[past.length - 1];
    if (!prev) return;
    setPast(p => p.slice(0, -1));
    setFuture(f => [widgets, ...f]);
    onChange(prev);
    setToast(null);
    say('Undone');
  };

  const redo = () => {
    const next = future[0];
    if (!next) return;
    setFuture(f => f.slice(1));
    setPast(p => [...p, widgets]);
    onChange(next);
    say('Redone');
  };

  const titleOf = (id: string) => shown.find(w => w.id === id)?.title ?? 'Widget';

  const add = (id: string) => {
    // A tile joins the end of the last row of tiles rather than starting a lonely row at the foot.
    const widget = ALL_WIDGETS.find(w => w.id === id);
    const lastTile = widget && !isWide(widget) ? [...widgets].reverse().find(w => isShownWidget(w) && !isWide(w)) : undefined;
    commit(place(widgets, id, lastTile?.id ?? null, true), `Added ${titleOf(id)}`);
    setFlashId(id);
  };

  const remove = (id: string) => {
    // Keep focus in the preview: on the next card along, or the one before when this was the last.
    const on = widgets.filter(isShownWidget);
    const i = on.findIndex(w => w.id === id);
    focusAfter.current = (on[i + 1] ?? on[i - 1])?.id ?? null;
    commit(hide(widgets, id), `Removed ${titleOf(id)}`);
  };

  const move = (id: string, step: -1 | 1) => {
    const next = shift(widgets, id, step);
    if (!next) return;
    focusAfter.current = id;
    commit(next);
    const on = next.filter(isShownWidget);
    say(`${titleOf(id)} moved to position ${on.findIndex(w => w.id === id) + 1} of ${on.length}`);
  };

  // ── Tile rows ──
  // A row that has no break of its own gets one the first time it is given a
  // width, so every row of tiles can be set on its own.

  const setRowColumns = (row: LayoutRow, columns: TilesPerRow | null) => {
    const brk = row.rowBreak;
    let next: LayoutItem[];
    if (brk) {
      next = widgets.map(i => (i.id === brk.id ? { ...brk, columns } : i));
    } else {
      next = [...widgets];
      next.splice(next.findIndex(i => i.id === row.widgets[0].id), 0, makeRowBreak(newRowBreakId(widgets), columns));
    }
    commit(next, columns ? `Row set to ${columns} across` : 'Row set to fit its tiles');
  };

  const splitBefore = (id: string) => {
    const next = [...widgets];
    next.splice(next.findIndex(i => i.id === id), 0, makeRowBreak(newRowBreakId(widgets), null));
    focusAfter.current = id;
    commit(next, `New row starts at ${titleOf(id)}`);
  };

  const joinRow = (row: LayoutRow) => {
    const brk = row.rowBreak;
    if (!brk) return;
    commit(widgets.filter(i => i.id !== brk.id), 'Joined with the row above');
  };

  const chooseTemplate = (template: (typeof WIDGET_TEMPLATES)[number]) => {
    commit(applyTemplate(template.ids), `Switched to the ${template.name} template`);
  };

  const chooseSaved = (saved: SavedLayout) => {
    commit(mergeLayout(saved.layout), `Switched to ${saved.name}`);
  };

  const notify = (text: string) => {
    setToast(t => ({ key: (t?.key ?? 0) + 1, text, undoable: false }));
    say(text);
  };

  // Moving a card in the DOM drops keyboard focus, so hand it back once it has landed.
  useLayoutEffect(() => {
    const id = focusAfter.current;
    if (!id) return;
    focusAfter.current = null;
    canvasRef.current?.querySelector<HTMLElement>(`[data-card="${id}"]`)?.focus({ preventScroll: false });
  });

  // A card just added lights up, and the preview scrolls to show it.
  useEffect(() => {
    if (!flashId) return;
    canvasRef.current?.querySelector(`[data-card="${flashId}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    const t = window.setTimeout(() => setFlashId(null), 1_400);
    return () => window.clearTimeout(t);
  }, [flashId]);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), TOAST_MS);
    return () => window.clearTimeout(t);
  }, [toast]);

  // ── Dragging ────────────────────────────────────────────────────────────────
  // Pointer events on the window rather than HTML5 drag and drop, so it works
  // the same with a mouse, a pen and a finger, and the preview can reflow live
  // underneath the card being carried.

  // The window listeners are made once, so the same functions come off that went
  // on; each hands over to the latest render's handlers.
  const handlers = useRef<{ onDragMove: (e: PointerEvent) => void; endDrag: (drop: boolean) => boolean } | null>(null);
  const [listeners] = useState(() => {
    const move = (e: PointerEvent) => handlers.current?.onDragMove(e);
    const up = () => handlers.current?.endDrag(true);
    const cancel = () => handlers.current?.endDrag(false);
    const key = (e: KeyboardEvent) => {
      // Captured ahead of the dialog, so Escape drops the card rather than closing the editor.
      if (e.key !== 'Escape' || !dragRef.current?.active) return;
      e.preventDefault();
      e.stopPropagation();
      handlers.current?.endDrag(false);
    };
    return {
      attach() {
        window.addEventListener('pointermove', move, { passive: false });
        window.addEventListener('pointerup', up);
        window.addEventListener('pointercancel', cancel);
        window.addEventListener('keydown', key, true);
      },
      detach() {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', cancel);
        window.removeEventListener('keydown', key, true);
      },
    };
  });

  const setDraftBoth = (next: LayoutItem[] | null) => {
    draftRef.current = next;
    setDraft(next);
  };

  const positionGhost = (d: DragState) => {
    const ghost = ghostRef.current;
    // Over the bin it shrinks towards the pointer, so the "Drop to remove" target stays readable.
    const scale = d.removing ? 0.5 : 1.03;
    if (ghost) {
      ghost.style.transformOrigin = `${d.grabX}px ${d.grabY}px`;
      ghost.style.transform = `translate(${d.x - d.grabX}px, ${d.y - d.grabY}px) rotate(1.5deg) scale(${scale})`;
    }
  };

  /** Where the carried card would land with the pointer at (x, y) over the preview. */
  const layoutFor = (d: DragState, list: LayoutItem[]): LayoutItem[] => {
    const canvas = canvasRef.current;
    // An empty preview has no cards to aim between: the first one simply goes in.
    if (!canvas) return place(list, d.id, null, true);
    const box = canvas.getBoundingClientRect();
    const x = d.x - box.left;
    const y = d.y - box.top;
    const own = rects.current.get(d.id);
    const alreadyIn = list.some(w => w.id === d.id && isShownWidget(w));
    // Over its own slot: stay put. Without this a card would swap back and forth across a row.
    if (alreadyIn && own && inside(own, x, y)) return list;

    // Anywhere else, the row this drag may have started is undone first, and
    // made again only while the pointer is on a new-row strip.
    const base = list.filter(i => i.id !== d.newBreakId);
    for (const [key, r] of rects.current) {
      if (key.startsWith('new:') && inside(r, x, y)) return startRowAfter(base, d.id, key.slice(4), d.newBreakId);
    }
    list = base;

    let best: { id: string; r: FlipRect; d: number } | null = null;
    for (const w of list) {
      if (!isShownWidget(w) || w.id === d.id) continue;
      const r = rects.current.get(w.id);
      if (!r) continue;
      const gap = distance(r, x, y);
      if (!best || gap < best.d) best = { id: w.id, r, d: gap };
    }
    if (!best) return place(list, d.id, null, true);
    const { r } = best;
    const wideTarget = r.width > box.width * 0.6;
    const after = wideTarget || y < r.top || y > r.top + r.height
      ? y > r.top + r.height / 2
      : x > r.left + r.width / 2;
    return place(list, d.id, best.id, after);
  };

  const onDragMove = (e: PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    d.x = e.clientX;
    d.y = e.clientY;
    if (!d.active) {
      if (Math.hypot(d.x - d.startX, d.y - d.startY) < DRAG_THRESHOLD) return;
      d.active = true;
      setDraftBoth(d.base);
    }
    e.preventDefault();
    const zone: Zone = within(scrollRef.current, d.x, d.y) ? 'canvas' : within(libraryRef.current, d.x, d.y) ? 'library' : null;
    d.removing = d.source === 'canvas' && zone === 'library';
    positionGhost(d);

    setDragging(prev => (prev && prev.zone === zone ? prev : { id: d.id, source: d.source, zone, width: d.width, height: d.height }));

    const current = draftRef.current ?? d.base;
    let next: LayoutItem[];
    if (zone === 'canvas') next = layoutFor(d, current);
    // A new widget carried back out of the preview is not added after all.
    else if (d.source === 'library') next = d.base;
    else next = current;
    if (signature(next) !== signature(current)) setDraftBoth(next);
  };

  const endDrag = (drop: boolean) => {
    const d = dragRef.current;
    dragRef.current = null;
    listeners.detach();
    const zone = dragging?.zone ?? null;
    const result = draftRef.current;
    setDragging(null);
    setDraftBoth(null);
    if (!d?.active) return false;
    if (!drop || !result) return true;

    const overLibrary = d.source === 'canvas' && within(libraryRef.current, d.x, d.y);
    if (overLibrary) {
      commit(hide(d.base, d.id), `Removed ${titleOf(d.id)}`);
    } else if (d.source === 'library' && (zone === 'canvas' || within(scrollRef.current, d.x, d.y))) {
      commit(result, `Added ${titleOf(d.id)}`);
      setFlashId(d.id);
    } else if (d.source === 'canvas') {
      focusAfter.current = d.id;
      commit(result);
    }
    return true;
  };

  useLayoutEffect(() => { handlers.current = { onDragMove, endDrag }; });

  const startDrag = (e: React.PointerEvent<HTMLElement>, id: string, source: DragState['source']) => {
    if (e.button !== 0 || dragRef.current) return;
    const target = e.target as HTMLElement;
    if (target.closest('button, input, a')) return;
    // On a touch screen a finger on a card is a scroll, so only the grip picks one up.
    if (e.pointerType === 'touch' && !target.closest('[data-grip]')) return;
    const r = e.currentTarget.getBoundingClientRect();
    const widget = widgets.find(w => w.id === id);
    const wide = widget && !isRowBreak(widget) ? isWide(widget) : false;
    // A card from the library is carried at roughly the size it will take in the preview.
    const width = source === 'canvas' ? r.width : wide ? 280 : 150;
    const height = source === 'canvas' ? r.height : wide ? 64 : 120;
    dragRef.current = {
      id,
      source,
      startX: e.clientX,
      startY: e.clientY,
      x: e.clientX,
      y: e.clientY,
      grabX: source === 'canvas' ? e.clientX - r.left : width / 2,
      grabY: source === 'canvas' ? e.clientY - r.top : Math.min(24, height / 2),
      width,
      height,
      active: false,
      removing: false,
      newBreakId: newRowBreakId(widgets),
      base: widgets,
    };
    listeners.attach();
  };

  // Tidy up if the editor closes mid-drag.
  useEffect(() => () => listeners.detach(), [listeners]);

  // No text selection flickering across the page while a card is carried.
  useEffect(() => {
    if (!dragging) return;
    const body = document.body.style;
    body.userSelect = 'none';
    return () => { body.userSelect = ''; };
  }, [dragging]);

  // Carrying a card to the top or bottom edge of the preview scrolls it.
  useEffect(() => {
    if (!dragging) return;
    let frame = 0;
    const tick = () => {
      const d = dragRef.current;
      const el = scrollRef.current;
      if (d?.active && el) {
        const r = el.getBoundingClientRect();
        if (d.x >= r.left && d.x <= r.right) {
          if (d.y < r.top + EDGE_SCROLL_PX) el.scrollTop -= 10;
          else if (d.y > r.bottom - EDGE_SCROLL_PX) el.scrollTop += 10;
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [dragging]);

  // The card appears under the pointer on the frame it is picked up, not one move later.
  useLayoutEffect(() => {
    if (dragRef.current?.active) positionGhost(dragRef.current);
  }, [dragging]);

  // Undo and redo work wherever focus is while the editor is open, including
  // after a drag has taken the focused card away.
  const history = useRef({ undo, redo });
  useLayoutEffect(() => { history.current = { undo, redo }; });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement | null)?.closest?.('input, textarea')) return;
      if (!(e.ctrlKey || e.metaKey)) return;
      const key = e.key.toLowerCase();
      if (key === 'z') {
        e.preventDefault();
        if (e.shiftKey) history.current.redo();
        else history.current.undo();
      } else if (key === 'y') {
        e.preventDefault();
        history.current.redo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const onCardKey = (e: React.KeyboardEvent, id: string) => {
    if (e.target !== e.currentTarget) return;
    if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowUp')) {
      e.preventDefault();
      move(id, -1);
    } else if (e.altKey && (e.key === 'ArrowRight' || e.key === 'ArrowDown')) {
      e.preventDefault();
      move(id, 1);
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      remove(id);
    }
  };

  const carried = dragging ? ALL_WIDGETS.find(w => w.id === dragging.id) ?? null : null;
  const removing = dragging?.source === 'canvas' && dragging.zone === 'library';
  const adding = dragging?.source === 'library' && dragging.zone === 'canvas';

  const q = query.trim().toLowerCase();
  const matches = (w: WidgetConfig) =>
    !q || w.title.toLowerCase().includes(q) || WIDGET_INFO[w.type].description.toLowerCase().includes(q);
  const available = widgets.filter(w => !isRowBreak(w) && !w.enabled).length;
  // The library keeps one fixed order, so a widget is where it was last time whatever the layout.
  const library = ALL_WIDGETS.map(a => widgets.find((w): w is WidgetConfig => w.id === a.id && !isRowBreak(w)) ?? a);

  return (
    <Modal
      onClose={onClose}
      labelledBy="widget-editor-title"
      className="tile w-full max-w-6xl h-auto! lg:h-[min(90vh,54rem)]! flex flex-col lg:overflow-hidden!"
    >
      <div className="flex flex-col lg:min-h-0 lg:h-full">
        {/* Header */}
        <div className="flex items-center gap-3 px-5 sm:px-6 py-4 border-b border-line">
          <div className="hidden sm:grid place-items-center w-10 h-10 rounded-xl bg-alt-soft text-alt-text shrink-0">
            <Blocks className="w-5 h-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 id="widget-editor-title" className="text-lg font-bold text-ink leading-tight">Customize your dashboard</h2>
            <p className="text-xs text-ink-3 mt-0.5">
              <span className="hidden sm:inline">Drag to arrange. Everything saves to this browser as you go.</span>
              <span className="sm:hidden">Tap a card to move or remove it.</span>
            </p>
          </div>
          <div className="flex items-center gap-1">
            <IconButton label="Undo (Ctrl+Z)" onClick={undo} disabled={past.length === 0}><Undo2 className="w-4 h-4" /></IconButton>
            <IconButton label="Redo (Ctrl+Shift+Z)" onClick={redo} disabled={future.length === 0}><Redo2 className="w-4 h-4" /></IconButton>
            <span className="w-px h-6 bg-line mx-1" aria-hidden="true" />
            <IconButton label="Close" onClick={onClose}><X className="w-5 h-5" /></IconButton>
          </div>
        </div>

        <div className="flex-1 lg:min-h-0 grid grid-cols-1 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
          {/* The miniature dashboard */}
          <section aria-labelledby="widget-editor-preview" className="flex flex-col lg:min-h-0 lg:border-r border-line">
            <div className="flex items-baseline justify-between gap-3 px-5 sm:px-6 pt-4 pb-2">
              <h3 id="widget-editor-preview" className="text-xs font-bold uppercase tracking-[0.18em] text-ink-3">
                Your dashboard
                <span className="ml-2 normal-case tracking-normal font-semibold text-ink-4">
                  {onScreen.length} {onScreen.length === 1 ? 'widget' : 'widgets'}
                </span>
              </h3>
              <div className="flex items-center gap-3">
                <span
                  className="hidden xl:inline text-[11px] text-ink-4"
                  title="Each row gets the tiles across it asks for where the screen is wide enough, and fewer where it is not. Phones stack them."
                >
                  Wide-screen view · narrower screens stack
                </span>
                <button
                  onClick={() => { setTab('templates'); setSaveRequest(n => n + 1); }}
                  className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-semibold bg-accent-soft text-accent-text border border-accent-line hover:bg-accent-strong hover:text-accent-ink transition"
                >
                  <Save className="w-3.5 h-3.5" /> Save layout
                </button>
              </div>
            </div>
            <div
              ref={scrollRef}
              className={`relative flex-1 min-h-[16rem] lg:min-h-0 lg:overflow-y-auto overscroll-contain mx-3 sm:mx-4 mb-4 rounded-2xl border-2 border-dashed p-3 transition-colors ${
                adding ? 'border-accent-line bg-accent-soft' : 'border-transparent bg-well-deep/60'
              }`}
              style={{ backgroundImage: 'radial-gradient(var(--line) 1px, transparent 1px)', backgroundSize: '16px 16px' }}
            >
              {onScreen.length === 0 ? (
                <EmptyCanvas onBrowseTemplates={() => setTab('templates')} />
              ) : (
                <ol ref={canvasRef} className="grid grid-cols-60 gap-2 content-start" aria-label="Widgets on your dashboard, in order">
                  {rows.map((row, r) => (
                    <React.Fragment key={row.key}>
                      {row.tiles && (
                        <li data-flip-id={`row:${row.key}`} className="col-span-60 min-w-0">
                          <RowHeader
                            row={row}
                            canJoin={!!row.rowBreak && !!rows[r - 1]?.tiles}
                            onColumns={columns => setRowColumns(row, columns)}
                            onJoin={() => joinRow(row)}
                            onSplit={() => splitBefore(row.widgets[Math.ceil(row.widgets.length / 2)].id)}
                          />
                        </li>
                      )}
                      {row.widgets.map((w, inRow) => {
                        const i = onScreen.indexOf(w);
                        const isCarried = carried?.id === w.id;
                        const span = row.tiles ? COLUMN_SPAN[row.columns] : COLUMN_SPAN[1];
                        return (
                          <li key={w.id} data-flip-id={w.id} className={`${span} ${PREVIEW_HEIGHT[w.type] ?? 'h-32'} min-w-0`}>
                            <div
                              data-card={w.id}
                              tabIndex={0}
                              role="group"
                              aria-roledescription="movable widget"
                              aria-label={`${w.title}, ${i + 1} of ${onScreen.length}`}
                              aria-describedby="widget-editor-card-help"
                              onPointerDown={e => startDrag(e, w.id, 'canvas')}
                              onKeyDown={e => onCardKey(e, w.id)}
                              className={`group relative h-full rounded-xl outline-none transition-[opacity,box-shadow] duration-150 cursor-grab active:cursor-grabbing focus:ring-2 focus:ring-accent ${
                                isCarried && removing ? 'opacity-40' : ''
                              } ${flashId === w.id ? 'animate-widget-flash' : ''}`}
                            >
                              {isCarried ? (
                                <div className="h-full rounded-xl border-2 border-dashed border-accent bg-accent-soft grid place-items-center">
                                  <span className="text-[11px] font-semibold text-accent-text">{removing ? 'Removing' : 'Drop here'}</span>
                                </div>
                              ) : (
                                <MiniCard widget={w} wide={isWide(w)} />
                              )}
                              {!isCarried && (
                                <div className="absolute top-1.5 right-1.5 flex items-center gap-0.5 rounded-lg bg-card/90 border border-line shadow-sm p-0.5 opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto transition-opacity">
                                  <span data-grip className="hidden pointer-coarse:grid place-items-center w-7 h-7 text-ink-3 touch-none" aria-hidden="true">
                                    <GripVertical className="w-4 h-4" />
                                  </span>
                                  <CardButton label={`Move ${w.title} earlier`} onClick={() => move(w.id, -1)} disabled={i === 0}>
                                    <ChevronLeft className="w-3.5 h-3.5" />
                                  </CardButton>
                                  <CardButton label={`Move ${w.title} later`} onClick={() => move(w.id, 1)} disabled={i === onScreen.length - 1}>
                                    <ChevronRight className="w-3.5 h-3.5" />
                                  </CardButton>
                                  {row.tiles && inRow > 0 && (
                                    <CardButton label={`Start a new row at ${w.title}`} onClick={() => splitBefore(w.id)}>
                                      <CornerDownLeft className="w-3.5 h-3.5" />
                                    </CardButton>
                                  )}
                                  <CardButton label={`Remove ${w.title}`} onClick={() => remove(w.id)} danger>
                                    <X className="w-3.5 h-3.5" />
                                  </CardButton>
                                </div>
                              )}
                            </div>
                          </li>
                        );
                      })}
                      {(() => {
                        const anchor = [...row.widgets].reverse().find(w => w.id !== carriedTile?.id);
                        return showNewRowStrips && row.tiles && anchor ? (
                          <li data-flip-id={`new:${anchor.id}`} className="col-span-60 h-9 min-w-0" aria-hidden="true">
                            <div className="h-full rounded-lg border-2 border-dashed border-accent-line bg-accent-soft/40 grid place-items-center text-[11px] font-semibold text-accent-text">
                              <span className="inline-flex items-center gap-1.5">
                                <CornerDownLeft className="w-3.5 h-3.5" /> Drop here for a new row
                              </span>
                            </div>
                          </li>
                        ) : null;
                      })()}
                    </React.Fragment>
                  ))}
                </ol>
              )}
            </div>
            <p id="widget-editor-card-help" className="sr-only">
              Alt with the arrow keys moves this widget, past the end of a row into the next. Delete removes it.
              Use a row's Split button, or this card's new-row button, to start another row of tiles.
            </p>
          </section>

          {/* Everything that can go on it */}
          <section aria-label="Add to your dashboard" ref={libraryRef} className="relative flex flex-col lg:min-h-0 border-t lg:border-t-0 border-line">
            <div className="px-5 sm:px-6 pt-4 pb-3 space-y-3">
              <div role="tablist" aria-label="Add widgets or start from a template" className="grid grid-cols-2 p-1 rounded-xl bg-well-deep border border-line">
                <TabButton selected={tab === 'widgets'} onClick={() => { setTab('widgets'); setSaveRequest(0); }} controls="widget-editor-library">
                  <Plus className="w-4 h-4" /> Widgets
                  {available > 0 && (
                    <span className={`ml-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                      tab === 'widgets' ? 'bg-accent-ink/20 text-accent-ink' : 'bg-accent-soft text-accent-text'
                    }`}>
                      {available}
                    </span>
                  )}
                </TabButton>
                <TabButton selected={tab === 'templates'} onClick={() => setTab('templates')} controls="widget-editor-templates">
                  <LayoutTemplate className="w-4 h-4" /> Layouts
                </TabButton>
              </div>
              {tab === 'widgets' && (
                <label className="flex items-center gap-2 px-3 h-10 rounded-xl bg-well border border-line focus-within:border-accent-line transition">
                  <Search className="w-4 h-4 text-ink-4 shrink-0" />
                  <input
                    type="search"
                    value={query}
                    onChange={e => setQuery(e.target.value)}
                    placeholder="Search widgets"
                    aria-label="Search widgets"
                    className="flex-1 min-w-0 bg-transparent text-sm text-ink placeholder:text-ink-4 outline-none"
                  />
                </label>
              )}
            </div>

            <div className="flex-1 lg:min-h-0 lg:overflow-y-auto overscroll-contain px-5 sm:px-6 pb-5">
              {tab === 'widgets' ? (
                <div id="widget-editor-library" role="tabpanel" className="space-y-5">
                  {WIDGET_CATEGORIES.map(cat => {
                    const items = library.filter(w => WIDGET_INFO[w.type].category === cat.id && matches(w));
                    if (items.length === 0) return null;
                    return (
                      <div key={cat.id}>
                        <h4 className="text-[11px] font-bold uppercase tracking-[0.18em] text-ink-4 mb-2">{cat.label}</h4>
                        <ul className="space-y-2">
                          {items.map(w => (
                            <li key={w.id}>
                              <LibraryCard
                                widget={w}
                                onPointerDown={e => { if (!w.enabled) startDrag(e, w.id, 'library'); }}
                                onToggle={() => (w.enabled ? remove(w.id) : add(w.id))}
                              />
                            </li>
                          ))}
                        </ul>
                      </div>
                    );
                  })}
                  {library.every(w => !matches(w)) && (
                    <p className="text-sm text-ink-3 text-center py-8">No widget matches “{query}”.</p>
                  )}
                </div>
              ) : (
                <div id="widget-editor-templates" role="tabpanel" className="space-y-6">
                  <SavedLayouts signedIn={signedIn} widgets={widgets} onApply={chooseSaved} onNotify={notify} saveRequest={saveRequest} />
                  <div className="space-y-2.5">
                    <h4 className="text-[11px] font-bold uppercase tracking-[0.18em] text-ink-4">Templates</h4>
                    <p className="text-xs text-ink-3">A template picks which widgets are on and their order. Start from one, then make it yours. You can undo this.</p>
                    {WIDGET_TEMPLATES.map(t => (
                      <LayoutCard
                        key={t.id}
                        name={t.name}
                        description={t.description}
                        layout={applyTemplate(t.ids)}
                        current={matchesTemplate(widgets, t.ids)}
                        onApply={() => chooseTemplate(t)}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Carrying a card off the preview and over here takes it off the dashboard. */}
            {removing && (
              <div className="absolute inset-2 rounded-2xl border-2 border-dashed border-danger-line bg-danger-soft backdrop-blur-sm grid place-items-center pointer-events-none animate-fade-in">
                <div className="flex flex-col items-center gap-2 text-danger-text">
                  <Trash2 className="w-8 h-8" />
                  <span className="font-semibold">Drop to remove</span>
                </div>
              </div>
            )}
          </section>
        </div>

        {/* Footer. Pinned to the bottom on a phone, where the whole editor scrolls. */}
        <div className="sticky bottom-0 lg:static flex items-center justify-between gap-3 px-5 sm:px-6 py-3 border-t border-line max-lg:bg-card/95 max-lg:backdrop-blur rounded-b-[var(--tile-radius)]">
          {toast ? (
            <div key={toast.key} className="flex items-center gap-2 min-w-0 animate-toast-in">
              <Check className="w-4 h-4 text-good-text shrink-0" />
              <span className="text-sm text-ink truncate">{toast.text}</span>
              {toast.undoable && past.length > 0 && (
                <button onClick={undo} className="shrink-0 px-2.5 py-1 rounded-lg text-sm font-semibold text-accent-text hover:bg-accent-soft transition">
                  Undo
                </button>
              )}
            </div>
          ) : (
            <>
              <p className="hidden md:flex items-center gap-4 text-[11px] text-ink-4">
                <span className="inline-flex items-center gap-1.5"><MousePointerClick className="w-3.5 h-3.5" /> Drag cards to move them</span>
                <span><Kbd>Alt</Kbd>+<Kbd>←</Kbd><Kbd>→</Kbd> move</span>
                <span><Kbd>Del</Kbd> remove</span>
                <span><Kbd>Ctrl</Kbd>+<Kbd>Z</Kbd> undo</span>
              </p>
              <span className="md:hidden inline-flex items-center gap-1.5 text-xs text-ink-3">
                <Check className="w-3.5 h-3.5 text-good-text" /> Saves as you go
              </span>
            </>
          )}
          <button
            onClick={onClose}
            className="shrink-0 px-6 py-2 rounded-xl bg-accent-strong text-accent-ink font-semibold text-sm hover:bg-accent transition shadow-lg shadow-accent-soft"
          >
            Done
          </button>
        </div>
      </div>

      <div className="sr-only" aria-live="polite">{announcement}</div>

      {carried && createPortal(
        <div
          ref={ghostRef}
          className="fixed left-0 top-0 z-[70] pointer-events-none rounded-xl shadow-2xl ring-2 ring-accent"
          style={{ width: dragging?.width, height: dragging?.height, opacity: removing ? 0.7 : 1, transition: 'opacity 150ms' }}
        >
          <MiniCard widget={carried} wide={isWide(carried)} />
        </div>,
        document.body,
      )}
    </Modal>
  );
};

/** One widget in the miniature: its card surface, icon, name and a drawing of its shape. */
const MiniCard: React.FC<{ widget: WidgetConfig; wide: boolean }> = ({ widget, wide }) => {
  const Icon = WIDGET_ICON[widget.type];
  const tone = WIDGET_TONE[widget.type];
  return (
    <div
      className={`h-full overflow-hidden rounded-xl border flex min-w-0 ${wide ? 'flex-row items-center gap-3 px-3 py-2' : 'flex-col p-2.5'}`}
      style={{ background: 'var(--tile-bg)', borderColor: 'var(--tile-border)' }}
    >
      <div className={`flex items-center gap-1.5 min-w-0 ${wide ? 'w-36 shrink-0' : ''}`}>
        <span className="grid place-items-center w-6 h-6 rounded-md shrink-0" style={{ color: tone, background: toneWash(tone) }}>
          <Icon className="w-3.5 h-3.5" />
        </span>
        <span className="text-[11px] font-semibold text-ink-2 truncate">{widget.title}</span>
      </div>
      <div className={`flex-1 min-h-0 min-w-0 ${wide ? 'h-full py-0.5' : 'mt-1.5 px-2 pb-1'}`} style={{ color: tone }}>
        <WidgetGlyph type={widget.type} />
      </div>
    </div>
  );
};

/** A widget in the library: what it is, how much room it takes, and a button to add or remove it. */
const LibraryCard: React.FC<{
  widget: WidgetConfig;
  onPointerDown: (e: React.PointerEvent<HTMLElement>) => void;
  onToggle: () => void;
}> = ({ widget, onPointerDown, onToggle }) => {
  const Icon = WIDGET_ICON[widget.type];
  const tone = WIDGET_TONE[widget.type];
  const wide = isWide(widget);
  return (
    <div
      onPointerDown={onPointerDown}
      className={`group flex items-center gap-3 p-2.5 pr-3 rounded-xl border transition ${
        widget.enabled
          ? 'bg-well border-line'
          : 'bg-fill-soft border-line hover:border-line-strong hover:bg-fill cursor-grab active:cursor-grabbing'
      }`}
    >
      <div className="relative grid place-items-center w-14 h-12 rounded-lg shrink-0 overflow-hidden" style={{ background: toneWash(tone, 12), color: tone }}>
        <div className="absolute inset-1.5 opacity-40"><WidgetGlyph type={widget.type} /></div>
        <Icon className="relative w-5 h-5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 min-w-0">
          <span className="text-sm font-semibold text-ink">{widget.title}</span>
          <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-fill text-ink-3">
            {wide ? 'Full width' : 'Tile'}
          </span>
        </div>
        <p className="text-xs text-ink-3 leading-snug mt-0.5 line-clamp-2">{WIDGET_INFO[widget.type].description}</p>
      </div>
      <button
        onClick={onToggle}
        aria-label={widget.enabled ? `Remove ${widget.title}` : `Add ${widget.title}`}
        className={`group/btn shrink-0 inline-flex items-center justify-center gap-1 h-8 min-w-[4.75rem] px-2.5 rounded-lg text-xs font-semibold border transition ${
          widget.enabled
            ? 'bg-good-soft text-good-text border-good-line hover:bg-danger-soft hover:text-danger-text hover:border-danger-line'
            : 'bg-accent-strong text-accent-ink border-transparent hover:bg-accent'
        }`}
      >
        {widget.enabled ? (
          <>
            <Check className="w-3.5 h-3.5 group-hover/btn:hidden group-focus-visible/btn:hidden" />
            <X className="w-3.5 h-3.5 hidden group-hover/btn:block group-focus-visible/btn:block" />
            <span className="group-hover/btn:hidden group-focus-visible/btn:hidden">Added</span>
            <span className="hidden group-hover/btn:inline group-focus-visible/btn:inline">Remove</span>
          </>
        ) : (
          <><Plus className="w-3.5 h-3.5" /> Add</>
        )}
      </button>
    </div>
  );
};

/** A layout to switch to, drawn as a thumbnail of the rows it would give. */
const LayoutCard: React.FC<{
  name: string;
  description?: string;
  layout: LayoutItem[];
  current: boolean;
  onApply: () => void;
  /** Buttons of its own, beside the card rather than inside it. */
  actions?: React.ReactNode;
}> = ({ name, description, layout, current, onApply, actions }) => {
  const rows = layoutRows(layout);
  const count = layout.filter(isShownWidget).length;
  return (
    <div
      className={`flex items-stretch rounded-xl border transition ${
        current ? 'border-accent-line bg-accent-soft' : 'border-line bg-fill-soft hover:bg-fill hover:border-line-strong'
      }`}
    >
      <button onClick={onApply} aria-pressed={current} className="min-w-0 flex-1 text-left flex gap-4 p-3 rounded-xl">
        <div className="w-28 shrink-0 rounded-lg bg-well-deep border border-line p-1.5 space-y-1" aria-hidden="true">
          {rows.map(row => (
            <div key={row.key} className="grid gap-1" style={{ gridTemplateColumns: `repeat(${row.columns}, minmax(0, 1fr))` }}>
              {row.widgets.map(w => (
                <div
                  key={w.id}
                  className={`rounded-[3px] ${isWide(w) ? 'h-2' : 'h-4'}`}
                  style={{ background: toneWash(WIDGET_TONE[w.type], 55) }}
                />
              ))}
            </div>
          ))}
        </div>
        <div className="min-w-0 flex-1 py-0.5">
          <div className="flex items-center gap-2 min-w-0">
            <span className="font-semibold text-sm text-ink truncate">{name}</span>
            {current && (
              <span className="shrink-0 inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-accent-text">
                <Check className="w-3 h-3" /> Current
              </span>
            )}
          </div>
          {description && <p className="text-xs text-ink-3 mt-0.5 leading-snug">{description}</p>}
          <p className="text-[11px] text-ink-4 mt-1.5">{count} {count === 1 ? 'widget' : 'widgets'}</p>
        </div>
      </button>
      {actions && <div className="flex flex-col justify-center items-stretch gap-1 pr-2 shrink-0">{actions}</div>}
    </div>
  );
};

/**
 * The layouts a signed-in viewer has saved to their account. None is applied
 * until it is picked here, so a saved layout is tried, and dropped with Undo,
 * like any template.
 */
const SavedLayouts: React.FC<{
  signedIn: boolean;
  widgets: LayoutItem[];
  onApply: (saved: SavedLayout) => void;
  onNotify: (text: string) => void;
  /** Changes when the Save button over the preview is pressed. */
  saveRequest: number;
}> = ({ signedIn, widgets, onApply, onNotify, saveRequest }) => {
  const [layouts, setLayouts] = useState<SavedLayout[] | null>(null);
  const [error, setError] = useState('');
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  // Starts at nothing seen: this mounts when the tab opens, often because of that very press.
  const [seenRequest, setSeenRequest] = useState(0);

  if (saveRequest > 0 && saveRequest !== seenRequest) {
    setSeenRequest(saveRequest);
    setNaming(true);
    setError('');
  }

  // On a phone the library sits below the preview, so bring the box into view.
  useEffect(() => {
    if (saveRequest > 0) rootRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [saveRequest]);

  useEffect(() => {
    if (!signedIn) return;
    let live = true;
    api.savedLayouts()
      .then(list => { if (live) setLayouts(list); })
      .catch(e => { if (live) { setLayouts([]); setError(e.message); } });
    return () => { live = false; };
  }, [signedIn]);

  if (!signedIn) {
    return (
      <div ref={rootRef} className="space-y-2">
        <h4 className="text-[11px] font-bold uppercase tracking-[0.18em] text-ink-4">My layouts</h4>
        <p className={`text-xs rounded-lg ${saveRequest ? 'text-accent-text bg-accent-soft border border-accent-line px-3 py-2' : 'text-ink-3'}`}>
          Sign in to save your own.
        </p>
      </div>
    );
  }

  const current = signature(widgets);
  const trimmed = name.trim().replace(/\s+/g, ' ');
  // A name already in use replaces that layout rather than making a second of the same name.
  const sameName = layouts?.find(l => l.name.toLowerCase() === trimmed.toLowerCase()) ?? null;

  const stopNaming = () => { setNaming(false); setName(''); };

  const save = async (target: SavedLayout | null, as: string) => {
    setBusy(true);
    setError('');
    try {
      const saved = await api.saveLayout(as, serializeLayout(widgets), target?.id);
      setLayouts(list => [saved, ...(list ?? []).filter(l => l.id !== saved.id)]);
      onNotify(target ? `Updated ${as}` : `Saved ${as}`);
      stopNaming();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the layout');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (saved: SavedLayout) => {
    setConfirmDelete(null);
    setError('');
    try {
      await api.deleteLayout(saved.id);
      setLayouts(list => (list ?? []).filter(l => l.id !== saved.id));
      onNotify(`Deleted ${saved.name}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete the layout');
    }
  };

  return (
    <div ref={rootRef} className="space-y-2.5">
      <div className="flex items-center justify-between gap-3 min-h-8">
        <h4 className="text-[11px] font-bold uppercase tracking-[0.18em] text-ink-4">My layouts</h4>
        {!naming && (
          <button
            onClick={() => { setNaming(true); setError(''); }}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-semibold bg-accent-soft text-accent-text border border-accent-line hover:bg-accent-strong hover:text-accent-ink transition"
          >
            <Save className="w-3.5 h-3.5" /> Save this layout
          </button>
        )}
      </div>

      {naming && (
        <form
          onSubmit={e => { e.preventDefault(); if (trimmed && !busy) save(sameName, trimmed); }}
          className="flex items-center gap-2 p-1.5 pl-3 rounded-xl bg-well border border-line focus-within:border-accent-line transition"
        >
          <input
            autoFocus
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); stopNaming(); } }}
            maxLength={60}
            placeholder="Name it, e.g. Phone"
            aria-label="Layout name"
            className="flex-1 min-w-0 h-8 bg-transparent text-sm text-ink placeholder:text-ink-4 outline-none"
          />
          <button
            type="submit"
            disabled={!trimmed || busy}
            className="shrink-0 inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-semibold bg-accent-strong text-accent-ink hover:bg-accent disabled:opacity-50 transition"
          >
            {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {sameName ? 'Replace' : 'Save'}
          </button>
          <button
            type="button"
            onClick={stopNaming}
            className="shrink-0 h-8 px-2.5 rounded-lg text-xs font-semibold text-ink-3 hover:text-ink hover:bg-fill transition"
          >
            Cancel
          </button>
        </form>
      )}

      {error && <p role="alert" className="text-xs text-danger-text">{error}</p>}

      {layouts === null ? (
        <p className="flex items-center gap-2 text-xs text-ink-3"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading</p>
      ) : layouts.length === 0 ? (
        !naming && <p className="text-xs text-ink-3">None saved yet.</p>
      ) : (
        layouts.map(saved => {
          const layout = mergeLayout(saved.layout);
          const isCurrent = signature(layout) === current;
          return (
            <LayoutCard
              key={saved.id}
              name={saved.name}
              layout={layout}
              current={isCurrent}
              onApply={() => onApply(saved)}
              actions={confirmDelete === saved.id ? (
                <>
                  <button
                    onClick={() => remove(saved)}
                    className="h-7 px-2 rounded-md text-[11px] font-bold bg-danger-soft text-danger-text border border-danger-line hover:border-danger transition"
                  >
                    Delete
                  </button>
                  <button
                    onClick={() => setConfirmDelete(null)}
                    className="h-7 px-2 rounded-md text-[11px] font-semibold text-ink-3 hover:text-ink hover:bg-fill transition"
                  >
                    Keep
                  </button>
                </>
              ) : (
                <>
                  {!isCurrent && (
                    <SideButton label={`Save the dashboard as it is now over ${saved.name}`} onClick={() => save(saved, saved.name)} disabled={busy}>
                      <Save className="w-4 h-4" />
                    </SideButton>
                  )}
                  <SideButton label={`Delete ${saved.name}`} onClick={() => setConfirmDelete(saved.id)} danger>
                    <Trash2 className="w-4 h-4" />
                  </SideButton>
                </>
              )}
            />
          );
        })
      )}
    </div>
  );
};

/** A button beside a layout card. Unlike the preview's card buttons, these are in the tab order. */
const SideButton: React.FC<{ label: string; onClick: () => void; disabled?: boolean; danger?: boolean; children: React.ReactNode }> = ({
  label, onClick, disabled, danger, children,
}) => (
  <button
    onClick={onClick}
    disabled={disabled}
    aria-label={label}
    title={label}
    className={`grid place-items-center w-8 h-8 rounded-lg transition disabled:opacity-40 ${
      danger ? 'text-ink-3 hover:text-danger-text hover:bg-danger-soft' : 'text-ink-3 hover:text-ink hover:bg-fill'
    }`}
  >
    {children}
  </button>
);

/**
 * The strip above each row of tiles in the preview: how many sit across it, and
 * a way to fold it back into the row above when it was split off from one.
 */
const RowHeader: React.FC<{
  row: LayoutRow;
  canJoin: boolean;
  onColumns: (columns: TilesPerRow | null) => void;
  onJoin: () => void;
  onSplit: () => void;
}> = ({ row, canJoin, onColumns, onJoin, onSplit }) => {
  const fixed = row.rowBreak?.columns ?? null;
  const options: { value: TilesPerRow | null; label: string; hint: string }[] = [
    { value: null, label: 'Fit', hint: 'All the tiles in one row, where the screen has room; fewer across where it has not' },
    ...TILES_PER_ROW_OPTIONS.map(n => ({ value: n, label: String(n), hint: `Up to ${n} across, fewer where the screen is narrow` })),
  ];
  return (
    <div className="flex items-center gap-2 h-7 pl-1">
      <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-ink-4 shrink-0">
        Tile row <span className="normal-case tracking-normal font-semibold">· {row.widgets.length}</span>
      </span>
      <span className="h-px flex-1 bg-line" aria-hidden="true" />
      <div role="radiogroup" aria-label="Tiles across this row" className="flex p-0.5 rounded-md bg-well-deep border border-line">
        {options.map(o => (
          <button
            key={o.label}
            role="radio"
            aria-checked={fixed === o.value}
            title={o.hint}
            onClick={() => onColumns(o.value)}
            className={`h-5 px-1.5 min-w-5 rounded text-[10px] font-bold transition ${
              fixed === o.value ? 'bg-accent-strong text-accent-ink' : 'text-ink-3 hover:text-ink hover:bg-fill'
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
      {row.widgets.length > 1 && (
        <button
          onClick={onSplit}
          title="Split into two rows"
          aria-label="Split into two rows"
          className="inline-flex items-center gap-1 h-6 px-1.5 rounded-md text-[10px] font-bold text-ink-3 hover:text-ink hover:bg-fill transition"
        >
          <Rows2 className="w-3.5 h-3.5" /> Split
        </button>
      )}
      {canJoin && (
        <button
          onClick={onJoin}
          title="Join with the row above"
          aria-label="Join with the row above"
          className="grid place-items-center w-6 h-6 rounded-md text-ink-3 hover:text-ink hover:bg-fill transition"
        >
          <Merge className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
};

const EmptyCanvas: React.FC<{ onBrowseTemplates: () => void }> = ({ onBrowseTemplates }) => (
  <div className="h-full min-h-[14rem] flex flex-col items-center justify-center text-center gap-3 px-6">
    <div className="grid place-items-center w-14 h-14 rounded-2xl bg-accent-soft text-accent-text">
      <Blocks className="w-7 h-7" />
    </div>
    <div>
      <p className="font-semibold text-ink">Your dashboard is empty</p>
      <p className="text-sm text-ink-3 mt-1">Drag widgets in from the library, or start from a template.</p>
    </div>
    <button onClick={onBrowseTemplates} className="mt-1 px-4 py-2 rounded-xl text-sm font-semibold bg-accent-soft text-accent-text border border-accent-line hover:bg-accent-strong hover:text-accent-ink transition">
      Browse templates
    </button>
  </div>
);

const IconButton: React.FC<{ label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }> = ({ label, onClick, disabled, children }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    aria-label={label}
    title={label}
    className="p-2 rounded-lg text-ink-3 hover:text-ink hover:bg-fill disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-ink-3 transition"
  >
    {children}
  </button>
);

const CardButton: React.FC<{ label: string; onClick: () => void; disabled?: boolean; danger?: boolean; children: React.ReactNode }> = ({
  label, onClick, disabled, danger, children,
}) => (
  <button
    onClick={onClick}
    disabled={disabled}
    aria-label={label}
    title={label}
    tabIndex={-1}
    className={`grid place-items-center w-7 h-7 pointer-fine:w-6 pointer-fine:h-6 rounded-md transition disabled:opacity-25 ${
      danger ? 'text-ink-3 hover:text-danger-text hover:bg-danger-soft' : 'text-ink-3 hover:text-ink hover:bg-fill'
    }`}
  >
    {children}
  </button>
);

const TabButton: React.FC<{ selected: boolean; onClick: () => void; controls: string; children: React.ReactNode }> = ({ selected, onClick, controls, children }) => (
  <button
    role="tab"
    aria-selected={selected}
    aria-controls={controls}
    onClick={onClick}
    className={`inline-flex items-center justify-center gap-1.5 h-9 rounded-lg text-sm font-semibold transition ${
      selected ? 'bg-accent-strong text-accent-ink shadow' : 'text-ink-3 hover:text-ink'
    }`}
  >
    {children}
  </button>
);

const Kbd: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <kbd className="inline-block min-w-[1.25rem] px-1 py-px mx-px rounded border border-line bg-fill-soft text-[10px] font-sans text-ink-3 text-center">
    {children}
  </kbd>
);

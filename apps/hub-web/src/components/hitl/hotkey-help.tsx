"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

/**
 * Shared keyboard contract for every human-in-the-loop gate.
 *
 * The gates used to disagree: image QC bound ←/→ AND j/k with Ctrl+Enter to
 * approve, the B-roll studio bound j/k with a plain `a`, and final QC had only
 * A/R/Space and no way to move at all. A VA who works all three all day had to
 * hold three different mental models — and only image QC had a help panel.
 *
 * Canonical bindings — every gate that uses this module honours them:
 *
 *   J / →      next item inside the gate (scene, block, …); on a gate whose
 *              item IS the job (final QC) it moves to the next job
 *   K / ←      previous item, same rule
 *   A          approve  (Ctrl+Enter also approves, everywhere)
 *   R          reject (final QC) / regenerate the selected item (image QC)
 *   S          skip — releases your claim and hands you the next item
 *   Space      play / pause
 *   Ctrl+N     next job in this queue        (HITLNavigation)
 *   Ctrl+P     previous job in this queue    (HITLNavigation)
 *   ?          the help overlay
 *
 * `?` is bound exactly ONCE per page no matter how many components ask for it:
 * every caller registers its rows in a module-level registry and the first
 * registrant renders one merged overlay. Two components on the same page (the
 * queue nav and the gate panel) therefore cannot stack two modals.
 */
export interface HotkeyRow {
  keys: string;
  description: string;
}

/** Bindings that mean the same thing on every gate. */
export const SHARED_HOTKEYS: HotkeyRow[] = [
  { keys: "A", description: "Approve" },
  { keys: "Ctrl+Enter", description: "Approve" },
  { keys: "S", description: "Skip (hands you the next item)" },
  { keys: "Space", description: "Play / pause" },
  { keys: "Ctrl+N", description: "Next job in this queue" },
  { keys: "Ctrl+P", description: "Previous job in this queue" },
  { keys: "?", description: "Show this panel" },
];

/**
 * True when the event target is a place the user is typing, so a hotkey handler
 * must keep its hands off. Shared so every gate agrees on what "typing" means —
 * contenteditable used to slip through the tagName checks.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    el.isContentEditable === true
  );
}

// ── Page-wide registry ───────────────────────────────────────────────────────

interface Registration {
  id: number;
  title: string;
  rows: HotkeyRow[];
}

let nextRegistrationId = 1;
const registrations = new Map<number, Registration>();
const subscribers = new Set<() => void>();

function notify() {
  for (const fn of subscribers) fn();
}

function ownerId(): number | null {
  let min: number | null = null;
  for (const id of registrations.keys()) {
    if (min === null || id < min) min = id;
  }
  return min;
}

/** Gate rows first (a gate may override a shared key), shared ones after. */
function mergedRows(): HotkeyRow[] {
  const out: HotkeyRow[] = [];
  const seen = new Set<string>();
  const ids = [...registrations.keys()].sort((a, b) => a - b);
  for (const id of ids) {
    for (const row of registrations.get(id)?.rows ?? []) {
      if (seen.has(row.keys)) continue;
      seen.add(row.keys);
      out.push(row);
    }
  }
  for (const row of SHARED_HOTKEYS) {
    if (seen.has(row.keys)) continue;
    seen.add(row.keys);
    out.push(row);
  }
  return out;
}

function mergedTitle(): string {
  const ids = [...registrations.keys()].sort((a, b) => a - b);
  for (const id of ids) {
    const reg = registrations.get(id);
    if (reg && reg.rows.length > 0) return reg.title;
  }
  const first = ids[0];
  return (
    (first !== undefined && registrations.get(first)?.title) || "Shortcuts"
  );
}

/**
 * Register this component's gate-specific hotkeys and get back:
 *  - `open()`  — for a toolbar button
 *  - `overlay` — the merged panel, non-null only for the first registrant so
 *                exactly one modal ever renders
 *
 * `?` toggles the panel and Escape closes it, bound once per page.
 */
export function useHotkeyHelp(
  title: string,
  rows: HotkeyRow[],
): { open: () => void; overlay: ReactNode } {
  const idRef = useRef<number>(0);
  if (idRef.current === 0) idRef.current = nextRegistrationId++;
  const id = idRef.current;

  const [, forceRender] = useState(0);
  const [isOpen, setIsOpen] = useState(false);

  // Register / unregister. Keeping the rows fresh happens below.
  useEffect(() => {
    registrations.set(id, { id, title, rows });
    const rerender = () => forceRender((n) => n + 1);
    subscribers.add(rerender);
    notify();
    return () => {
      registrations.delete(id);
      subscribers.delete(rerender);
      notify();
    };
    // Deliberately mount-only: rows/title are refreshed by the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Keep the registry's copy current without re-registering on every render.
  useEffect(() => {
    const reg = registrations.get(id);
    if (reg) {
      reg.title = title;
      reg.rows = rows;
    }
  });

  const owner = ownerId() === id;

  // Only the owner binds `?` — otherwise two components on one page would each
  // toggle their own copy of the panel.
  useEffect(() => {
    if (!owner) return;
    function onKey(e: KeyboardEvent) {
      if (isTypingTarget(e.target)) return;
      if (e.key === "?") {
        e.preventDefault();
        setIsOpen((v) => !v);
      } else if (e.key === "Escape") {
        setIsOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [owner]);

  const open = useCallback(() => {
    if (owner) {
      setIsOpen(true);
      return;
    }
    // A non-owner button still has to be able to open the one real panel.
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "?", bubbles: true }),
    );
  }, [owner]);

  const overlay =
    owner && isOpen ? (
      <HotkeyHelp
        open
        onClose={() => setIsOpen(false)}
        title={mergedTitle()}
        rows={mergedRows()}
      />
    ) : null;

  return { open, overlay };
}

/**
 * The one help overlay used by every gate. Rendered through `useHotkeyHelp`;
 * exported for tests and for any caller that manages its own open state.
 */
export function HotkeyHelp({
  open,
  onClose,
  title = "Keyboard shortcuts",
  rows,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  rows: HotkeyRow[];
}) {
  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 200,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0,0,0,0.7)",
        backdropFilter: "blur(8px)",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#151515",
          border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: 12,
          padding: 24,
          width: 380,
          maxHeight: "80vh",
          overflowY: "auto",
          boxShadow: "0 24px 80px rgba(0,0,0,0.5)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 18,
          }}
        >
          <h2
            style={{
              fontSize: 12,
              fontWeight: 700,
              color: "#e5e2e1",
              margin: 0,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
            }}
          >
            {title}
          </h2>
          <button
            onClick={onClose}
            aria-label="Close keyboard shortcuts"
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "rgba(205,195,215,0.5)",
              padding: 4,
            }}
          >
            <span
              className="material-symbols-outlined"
              style={{ fontSize: 18 }}
            >
              close
            </span>
          </button>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {rows.map((row) => (
            <div
              key={`${row.keys}:${row.description}`}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 16,
              }}
            >
              <kbd
                style={{
                  padding: "3px 8px",
                  background: "#0e0e0e",
                  border: "1px solid rgba(75,68,85,0.4)",
                  borderRadius: 4,
                  fontSize: 10,
                  fontFamily: "monospace",
                  color: "var(--v2-accent, #aaff00)",
                  fontWeight: 700,
                  whiteSpace: "nowrap",
                }}
              >
                {row.keys}
              </kbd>
              <span
                style={{
                  fontSize: 11,
                  color: "rgba(205,195,215,0.55)",
                  textAlign: "right",
                }}
              >
                {row.description}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Small toolbar button that opens the overlay — same affordance on every gate. */
export function HotkeyHelpButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title="Keyboard shortcuts (?)"
      aria-label="Keyboard shortcuts"
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 30,
        height: 30,
        borderRadius: 6,
        border: "1px solid rgba(255,255,255,0.12)",
        background: "rgba(255,255,255,0.04)",
        color: "rgba(205,195,215,0.7)",
        cursor: "pointer",
        flexShrink: 0,
      }}
    >
      <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
        keyboard
      </span>
    </button>
  );
}

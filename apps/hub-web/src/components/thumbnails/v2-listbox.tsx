"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { CSSProperties, ReactNode } from "react";

/**
 * Position the popup before the browser paints, so it never appears below the
 * fold for one frame and then jumps. `useLayoutEffect` warns when a client
 * component is server-rendered, which every one of these is, so fall back to
 * `useEffect` on the server where the measurement is meaningless anyway.
 */
const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

/**
 * V2Listbox — a real, fully styled dropdown.
 *
 * WHY THIS EXISTS: `<select>` renders its `<option>` popup with the operating
 * system's native widget. On Windows Chrome that popup is dark-grey-on-white
 * regardless of any CSS applied to the `<option>` elements — you cannot style
 * it. The shared `V2Select` in `_components/v2-select.tsx` is a styled wrapper
 * around a native `<select>`, so it has exactly this bug. The only fix is to
 * replace the control, which is what this does: a button + an absolutely
 * positioned list we render and style ourselves.
 *
 * Keyboard: Enter/Space/ArrowDown opens, Arrow keys move, Enter/Tab commits,
 * Escape closes, typing jumps to the first match. Closes on outside click.
 *
 * Placement: the popup opens below the control, and FLIPS ABOVE when there is
 * not enough room below. The owner, on a mode picker near the bottom of the
 * Create form: "it's like going very close to the water." A dropdown that opens
 * off the bottom of the viewport is not merely ugly — the options past the fold
 * cannot be clicked at all without scrolling the page, which closes nothing but
 * moves the control out from under the cursor.
 */

export interface V2ListboxOption {
  value: string;
  label: string;
  /** Muted second line, e.g. a category or a count. */
  hint?: string;
  /** Small square preview (an image URL) rendered left of the label. */
  thumbnailUrl?: string;
  /** Render this option's label in the given CSS font-family (font pickers). */
  fontFamily?: string;
  disabled?: boolean;
}

interface Props {
  value: string;
  onChange: (value: string) => void;
  options: V2ListboxOption[];
  label?: string;
  placeholder?: string;
  disabled?: boolean;
  /** Show a type-to-filter input inside the popup. Auto-on above 8 options. */
  searchable?: boolean;
  fullWidth?: boolean;
  style?: CSSProperties;
  /** Rendered under the control, e.g. a hint about the current selection. */
  footer?: ReactNode;
}

const TEXT_1 = "#e5e2e1";
const TEXT_2 = "#cdc3d7";

/** Tallest the scrolling option list is ever allowed to be. */
const LIST_MAX_HEIGHT = 288;
/** Never squeeze the list below this — a 2-row dropdown is worse than a flip. */
const LIST_MIN_HEIGHT = 132;
/** Breathing room kept between the popup and the edge of the viewport. */
const VIEWPORT_MARGIN = 12;

export function V2Listbox({
  value,
  onChange,
  options,
  label,
  placeholder = "Select…",
  disabled,
  searchable,
  fullWidth = true,
  style,
  footer,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  /** Which side the popup is on, and how tall its scroll area may be. */
  const [placement, setPlacement] = useState<"below" | "above">("below");
  const [listMaxHeight, setListMaxHeight] = useState(LIST_MAX_HEIGHT);

  const showSearch = searchable ?? options.length > 8;
  const selected = options.find((o) => o.value === value);

  const filtered = useMemo(() => {
    if (!query.trim()) return options;
    const q = query.trim().toLowerCase();
    return options.filter(
      (o) =>
        o.label.toLowerCase().includes(q) ||
        (o.hint ?? "").toLowerCase().includes(q),
    );
  }, [options, query]);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
  }, []);

  // Outside click / escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);

  useEffect(() => {
    if (!open) return;
    const idx = filtered.findIndex((o) => o.value === value);
    setActiveIndex(idx >= 0 ? idx : 0);
    if (showSearch) requestAnimationFrame(() => searchRef.current?.focus());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  /**
   * Decide which side to open on, and how tall the list may be.
   *
   * Measured, not guessed: the number of options, the search box and the label
   * all change the popup's height, and the control's distance from the bottom
   * of the viewport depends on where the page is scrolled. Re-measured on
   * scroll and resize while open, because both move the control under a popup
   * that is already showing.
   *
   * The rule is deliberately conservative — it flips only when the popup does
   * NOT fit below AND there is genuinely more room above. Opening upward when
   * downward would have worked is its own kind of surprising.
   */
  useIsomorphicLayoutEffect(() => {
    if (!open) return;

    const measure = () => {
      const control = buttonRef.current;
      if (!control) return;
      const rect = control.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom - VIEWPORT_MARGIN;
      const spaceAbove = rect.top - VIEWPORT_MARGIN;

      // Chrome around the scroll area: the search box, borders and padding.
      // Read off the live popup so it stays right if the popup ever grows.
      const popup = popupRef.current;
      const list = listRef.current;
      const chrome =
        popup && list
          ? Math.max(0, popup.offsetHeight - list.clientHeight)
          : showSearch
            ? 49
            : 2;

      const fitsBelow = spaceBelow - chrome >= LIST_MIN_HEIGHT;
      const side: "below" | "above" =
        !fitsBelow && spaceAbove > spaceBelow ? "above" : "below";
      const room = (side === "above" ? spaceAbove : spaceBelow) - chrome;

      setPlacement(side);
      setListMaxHeight(
        Math.max(LIST_MIN_HEIGHT, Math.min(LIST_MAX_HEIGHT, room)),
      );
    };

    measure();
    // A second pass once the popup has really been laid out: the first run
    // measures chrome from the fallback constants, this one from the DOM.
    const raf = requestAnimationFrame(measure);
    window.addEventListener("resize", measure);
    // Capture phase so a scroll on ANY ancestor container is caught, not just
    // the window — the Create form sits inside scrollable panels.
    window.addEventListener("scroll", measure, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [open, filtered.length, showSearch]);

  // Keep the active option in view.
  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector<HTMLElement>(
      `[data-idx="${activeIndex}"]`,
    );
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open]);

  function commit(index: number) {
    const opt = filtered[index];
    if (!opt || opt.disabled) return;
    onChange(opt.value);
    close();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (disabled) return;
    if (!open) {
      if (["Enter", " ", "ArrowDown", "ArrowUp"].includes(e.key)) {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Home") {
      e.preventDefault();
      setActiveIndex(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setActiveIndex(filtered.length - 1);
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      commit(activeIndex);
    }
  }

  return (
    <div
      ref={rootRef}
      style={{
        position: "relative",
        display: "flex",
        flexDirection: "column",
        gap: 6,
        width: fullWidth ? "100%" : undefined,
        ...style,
      }}
    >
      {label && (
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: TEXT_2,
          }}
        >
          {label}
        </span>
      )}

      <button
        ref={buttonRef}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => !disabled && setOpen((o) => !o)}
        onKeyDown={onKeyDown}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          width: "100%",
          padding: "9px 10px",
          borderRadius: 8,
          background: open
            ? "rgba(var(--v2-accent-rgb), 0.10)"
            : "rgba(255,255,255,0.04)",
          border: `1px solid ${
            open
              ? "rgba(var(--v2-accent-rgb), 0.45)"
              : "rgba(var(--v2-accent-rgb), 0.16)"
          }`,
          color: selected ? TEXT_1 : "rgba(205,195,215,0.55)",
          fontSize: 13,
          fontWeight: 500,
          textAlign: "left",
          cursor: disabled ? "not-allowed" : "pointer",
          opacity: disabled ? 0.5 : 1,
          transition: "background 120ms, border-color 120ms",
        }}
      >
        {selected?.thumbnailUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={selected.thumbnailUrl}
            alt=""
            style={{
              width: 28,
              height: 16,
              objectFit: "cover",
              borderRadius: 3,
              flexShrink: 0,
            }}
          />
        )}
        <span
          style={{
            flex: 1,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            ...(selected?.fontFamily
              ? { fontFamily: selected.fontFamily }
              : {}),
          }}
        >
          {selected?.label ?? placeholder}
        </span>
        <span
          className="material-symbols-outlined"
          style={{
            fontSize: 18,
            color: "var(--v2-accent)",
            transform: open ? "rotate(180deg)" : "none",
            transition: "transform 140ms",
          }}
        >
          expand_more
        </span>
      </button>

      {footer}

      {open && (
        <div
          ref={popupRef}
          id={listId}
          role="listbox"
          data-placement={placement}
          style={{
            position: "absolute",
            ...(placement === "above"
              ? { bottom: "100%", marginBottom: 4 }
              : { top: "100%", marginTop: 4 }),
            left: 0,
            right: 0,
            zIndex: 60,
            borderRadius: 10,
            // Opaque, NOT translucent — a see-through popup over dense content
            // is the other half of the "unreadable dropdown" complaint.
            background: "#16131c",
            border: "1px solid rgba(var(--v2-accent-rgb), 0.28)",
            boxShadow: "0 18px 44px rgba(0,0,0,0.6)",
            overflow: "hidden",
          }}
        >
          {showSearch && (
            <div
              style={{
                padding: 8,
                borderBottom: "1px solid rgba(var(--v2-accent-rgb), 0.14)",
              }}
            >
              <input
                ref={searchRef}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActiveIndex(0);
                }}
                onKeyDown={onKeyDown}
                placeholder="Filter…"
                style={{
                  width: "100%",
                  padding: "7px 9px",
                  borderRadius: 6,
                  background: "rgba(255,255,255,0.05)",
                  border: "1px solid rgba(var(--v2-accent-rgb), 0.18)",
                  color: TEXT_1,
                  fontSize: 12,
                  outline: "none",
                }}
              />
            </div>
          )}

          <div
            ref={listRef}
            style={{ maxHeight: listMaxHeight, overflowY: "auto" }}
          >
            {filtered.length === 0 && (
              <div
                style={{ padding: "14px 12px", fontSize: 12, color: TEXT_2 }}
              >
                No matches
              </div>
            )}
            {filtered.map((opt, i) => {
              const isSelected = opt.value === value;
              const isActive = i === activeIndex;
              return (
                <div
                  key={opt.value}
                  role="option"
                  aria-selected={isSelected}
                  data-idx={i}
                  onMouseEnter={() => setActiveIndex(i)}
                  onClick={() => commit(i)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "8px 10px",
                    cursor: opt.disabled ? "not-allowed" : "pointer",
                    opacity: opt.disabled ? 0.4 : 1,
                    background: isActive
                      ? "rgba(var(--v2-accent-rgb), 0.16)"
                      : "transparent",
                    color: isSelected ? "var(--v2-accent)" : TEXT_1,
                    fontSize: 13,
                    fontWeight: isSelected ? 600 : 500,
                  }}
                >
                  {opt.thumbnailUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={opt.thumbnailUrl}
                      alt=""
                      style={{
                        width: 40,
                        height: 23,
                        objectFit: "cover",
                        borderRadius: 3,
                        flexShrink: 0,
                        background: "rgba(255,255,255,0.06)",
                      }}
                    />
                  ) : null}
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span
                      style={{
                        display: "block",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        ...(opt.fontFamily
                          ? { fontFamily: opt.fontFamily, fontSize: 15 }
                          : {}),
                      }}
                    >
                      {opt.label}
                    </span>
                    {opt.hint && (
                      <span
                        style={{
                          display: "block",
                          fontSize: 10.5,
                          color: TEXT_2,
                          marginTop: 1,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {opt.hint}
                      </span>
                    )}
                  </span>
                  {isSelected && (
                    <span
                      className="material-symbols-outlined"
                      style={{ fontSize: 16, color: "var(--v2-accent)" }}
                    >
                      check
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

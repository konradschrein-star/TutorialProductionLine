/**
 * FlagIcon — inline-SVG country flags.
 *
 * WHY this exists: the Localize UI used Unicode regional-indicator flag emoji
 * (🇩🇪, 🇫🇷 …). Windows' Segoe UI Emoji ships NO country-flag glyphs, so on every
 * Windows browser those render as two boxed letters ("DE"), which the owner read
 * as "the emojis don't work". These inline SVGs render identically on every OS.
 *
 * We hand-draw the five unattended targets (de/fr/es/ja/ko), the English
 * source, and the older manual targets. Anything else uses a 2-letter chip —
 * still legible, never a broken glyph.
 */
import type { CSSProperties } from "react";

const box: CSSProperties = {
  display: "inline-block",
  width: 18,
  height: 12,
  borderRadius: 2,
  overflow: "hidden",
  verticalAlign: "-1px",
  boxShadow: "0 0 0 1px rgba(0,0,0,0.25)",
  flexShrink: 0,
};

// viewBox 0 0 3 2 keeps the stripe math trivial.
function Svg({ children }: { children: React.ReactNode }) {
  return (
    <svg viewBox="0 0 3 2" style={box} preserveAspectRatio="none" aria-hidden>
      {children}
    </svg>
  );
}

const H = (colors: string[]) => (
  <Svg>
    {colors.map((c, i) => (
      <rect key={i} x="0" y={(2 / colors.length) * i} width="3" height={2 / colors.length} fill={c} />
    ))}
  </Svg>
);

const V = (colors: string[]) => (
  <Svg>
    {colors.map((c, i) => (
      <rect key={i} x={(3 / colors.length) * i} y="0" width={3 / colors.length} height="2" fill={c} />
    ))}
  </Svg>
);

// Nordic cross: field color + cross color, cross offset toward the hoist.
const Nordic = (field: string, cross: string) => (
  <Svg>
    <rect x="0" y="0" width="3" height="2" fill={field} />
    <rect x="0" y="0.8" width="3" height="0.4" fill={cross} />
    <rect x="0.9" y="0" width="0.4" height="2" fill={cross} />
  </Svg>
);

const FLAGS: Record<string, React.ReactNode> = {
  de: H(["#000000", "#DD0000", "#FFCE00"]),
  fr: V(["#0055A4", "#FFFFFF", "#EF4135"]),
  it: V(["#009246", "#FFFFFF", "#CE2B37"]),
  nl: H(["#AE1C28", "#FFFFFF", "#21468B"]),
  es: (
    <Svg>
      <rect x="0" y="0" width="3" height="2" fill="#AA151B" />
      <rect x="0" y="0.5" width="3" height="1" fill="#F1BF00" />
    </Svg>
  ),
  ja: (
    <Svg>
      <rect x="0" y="0" width="3" height="2" fill="#FFFFFF" />
      <circle cx="1.5" cy="1" r="0.48" fill="#BC002D" />
    </Svg>
  ),
  ko: (
    <Svg>
      <rect x="0" y="0" width="3" height="2" fill="#FFFFFF" />
      <path
        d="M1.18 1a.32.32 0 0 1 .64 0 .64.64 0 0 0-1.28 0 .64.64 0 0 1 1.28 0 .32.32 0 0 1-.64 0Z"
        fill="#CD2E3A"
      />
      <path
        d="M1.82 1a.32.32 0 0 1-.64 0 .64.64 0 0 0 1.28 0 .64.64 0 0 1-1.28 0 .32.32 0 0 1 .64 0Z"
        fill="#0047A0"
      />
      <path
        d="M.36.35h.46M.36.48h.46M2.18 1.52h.46M2.18 1.65h.46"
        stroke="#111"
        strokeWidth=".055"
      />
    </Svg>
  ),
  pt: (
    <Svg>
      <rect x="0" y="0" width="3" height="2" fill="#DA291C" />
      <rect x="0" y="0" width="1.2" height="2" fill="#046A38" />
      <circle cx="1.2" cy="1" r="0.32" fill="#FFE000" />
    </Svg>
  ),
  sv: Nordic("#006AA7", "#FECC02"),
  en: (
    // Source channel is USA — a simplified stars-and-stripes reads as "English".
    <Svg>
      {Array.from({ length: 7 }).map((_, i) => (
        <rect key={i} x="0" y={(2 / 13) * i * 2} width="3" height={2 / 13} fill="#B22234" />
      ))}
      <rect x="0" y="0" width="1.3" height={2 / 13 * 7} fill="#3C3B6E" />
    </Svg>
  ),
};

export function FlagIcon({ code }: { code: string }) {
  const flag = FLAGS[code];
  if (flag) return flag;
  // Fallback: a neat code chip, never a broken emoji.
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        minWidth: 18,
        height: 12,
        padding: "0 3px",
        borderRadius: 2,
        fontSize: 8,
        fontWeight: 800,
        letterSpacing: "0.02em",
        color: "var(--v2-text-2)",
        background: "var(--v2-surface-2)",
        boxShadow: "0 0 0 1px rgba(0,0,0,0.25)",
        verticalAlign: "-1px",
      }}
    >
      {code.toUpperCase()}
    </span>
  );
}

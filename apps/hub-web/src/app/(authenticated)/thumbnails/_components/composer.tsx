"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { toast } from "sonner";
import { prepareThumbnailExport } from "@/lib/thumbnails/export-ready";
import { BoundedArtwork } from "@/components/thumbnails/bounded-artwork";
import {
  distributeHeadlineWords,
  removeRepresentedProduct,
  validateProceduralHeadlines,
  initialLocaleOnly,
  moveLayerBefore,
} from "@/lib/thumbnails/procedural-policy";
import {
  automaticHeadlineCeiling,
  fitThumbnailText,
} from "@/lib/thumbnails/fit-text";
import {
  CLOSE_HOST_CROP,
  TUTORIAL_HEADLINE_SIZE,
  backgroundToneColor,
  layerShadowCss,
  sampleBackgroundColor,
} from "@/lib/thumbnails/visual-style";
import { ALL_TARGET_LANGUAGES } from "@/lib/tutorial/languages";
import type { ThumbnailLayout } from "@/lib/thumbnails/layout-document";
import { inheritThumbnailLayout } from "@/lib/thumbnails/shared-layout";
import {
  applySoftwareLogo,
  type SoftwareLogo,
} from "@/lib/thumbnails/software-logo";
import { Rnd } from "react-rnd";
import { toBlob } from "html-to-image";
import JSZip from "jszip";
import { saveAs } from "file-saver";
import { V2Card as GlassCard } from "@/app/(authenticated)/_components";
import workspace from "./composer-workspace.module.css";
import {
  thumbnailCanvasScale,
  thumbnailEditorAvailability,
} from "@/lib/thumbnails/workspace-model";
import { ThumbnailPreviewImage } from "@/components/thumbnails/thumbnail-preview-image";
import { TutorialAiPanel } from "@/components/thumbnails/tutorial-ai-panel";
import {
  AssetCollection,
  type AssetPreferences,
  type CollectionAsset,
} from "@/components/thumbnails/asset-collection";
import {
  nextLayerId,
  thumbnailTextPadding,
} from "@/lib/thumbnails/editor-layout";
import { FlagIcon } from "@/lib/tutorial/flag-icon";
import {
  ACTIVE_PERSONA_LANGUAGES,
  cleanedPersonaUrl,
  PERSONA_CATALOG,
} from "@/lib/thumbnails/persona-catalog";

/**
 * Manual Thumbnail Composer — the PRIMARY, fully-offline thumbnail tool.
 *
 * Ported from the standalone facade tool (repo-root src/pages/ThumbnailStudio.tsx)
 * and reskinned to the V2 design system. Everything here runs 100% client-side:
 * drag/resize layers on a fixed canvas, a static offline asset catalog served
 * from /public, shared uploads persisted on the server (with a local fallback), PNG
 * export (html-to-image), and a launch-network ZIP export that swaps the
 * approved 1–4-word headline and the assigned host for each language.
 *
 * The AI-generation flow (Generate/Archetypes tabs) depends on media-gateway
 * infra the target box does not have; this composer is the real tool + fallback.
 *
 * Channel variants remain editable so a VA can fix font fit before export.
 */

const TEXT_1 = "var(--v2-text-1)";
const TEXT_2 = "var(--v2-text-2)";

const CUSTOM_ASSETS_KEY = "ts_custom_assets";

// English source + the four localized launch channels, in export order.
const LANGUAGES = ACTIVE_PERSONA_LANGUAGES;

interface VariantCopy {
  top: string;
  bottom: string;
  third: string;
  fourth: string;
}

const TEXT_LINE_KEYS = ["top", "bottom", "third", "fourth"] as const;
type TextLineKey = (typeof TEXT_LINE_KEYS)[number];
const TEXT_LAYER_IDS = [
  "text-top",
  "text-bottom",
  "text-third",
  "text-fourth",
] as const;
const EMPTY_COPY: VariantCopy = { top: "", bottom: "", third: "", fourth: "" };
function textLayerId(line: TextLineKey) {
  return TEXT_LAYER_IDS[TEXT_LINE_KEYS.indexOf(line)];
}
function textLineKey(id: string): TextLineKey | null {
  const index = TEXT_LAYER_IDS.indexOf(id as (typeof TEXT_LAYER_IDS)[number]);
  return index < 0 ? null : TEXT_LINE_KEYS[index]!;
}
function copyLines(copy?: VariantCopy): string[] {
  return TEXT_LINE_KEYS.map((key) => copy?.[key] ?? "");
}
function copyFromLines(lines: readonly string[]): VariantCopy {
  return {
    top: lines[0]?.trim() ?? "",
    bottom: lines[1]?.trim() ?? "",
    third: lines[2]?.trim() ?? "",
    fourth: lines[3]?.trim() ?? "",
  };
}

const INITIAL_VARIANT_COPY: Record<(typeof LANGUAGES)[number], VariantCopy> = {
  English: { ...EMPTY_COPY },
  German: { ...EMPTY_COPY },
  French: { ...EMPTY_COPY },
  Italian: { ...EMPTY_COPY },
  Swedish: { ...EMPTY_COPY },
};

const FONT_OPTIONS = [
  {
    label: "Anton (Automatic default)",
    value: "Anton, Impact, sans-serif",
  },
  {
    label: "Montserrat Bold (Channel Font)",
    value: "var(--font-montserrat), Montserrat, Arial, sans-serif",
  },
];
const THUMBNAIL_FONT = FONT_OPTIONS[0]!.value;
const MAX_THUMBNAIL_WORDS = 4;
function copyWords(value: string): string[] {
  return value.trim().split(/\s+/).filter(Boolean);
}
function compactCopyPair(
  top: string,
  bottom: string,
  third = "",
  fourth = "",
): VariantCopy {
  // Preserve meaning in existing/generated copy. Approval validates four words;
  // saving a replacement draft must not silently delete words such as "no".
  return {
    top: top.trim(),
    bottom: bottom.trim(),
    third: third.trim(),
    fourth: fourth.trim(),
  };
}

function FittedHeadline({
  element,
  scale = 1,
  style,
}: {
  element: ThumbnailElement;
  scale?: number;
  style?: React.CSSProperties;
}) {
  const [fit, setFit] = useState({
    text: element.text ?? "",
    fontSize: element.fontSize ?? TUTORIAL_HEADLINE_SIZE,
  });
  useLayoutEffect(() => {
    const text = element.text?.trim() ?? "";
    if (!text || typeof document === "undefined") {
      setFit({ text, fontSize: element.fontSize ?? TUTORIAL_HEADLINE_SIZE });
      return;
    }
    let active = true;
    const calculate = () => {
      const context = document.createElement("canvas").getContext("2d");
      if (!context) return;
      const stroke = element.strokeWidth ?? 0;
      const inset = Math.ceil(stroke / 2) + 4;
      try {
        const fontSize = fitThumbnailText(
          {
            width: Math.max(1, element.width - stroke * 2 - inset * 2 - 56),
            height: Math.max(1, element.height - stroke * 2 - inset * 2 - 32),
            preferredSize:
              element.autoFit === false
                ? (element.fontSize ?? TUTORIAL_HEADLINE_SIZE)
                : automaticHeadlineCeiling(element.width, element.height),
            minimumSize: 24,
          },
          (size) => {
            context.font = `${element.fontStyle ?? "normal"} ${element.fontWeight ?? "900"} ${size}px ${element.fontFamily || THUMBNAIL_FONT}`;
            const metrics = context.measureText(text.toUpperCase());
            return {
              width: metrics.width * 1.04,
              height:
                (metrics.actualBoundingBoxAscent || size * 0.78) +
                (metrics.actualBoundingBoxDescent || size * 0.08),
            };
          },
        );
        if (active) setFit({ text, fontSize });
      } catch {
        if (active) setFit({ text, fontSize: 24 });
      }
    };
    void document.fonts.ready.then(calculate);
    return () => {
      active = false;
    };
  }, [
    element.text,
    element.width,
    element.height,
    element.fontSize,
    element.autoFit,
    element.fontStyle,
    element.fontWeight,
    element.strokeWidth,
    element.fontFamily,
  ]);
  return (
    <div
      data-thumbnail-text={element.id}
      style={{
        ...style,
        display: "flex",
        alignItems: "center",
        justifyContent: "flex-start",
        overflow: "visible",
        whiteSpace: "nowrap",
        textTransform: "uppercase",
        letterSpacing: 0,
        color: element.color || "#fff",
        fontFamily: element.fontFamily || THUMBNAIL_FONT,
        fontStyle: element.fontStyle || "normal",
        fontWeight: element.fontWeight || 900,
        fontSize: fit.fontSize * scale,
        lineHeight: 1.02,
        WebkitTextStroke: `${(element.strokeWidth ?? 5) * scale}px ${element.strokeColor || "#000"}`,
        paintOrder: "stroke fill",
        backgroundColor: "transparent",
        borderRadius: 0,
        padding: 0,
        textShadow: layerShadowCss(
          { ...element, shadow: element.shadow !== false },
          scale,
        ),
        boxSizing: "border-box",
        userSelect: "none",
      }}
    >
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          maxWidth: "100%",
          height: "fit-content",
          lineHeight: 0.95,
          backgroundColor: element.bgColor || "transparent",
          borderRadius: element.borderRadius || 0,
          padding: thumbnailTextPadding(
            element.strokeWidth ?? 0,
            element.padding || "16px 28px",
            scale,
          ),
          boxSizing: "border-box",
        }}
      >
        {fit.text}
      </span>
    </div>
  );
}

// The approved backgrounds are the four office photographs in /public/background.
interface BgOption {
  name: string;
  url?: string;
  css?: string;
  backgroundTone?: "light" | "dark" | "auto";
}

const DEFAULT_BGS: BgOption[] = [
  {
    name: "Neutral Home Office · New",
    url: "/background/office-neutral-20260909.png",
  },
  // Original served image backgrounds (public/background/).
  { name: "Office 1 · Window Desk", url: "/background/bg_1_1128207.jpg" },
  { name: "Office 2 · White Desk", url: "/background/bg_5_4386356.jpg" },
  { name: "Office 3 · Conference Room", url: "/background/bg_9_5717314.jpg" },
  { name: "Office 4 · Desktop", url: "/background/bg_6_322338.jpg" },
  // Deliberately excluded from automatic rotation. These are manual building
  // blocks for the two high-contrast circle layouts below.
  {
    name: "Plain white · Manual only",
    css: "#ffffff",
    backgroundTone: "light",
  },
  { name: "Plain black · Manual only", css: "#07090d", backgroundTone: "dark" },
];

// Per-language display order + flag emoji for the grouped PERSONAS library.
const PERSONA_LANG_ORDER = ACTIVE_PERSONA_LANGUAGES;

// Windows has no flag-emoji glyphs, so these render as SVGs via FlagIcon.
const LANG_NAME_TO_CODE: Record<string, string> = {
  ...Object.fromEntries(
    ALL_TARGET_LANGUAGES.map((item) => [item.name, item.code]),
  ),
  English: "en",
  German: "de",
  Italian: "it",
  French: "fr",
  Swedish: "sv",
};

const CODE_TO_LANG_NAME: Record<string, string> = {
  ...Object.fromEntries(
    ALL_TARGET_LANGUAGES.flatMap((item) => [
      [item.code, item.name],
      [item.name.toLowerCase(), item.name],
    ]),
  ),
  en: "English",
  english: "English",
  de: "German",
  german: "German",
  fr: "French",
  french: "French",
  it: "Italian",
  italian: "Italian",
  sv: "Swedish",
  swedish: "Swedish",
};

interface ThumbnailBundle {
  generationMode?: "ai" | "manual";
  softwareLogo?: SoftwareLogo | null;
  softwareSubject?: string | null;
  rootId: string;
  ready: boolean;
  variants: Array<{
    thumbnailMode?: "procedural" | "ai" | "both";
    hostImageUrls?: string[];
    id: string | null;
    language: string;
    title: string | null;
    status: string | null;
    videoUrl: string | null;
    thumbnailTextTop: string | null;
    thumbnailTextBottom: string | null;
    approved: boolean;
    savedApproved?: boolean;
    thumbnailId?: string | null;
    hasSelectedImage?: boolean;
    selectedHeadlineLines?: string[];
    ready: boolean;
    reasons: string[];
    copyError?: string | null;
    layout?: ThumbnailLayout | null;
    draftLayout?: ThumbnailLayout | null;
    draftRevision?: number;
  }>;
}

// Rebuilt from the ACTUAL files present in apps/hub-web/public/<folder>/.
// URLs are case-sensitive; folder casing matches disk exactly.
const RAW_PERSONAS: Record<string, { name: string; url: string }[]> = {
  English: [
    { name: "American - Pointing", url: "/English/american-pointing.png" },
    { name: "American - Thumbs-up", url: "/English/american-thumbs-up.png" },
    { name: "American - Explaining", url: "/English/american-explaining.png" },
    { name: "American - Pro tip", url: "/English/american-finger-up.png" },
    { name: "American - Thinking", url: "/English/american-thinking.png" },
    { name: "American - Stop", url: "/English/american-stop-palm.png" },
    { name: "American - Celebrate", url: "/English/american-celebrate.png" },
    { name: "American - Smiling", url: "/English/american-hero.png" },
    {
      name: "English Host 2",
      url: "/English/english_persona_3_1783711821680-removebg-preview.png",
    },
    {
      name: "English Host 3",
      url: "/English/english_persona_4_1783711831752-removebg-preview.png",
    },
    {
      name: "English Host 4",
      url: "/English/new_english_persona_1783711373283-removebg-preview.png",
    },
  ],
  Spanish: [
    {
      name: "Spanish Host 1",
      url: "/spanish/new_spanish_persona_1783711397652-removebg-preview.png",
    },
    {
      name: "Spanish Host 2",
      url: "/spanish/spanish_1_1783793169018-removebg-preview.png",
    },
    {
      name: "Spanish Host 3",
      url: "/spanish/spanish_3_1783793186761-removebg-preview.png",
    },
    {
      name: "Spanish Host 4",
      url: "/spanish/spanish_4_1783793195747-removebg-preview.png",
    },
  ],
  German: [
    { name: "German - Pointing", url: "/germanese/german-pointing.png" },
    { name: "German - Thumbs-up", url: "/germanese/german-thumbs-up.png" },
    { name: "German - Surprised", url: "/germanese/german-surprised.png" },
    { name: "German - Explaining", url: "/germanese/german-explaining.png" },
    { name: "German - Pro tip", url: "/germanese/german-finger-up.png" },
    { name: "German - Thinking", url: "/germanese/german-thinking.png" },
    { name: "German - Thinking 2", url: "/germanese/german-thinking-2.png" },
    { name: "German - Stop", url: "/germanese/german-stop-palm.png" },
    { name: "German - Stop 2", url: "/germanese/german-stop-palm-2.png" },
    { name: "German - Celebrate", url: "/germanese/german-celebrate.png" },
    { name: "German - Celebrate 2", url: "/germanese/german-celebrate-2.png" },
    { name: "German - Smiling", url: "/germanese/german-hero.png" },
    {
      name: "German Host 2",
      url: "/germanese/german_persona_3_1783711839868-removebg-preview.png",
    },
    {
      name: "German Host 3",
      url: "/germanese/german_persona_4_1783711848080-removebg-preview.png",
    },
    {
      name: "German Host 4",
      url: "/germanese/new_german_persona_1783711381520-removebg-preview.png",
    },
  ],
  Italian: [
    { name: "Italian - Pointing", url: "/Italy/italian-pointing.png" },
    { name: "Italian - Thumbs-up", url: "/Italy/italian-thumbs-up.png" },
    { name: "Italian - Thumbs-up 2", url: "/Italy/italian-thumbs-up-2.png" },
    { name: "Italian - Explaining", url: "/Italy/italian-explaining.png" },
    { name: "Italian - Pro tip", url: "/Italy/italian-finger-up.png" },
    { name: "Italian - Thinking", url: "/Italy/italian-thinking.png" },
    { name: "Italian - Smiling", url: "/Italy/italian-hero.png" },
    { name: "Italian - Smiling 2", url: "/Italy/italian-hero-2.png" },
    { name: "Italian - Smiling 3", url: "/Italy/italian-hero-3.png" },
    {
      name: "Italian Host 1",
      url: "/Italy/03009044-1891-4745-8e68-d8e7daf4c47b_removalai_preview.png",
    },
    {
      name: "Italian Host 2",
      url: "/Italy/081a8de0-1857-420b-a470-ceddf006e88b_removalai_preview.png",
    },
    {
      name: "Italian Host 3",
      url: "/Italy/26fa11f0-b7c9-4fd1-a283-12225cdced9e_removalai_preview.png",
    },
  ],
  French: [
    { name: "French - Pointing", url: "/French/french-pointing.png" },
    { name: "French - Thumbs-up", url: "/French/french-thumbs-up.png" },
    { name: "French - Thumbs-up 2", url: "/French/french-thumbs-up-2.png" },
    { name: "French - Surprised", url: "/French/french-surprised.png" },
    { name: "French - Explaining", url: "/French/french-explaining.png" },
    { name: "French - Pro tip", url: "/French/french-finger-up.png" },
    { name: "French - Thinking", url: "/French/french-thinking.png" },
    { name: "French - Stop", url: "/French/french-stop-palm.png" },
    { name: "French - Smiling", url: "/French/french-hero.png" },
    {
      name: "French Host 1",
      url: "/French/21aaab3a-1cec-4fae-84eb-ab20df8bfa21_removalai_preview.png",
    },
    {
      name: "French Host 2",
      url: "/French/2e575d5b-1b55-4ade-b6e5-fde911423a55_removalai_preview.png",
    },
    {
      name: "French Host 3",
      url: "/French/683bfa4d-b18b-4f7c-91df-30a9a109e77a_removalai_preview.png",
    },
  ],
  Portuguese: [
    {
      name: "Portuguese Host 1",
      url: "/portoguese/0d8cea91-3bd0-4a97-b2af-8553cdb5e2c2_removalai_preview.png",
    },
    {
      name: "Portuguese Host 2",
      url: "/portoguese/28d7a6e2-15c3-467f-bb73-0f146a997ebd_removalai_preview.png",
    },
    {
      name: "Portuguese Host 3",
      url: "/portoguese/3348eba0-15b7-430a-a89b-164ad35bdf3e_removalai_preview.png",
    },
    {
      name: "Portuguese Host 4",
      url: "/portoguese/c3df7faf-0e9b-403d-938b-ba444e0841a9_removalai_preview.png",
    },
  ],
  Japanese: [
    {
      name: "Japanese Host 1",
      url: "/Japanese/31bf9c29-9194-49df-ba56-4baff00537d5_removalai_preview.png",
    },
    {
      name: "Japanese Host 2",
      url: "/Japanese/55bb0ed9-628e-45dd-8cda-7f85e89953c9_removalai_preview.png",
    },
    {
      name: "Japanese Host 3",
      url: "/Japanese/7b1a2b0f-7983-4835-8437-34a5d08a3a08_removalai_preview.png",
    },
  ],
  Korean: [
    {
      name: "Korean Host 1",
      url: "/Korean/48acff93-85ce-4426-b3c9-8b6deb49734b_removalai_preview.png",
    },
    {
      name: "Korean Host 2",
      url: "/Korean/9acd591f-1c94-4de3-a017-80d19ec14b5c_removalai_preview.png",
    },
    {
      name: "Korean Host 3",
      url: "/Korean/d434a2bf-1b06-47f7-b384-ba4a58271b17_removalai_preview.png",
    },
  ],
  Swedish: [
    { name: "Swedish - Pointing", url: "/Swedish/swedish-pointing.png" },
    { name: "Swedish - Thumbs-up", url: "/Swedish/swedish-thumbs-up.png" },
    { name: "Swedish - Thumbs-up 2", url: "/Swedish/swedish-thumbs-up-2.png" },
    { name: "Swedish - Surprised", url: "/Swedish/swedish-surprised.png" },
    { name: "Swedish - Pro tip", url: "/Swedish/swedish-finger-up.png" },
    { name: "Swedish - Thinking", url: "/Swedish/swedish-thinking.png" },
    { name: "Swedish - Stop", url: "/Swedish/swedish-stop-palm.png" },
    { name: "Swedish - Smiling", url: "/Swedish/swedish-hero.png" },
    {
      name: "Swedish Host 1",
      url: "/Swedish/218cb5ee-5ebe-400d-a0ff-0cc690b97029_removalai_preview.png",
    },
    {
      name: "Swedish Host 2",
      url: "/Swedish/2ec1ad55-2e90-480a-8897-57a5f1bbc45d_removalai_preview.png",
    },
    {
      name: "Swedish Host 3",
      url: "/Swedish/935cadb4-9559-4fd1-932b-9fe90f40b579_removalai_preview.png",
    },
  ],
  Dutch: [
    { name: "Dutch - Pointing", url: "/Dutch/dutch-pointing.png" },
    { name: "Dutch - Thumbs-up", url: "/Dutch/dutch-thumbs-up.png" },
    { name: "Dutch - Explaining", url: "/Dutch/dutch-explaining.png" },
    { name: "Dutch - Pro tip", url: "/Dutch/dutch-finger-up.png" },
    { name: "Dutch - Thinking", url: "/Dutch/dutch-thinking.png" },
    { name: "Dutch - Stop", url: "/Dutch/dutch-stop-palm.png" },
    { name: "Dutch - Smiling", url: "/Dutch/dutch-hero.png" },
    {
      name: "Dutch Host 1",
      url: "/Dutch/9dff44d7-5dda-4215-8b6c-126bef6e362e_removalai_preview.png",
    },
    {
      name: "Dutch Host 2",
      url: "/Dutch/f10015c0-4366-4353-8159-bc9950068084_removalai_preview.png",
    },
    {
      name: "Dutch Host 3",
      url: "/Dutch/fa99a6c5-496a-47b2-ba9e-fc69f1b17e5d_removalai_preview.png",
    },
  ],
};

const DEFAULT_PERSONAS: Record<string, { name: string; url: string }[]> =
  Object.fromEntries(
    Object.entries(PERSONA_CATALOG).map(([language, personas]) => [
      language,
      personas.map((persona) => ({
        name: persona.name,
        url: cleanedPersonaUrl(persona.path),
      })),
    ]),
  );

const ALL_APP_LOGOS = [
  "asana.png",
  "blender.png",
  "calendly.png",
  "cashapp.png",
  "ChatGPT-Logo.png",
  "clickup.png",
  "cloudflare.png",
  "davinciresolve.png",
  "discord.png",
  "dropbox.png",
  "ebay.png",
  "epicgames.png",
  "etsy.png",
  "facebook.png",
  "figma.png",
  "gimp.png",
  "github.png",
  "gmail.png",
  "googlecalendar.png",
  "googlechrome.png",
  "googledocs.png",
  "googledrive.png",
  "googlemaps.png",
  "googlemeet.png",
  "googlephotos.png",
  "googlesheets.png",
  "gumroad.png",
  "icloud.png",
  "imessage.png",
  "inkscape.png",
  "instagram.png",
  "krita.png",
  "macos.png",
  "mailchimp.png",
  "namecheap.png",
  "netflix.png",
  "netlify.png",
  "notion.png",
  "obsidian.png",
  "obsstudio.png",
  "paypal.png",
  "pinterest.png",
  "playstation.png",
  "reddit.png",
  "replit.png",
  "roblox.png",
  "safari.png",
  "shopify.png",
  "snapchat.png",
  "spotify.png",
  "steam.png",
  "streamlabs.png",
  "stripe.png",
  "telegram.png",
  "tiktok.png",
  "todoist.png",
  "trello.png",
  "twitch.png",
  "venmo.png",
  "vercel.png",
  "whatsapp.png",
  "wix.png",
  "woocommerce.png",
  "wordpress.png",
  "youtube.png",
  "youtubestudio.png",
  "zapier.png",
  "zelle.png",
  "zoom.png",
];

const ALL_SYMBOLS = [
  "curved-arrow.png",
  "alert-circle.png",
  "alert-triangle.png",
  "badge-check.png",
  "badge.png",
  "bell-ring.png",
  "bell.png",
  "camera.png",
  "check-circle.png",
  "clock.png",
  "cloud.png",
  "code.png",
  "crown.png",
  "database.png",
  "diamond.png",
  "dollar-sign.png",
  "eye.png",
  "file-text.png",
  "flame.png",
  "gift.png",
  "globe.png",
  "heart.png",
  "key.png",
  "laptop.png",
  "lightbulb.png",
  "lock.png",
  "megaphone.png",
  "mic.png",
  "play.png",
  "rocket.png",
  "shield.png",
  "sparkle.png",
  "sparkles.png",
  "star.png",
  "target.png",
  "thumbs-up.png",
  "trending-up.png",
  "trophy.png",
  "tv.png",
  "video.png",
  "wand-sparkles.png",
  "zap.png",
];

type ElementType =
  "TEXT" | "PERSON" | "LOGO" | "SYMBOL" | "BACKGROUND" | "UPLOAD" | "SHAPE";

interface ThumbnailElement {
  shadow?: boolean;
  shadowBlur?: number;
  shadowOpacity?: number;
  shadowOffsetY?: number;
  autoColor?: boolean;
  autoLogo?: boolean;
  /** True/undefined maximises text in the hitbox; false respects fontSize. */
  autoFit?: boolean;
  id: string;
  type: ElementType;
  url?: string;
  /** For BACKGROUND elements: a CSS background value (gradient/solid) instead of an image. */
  css?: string;
  text?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  rotation?: number;
  fontFamily?: string;
  fontSize?: number;
  color?: string;
  strokeColor?: string;
  strokeWidth?: number;
  fontWeight?: string;
  fontStyle?: string;
  bgColor?: string;
  borderRadius?: string;
  padding?: string;
  imageScale?: number;
  mirrorX?: boolean;
  mirrorY?: boolean;
  tightBounds?: boolean;
  backgroundTone?: "light" | "dark" | "auto";
}

type AssetCategory = "PERSONAS" | "LOGOS" | "SYMBOLS" | "BGS" | "CUSTOM";

interface CustomThumbnailAsset {
  id: string;
  name: string;
  category: AssetCategory;
  url: string;
  createdAt: string;
}

type LibraryTab =
  | "PRESETS"
  | "PERSONAS"
  | "LOGOS"
  | "SYMBOLS"
  | "SHAPES"
  | "BGS"
  | "CUSTOM"
  | "LAYERS";

// ── localStorage helpers (replicate facade StorageService, plain localStorage) ──
function readCustomAssets(): CustomThumbnailAsset[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(CUSTOM_ASSETS_KEY);
    return raw ? (JSON.parse(raw) as CustomThumbnailAsset[]) : [];
  } catch {
    return [];
  }
}

function writeCustomAssets(assets: CustomThumbnailAsset[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CUSTOM_ASSETS_KEY, JSON.stringify(assets));
  } catch {
    /* quota / serialization — non-fatal */
  }
}

function initialElements(): ThumbnailElement[] {
  return [
    {
      id: "bg-1",
      type: "BACKGROUND",
      url: "/background/bg_1_1128207.jpg",
      x: 0,
      y: 0,
      width: 800,
      height: 450,
      zIndex: 1,
    },
    {
      id: "person-1",
      type: "PERSON",
      tightBounds: true,
      url: cleanedPersonaUrl("English/american-hero.png"),
      ...CLOSE_HOST_CROP.right,
      shadow: true,
      zIndex: 2,
    },
    {
      id: "text-top",
      type: "TEXT",
      text: "LEARN FAST",
      x: 28,
      y: 36,
      width: 442,
      height: 102,
      zIndex: 4,
      fontFamily: THUMBNAIL_FONT,
      fontSize: TUTORIAL_HEADLINE_SIZE,
      autoColor: true,
      color: "#ffffff",
      strokeColor: "#000000",
      strokeWidth: 5,
      fontWeight: "900",
      fontStyle: "normal",
      rotation: 0,
    },
    {
      id: "text-bottom",
      type: "TEXT",
      text: "IN 10 MINS",
      x: 28,
      y: 138,
      width: 442,
      height: 102,
      zIndex: 5,
      fontFamily: THUMBNAIL_FONT,
      fontSize: TUTORIAL_HEADLINE_SIZE,
      autoColor: true,
      color: "#ffffff",
      strokeColor: "#000000",
      strokeWidth: 5,
      fontWeight: "900",
      fontStyle: "normal",
      rotation: 0,
    },
    {
      id: "logo-1",
      type: "LOGO",
      tightBounds: true,
      shadow: true,
      url: "/app_logos_png/notion.png",
      x: 52,
      y: 252,
      width: 176,
      height: 176,
      zIndex: 3,
      bgColor: "#ffffff",
      borderRadius: "50%",
      padding: "18px",
    },
    {
      id: "arrow-1",
      type: "SYMBOL",
      tightBounds: true,
      shadow: true,
      url: "/bulk_symbols_110_colored/curved-arrow.png",
      x: 205,
      y: 214,
      width: 128,
      height: 128,
      zIndex: 6,
      rotation: 0,
    },
  ];
}

interface ReferenceLayoutPreset {
  id: string;
  name: string;
  references: string;
  description: string;
  patches: Record<string, Partial<ThumbnailElement>>;
  additions?: ThumbnailElement[];
}

/**
 * Editable geometry distilled from the approved archetype examples. These are
 * layout starting points, not flattened templates: the VA can still drag and
 * resize every person, line, logo and symbol after applying one.
 */
const REFERENCE_LAYOUTS: readonly ReferenceLayoutPreset[] = [
  {
    id: "ui-card-host-right",
    name: "UI Focus · Host right",
    references: "Tight presenter + recorded interface references",
    description:
      "Default: two solid headline hitboxes, a dominant UI card and an inward-pointing close host.",
    patches: {
      "bg-1": {
        url: undefined,
        css: "linear-gradient(135deg,#ffffff,#dfe4e8)",
        backgroundTone: "light",
      },
      "person-1": {
        x: 462,
        y: -36,
        width: 420,
        height: 566,
        mirrorX: true,
        shadow: true,
      },
      "text-top": {
        x: 144,
        y: 20,
        width: 326,
        height: 88,
        fontSize: 96,
        strokeWidth: 0,
        color: "#ffffff",
        bgColor: "#090a0c",
        borderRadius: "12px",
        padding: "8px 12px",
        autoColor: false,
      },
      "text-bottom": {
        x: 144,
        y: 110,
        width: 326,
        height: 88,
        fontSize: 96,
        strokeWidth: 0,
        color: "#ffe319",
        bgColor: "#090a0c",
        borderRadius: "12px",
        padding: "8px 12px",
        autoColor: false,
      },
      "logo-1": {
        x: 28,
        y: 34,
        width: 104,
        height: 104,
        bgColor: "#ffffff",
        borderRadius: "22px",
        padding: "10px",
      },
      "arrow-1": { x: 342, y: 232, width: 138, height: 138, rotation: 0 },
    },
    additions: [
      {
        id: "ui-card",
        type: "SHAPE",
        x: 24,
        y: 205,
        width: 444,
        height: 228,
        zIndex: 1,
        bgColor: "#ffffff",
        borderRadius: "18px",
        shadow: true,
      },
    ],
  },
  {
    id: "ui-card-host-left",
    name: "UI Focus · Host left",
    references: "Mirrored tight presenter + interface reference",
    description:
      "Mirrored default for a host pose that points right into the tutorial interface.",
    patches: {
      "bg-1": {
        url: undefined,
        css: "linear-gradient(135deg,#ffffff,#dfe4e8)",
        backgroundTone: "light",
      },
      "person-1": {
        x: -64,
        y: -36,
        width: 420,
        height: 566,
        mirrorX: false,
        shadow: true,
      },
      "text-top": {
        x: 330,
        y: 20,
        width: 326,
        height: 88,
        fontSize: 96,
        strokeWidth: 0,
        color: "#ffffff",
        bgColor: "#090a0c",
        borderRadius: "12px",
        padding: "8px 12px",
        autoColor: false,
      },
      "text-bottom": {
        x: 330,
        y: 110,
        width: 326,
        height: 88,
        fontSize: 96,
        strokeWidth: 0,
        color: "#ffe319",
        bgColor: "#090a0c",
        borderRadius: "12px",
        padding: "8px 12px",
        autoColor: false,
      },
      "logo-1": {
        x: 668,
        y: 34,
        width: 104,
        height: 104,
        bgColor: "#ffffff",
        borderRadius: "22px",
        padding: "10px",
      },
      "arrow-1": {
        x: 318,
        y: 232,
        width: 138,
        height: 138,
        mirrorX: true,
        rotation: 0,
      },
    },
    additions: [
      {
        id: "ui-card",
        type: "SHAPE",
        x: 330,
        y: 205,
        width: 444,
        height: 228,
        zIndex: 1,
        bgColor: "#ffffff",
        borderRadius: "18px",
        shadow: true,
      },
    ],
  },
  {
    id: "icon-focus-host-right",
    name: "Icon Focus · Host right",
    references: "Large tool/document focal-object references",
    description:
      "Use when no useful recording frame exists. Put the app icon or document graphic inside the large card.",
    patches: {
      "bg-1": { url: undefined, css: "#f4f6f8", backgroundTone: "light" },
      "person-1": {
        x: 462,
        y: -36,
        width: 420,
        height: 566,
        mirrorX: true,
        shadow: true,
      },
      "text-top": {
        x: 24,
        y: 20,
        width: 446,
        height: 88,
        strokeWidth: 0,
        color: "#ffffff",
        bgColor: "#090a0c",
        borderRadius: "12px",
        padding: "8px 12px",
        autoColor: false,
      },
      "text-bottom": {
        x: 24,
        y: 110,
        width: 446,
        height: 88,
        strokeWidth: 0,
        color: "#ffe319",
        bgColor: "#090a0c",
        borderRadius: "12px",
        padding: "8px 12px",
        autoColor: false,
      },
      "logo-1": {
        x: 82,
        y: 238,
        width: 176,
        height: 176,
        bgColor: "#ffffff",
        borderRadius: "50%",
        padding: "18px",
      },
      "arrow-1": { x: 278, y: 238, width: 142, height: 142 },
    },
  },
  {
    id: "icon-focus-host-left",
    name: "Icon Focus · Host left",
    references: "Mirrored large focal-object reference",
    description:
      "Mirrored icon/document layout for right-pointing host images.",
    patches: {
      "bg-1": { url: undefined, css: "#f4f6f8", backgroundTone: "light" },
      "person-1": {
        x: -64,
        y: -36,
        width: 420,
        height: 566,
        mirrorX: false,
        shadow: true,
      },
      "text-top": {
        x: 330,
        y: 20,
        width: 446,
        height: 88,
        strokeWidth: 0,
        color: "#ffffff",
        bgColor: "#090a0c",
        borderRadius: "12px",
        padding: "8px 12px",
        autoColor: false,
      },
      "text-bottom": {
        x: 330,
        y: 110,
        width: 446,
        height: 88,
        strokeWidth: 0,
        color: "#ffe319",
        bgColor: "#090a0c",
        borderRadius: "12px",
        padding: "8px 12px",
        autoColor: false,
      },
      "logo-1": {
        x: 542,
        y: 238,
        width: 176,
        height: 176,
        bgColor: "#ffffff",
        borderRadius: "50%",
        padding: "18px",
      },
      "arrow-1": { x: 384, y: 238, width: 142, height: 142, mirrorX: true },
    },
  },
  {
    id: "guide-host-right",
    name: "Legacy Guide · Host right",
    references: "User-supplied TechGuidePro reference",
    description:
      "Text high and logo low, with a large close-cropped host on the right.",
    patches: {
      "person-1": { ...CLOSE_HOST_CROP.right, shadow: true },
      "text-top": {
        x: 24,
        y: 24,
        width: 470,
        height: 104,
        fontSize: 118,
        strokeWidth: 5,
        color: "#ffffff",
        shadow: true,
        autoColor: true,
      },
      "text-bottom": {
        x: 24,
        y: 134,
        width: 470,
        height: 104,
        fontSize: 118,
        strokeWidth: 5,
        color: "#ffffff",
        shadow: true,
        autoColor: true,
      },
      "logo-1": { x: 58, y: 284, width: 156, height: 156 },
      "arrow-1": { x: 212, y: 246, width: 122, height: 122, rotation: 0 },
    },
  },
  {
    id: "guide-host-left",
    name: "Legacy Guide · Host left",
    references: "User-supplied TechGuidePro reference",
    description:
      "Mirrored reference composition: host left, text high, logo low right.",
    patches: {
      "person-1": { ...CLOSE_HOST_CROP.left, shadow: true },
      "text-top": {
        x: 320,
        y: 24,
        width: 456,
        height: 104,
        fontSize: 118,
        strokeWidth: 5,
        color: "#ffffff",
        shadow: true,
        autoColor: true,
      },
      "text-bottom": {
        x: 320,
        y: 134,
        width: 456,
        height: 104,
        fontSize: 118,
        strokeWidth: 5,
        color: "#ffffff",
        shadow: true,
        autoColor: true,
      },
      "logo-1": { x: 586, y: 284, width: 156, height: 156 },
      "arrow-1": { x: 468, y: 246, width: 122, height: 122, rotation: 0 },
    },
  },
  {
    id: "host-right-headline",
    name: "Logo High · Host right",
    references: "Tutorial 3, Tutorial 4, Tutorial 13",
    description:
      "Logo leads at the top-left; large text fills the space below it.",
    patches: {
      "person-1": { x: 488, y: 2, width: 330, height: 448 },
      "text-top": { x: 26, y: 210, width: 474, height: 102 },
      "text-bottom": { x: 26, y: 320, width: 474, height: 102 },
      "logo-1": { x: 54, y: 26, width: 164, height: 164 },
      "arrow-1": { x: 214, y: 78, width: 122, height: 122 },
    },
  },
  {
    id: "host-left-dashboard",
    name: "Logo High · Host left",
    references: "Design 2, Comparison 3",
    description:
      "Mirrored logo-first composition with a close-cropped host on the left.",
    patches: {
      "person-1": { x: -18, y: 2, width: 360, height: 448 },
      "text-top": { x: 316, y: 210, width: 458, height: 102 },
      "text-bottom": { x: 316, y: 320, width: 458, height: 102 },
      "logo-1": { x: 580, y: 26, width: 164, height: 164 },
      "arrow-1": { x: 462, y: 78, width: 122, height: 122, rotation: 0 },
    },
  },
  {
    id: "solid-light-circle",
    name: "White + Circle · Host right",
    references: "Simple high-contrast procedural layout",
    description:
      "Plain white canvas with a large brand circle, oversized host, logo and short yellow/black copy.",
    patches: {
      "bg-1": { url: undefined, css: "#ffffff", backgroundTone: "light" },
      "person-1": { ...CLOSE_HOST_CROP.right, shadow: true },
      "text-top": {
        x: 28,
        y: 30,
        width: 458,
        height: 112,
        color: "#ffe21a",
        autoColor: false,
      },
      "text-bottom": {
        x: 28,
        y: 148,
        width: 458,
        height: 112,
        color: "#ffe21a",
        autoColor: false,
      },
      "logo-1": { x: 62, y: 286, width: 164, height: 164 },
      "arrow-1": { x: 218, y: 248, width: 120, height: 120 },
    },
    additions: [
      {
        id: "shape-accent-circle",
        type: "SHAPE",
        x: 505,
        y: 38,
        width: 360,
        height: 360,
        zIndex: 1,
        bgColor: "#dbeafe",
        borderRadius: "50%",
        shadow: false,
      },
    ],
  },
  {
    id: "solid-dark-circle",
    name: "Black + Circle · Host left",
    references: "Simple high-contrast procedural layout",
    description:
      "Plain black canvas with a large brand circle, oversized host, logo and short white copy.",
    patches: {
      "bg-1": { url: undefined, css: "#07090d", backgroundTone: "dark" },
      "person-1": { ...CLOSE_HOST_CROP.left, shadow: true },
      "text-top": {
        x: 318,
        y: 30,
        width: 454,
        height: 112,
        color: "#ffffff",
        autoColor: false,
      },
      "text-bottom": {
        x: 318,
        y: 148,
        width: 454,
        height: 112,
        color: "#ffffff",
        autoColor: false,
      },
      "logo-1": { x: 574, y: 286, width: 164, height: 164 },
      "arrow-1": { x: 454, y: 248, width: 120, height: 120, mirrorX: true },
    },
    additions: [
      {
        id: "shape-accent-circle",
        type: "SHAPE",
        x: -65,
        y: 50,
        width: 380,
        height: 380,
        zIndex: 1,
        bgColor: "#1d4ed8",
        borderRadius: "50%",
        shadow: false,
      },
    ],
  },
];

function applyPresetPatches(
  source: ThumbnailElement[],
  preset: ReferenceLayoutPreset,
): ThumbnailElement[] {
  const managedPresetElements = new Set(["shape-accent-circle", "ui-card"]);
  const ownedPresetElements = new Set(
    preset.additions?.map((element) => element.id) ?? [],
  );
  const patched = source
    .filter(
      (element) =>
        !managedPresetElements.has(element.id) ||
        ownedPresetElements.has(element.id),
    )
    .map((element) => ({
      ...element,
      ...(element.type === "TEXT"
        ? {
            fontFamily: THUMBNAIL_FONT,
            fontWeight: "900",
            fontStyle: "normal",
            color: "#ffffff",
            strokeColor: "#000000",
            strokeWidth: 5,
            bgColor: "transparent",
            borderRadius: "0",
            padding: "0",
          }
        : {}),
      ...(preset.patches[element.id] ?? {}),
    }));
  const present = new Set(patched.map((element) => element.id));
  return [
    ...patched,
    ...(preset.additions ?? [])
      .filter((element) => !present.has(element.id))
      .map((element) => ({ ...element })),
  ];
}

function orderedTextLayers(source: ThumbnailElement[]): ThumbnailElement[] {
  return source
    .filter((layer) => layer.type === "TEXT" && textLineKey(layer.id))
    .sort(
      (a, b) =>
        TEXT_LAYER_IDS.indexOf(a.id as (typeof TEXT_LAYER_IDS)[number]) -
        TEXT_LAYER_IDS.indexOf(b.id as (typeof TEXT_LAYER_IDS)[number]),
    );
}

function copyFromLayout(
  source: ThumbnailElement[],
  fallbackTop = "",
  fallbackBottom = "",
): VariantCopy {
  const byId = new Map(
    source
      .filter((layer) => layer.type === "TEXT")
      .map((layer) => [layer.id, layer.text?.trim() ?? ""]),
  );
  return copyFromLines([
    byId.get("text-top") || fallbackTop,
    byId.get("text-bottom") || fallbackBottom,
    byId.get("text-third") || "",
    byId.get("text-fourth") || "",
  ]);
}

/**
 * Build non-overlapping text hitboxes inside the current template's text zone.
 * Every word remains explicit; the font renderer then maximises each block
 * independently inside its own safe box.
 */
function arrangeTextHitboxes(
  source: ThumbnailElement[],
  requestedLines: readonly string[],
): ThumbnailElement[] {
  const lines = requestedLines
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, MAX_THUMBNAIL_WORDS);
  if (!lines.length) return source;
  const current = orderedTextLayers(source);
  const seed =
    current[0] ?? initialElements().find((layer) => layer.id === "text-top")!;
  const left = current.length
    ? Math.min(...current.map((layer) => layer.x))
    : seed.x;
  const top = current.length
    ? Math.min(...current.map((layer) => layer.y))
    : seed.y;
  const right = current.length
    ? Math.max(...current.map((layer) => layer.x + layer.width))
    : seed.x + seed.width;
  const bottom = current.length
    ? Math.max(...current.map((layer) => layer.y + layer.height))
    : seed.y + seed.height;
  const gap = 6;
  const wantedHeight = Math.max(
    bottom - top,
    lines.length * 62 + (lines.length - 1) * gap,
  );
  const regionTop = Math.max(16, Math.min(top, 434 - wantedHeight));
  const regionHeight = Math.min(276, Math.max(92, wantedHeight));
  const blockHeight = Math.max(
    48,
    (regionHeight - gap * (lines.length - 1)) / lines.length,
  );
  const width = Math.max(180, right - left);
  const untouched = source.filter((layer) => layer.type !== "TEXT");
  const maxZ = Math.max(3, ...source.map((layer) => layer.zIndex));
  const textLayers = lines.map((text, index): ThumbnailElement => ({
    ...seed,
    ...(current[index] ?? {}),
    id: TEXT_LAYER_IDS[index]!,
    type: "TEXT",
    text,
    x: left,
    y: regionTop + index * (blockHeight + gap),
    width,
    height: blockHeight,
    zIndex: maxZ + index + 1,
    fontSize: automaticHeadlineCeiling(width, blockHeight),
    autoFit: true,
    padding: "0 10px",
  }));
  return [...untouched, ...textLayers];
}

function pointArrowAtLogo(source: ThumbnailElement[]): ThumbnailElement[] {
  const logo = source.find((layer) => layer.type === "LOGO");
  const arrow =
    source.find((layer) => layer.id === "arrow-1") ??
    source.find((layer) => layer.type === "SYMBOL");
  if (!logo || !arrow) return source;
  const size = Math.max(88, Math.min(132, arrow.width, arrow.height));
  const x = Math.max(
    8,
    Math.min(800 - size - 8, logo.x + logo.width / 2 - size * 0.36),
  );
  const y = Math.max(
    8,
    Math.min(450 - size - 8, logo.y + logo.height / 2 - size * 0.9),
  );
  return source.map((layer) =>
    layer.id === arrow.id
      ? {
          ...layer,
          x,
          y,
          width: size,
          height: size,
          rotation: 0,
          mirrorX: false,
          mirrorY: false,
          tightBounds: true,
        }
      : layer,
  );
}

function logoForTitle(title: string): string | undefined {
  const normalisedTitle = title.toLowerCase().replace(/[^a-z0-9]/g, "");
  const filename = ALL_APP_LOGOS.find((name) =>
    normalisedTitle.includes(
      name
        .replace(/\.[^.]+$/, "")
        .toLowerCase()
        .replace(/[^a-z0-9]/g, ""),
    ),
  );
  return filename ? `/app_logos_png/${filename}` : undefined;
}

function ThumbnailPreview({
  elements,
  portrait,
}: {
  elements: ThumbnailElement[];
  portrait: boolean;
}) {
  const sourceWidth = portrait ? 450 : 800;
  const sourceHeight = portrait ? 800 : 450;
  const previewRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(portrait ? 190 : 352);
  useEffect(() => {
    const node = previewRef.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry && entry.contentRect.width > 0)
        setWidth(entry.contentRect.width);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const scale = width / sourceWidth;
  return (
    <div
      ref={previewRef}
      style={{
        position: "relative",
        width: "100%",
        aspectRatio: `${sourceWidth} / ${sourceHeight}`,
        overflow: "hidden",
        background: "#000",
        borderRadius: 6,
      }}
    >
      {elements.map((element) => {
        if (element.type === "BACKGROUND") {
          return element.url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={element.id}
              src={element.url}
              alt=""
              style={{
                position: "absolute",
                inset: 0,
                width: "100%",
                height: "100%",
                objectFit: "cover",
                zIndex: element.zIndex,
              }}
            />
          ) : (
            <div
              key={element.id}
              style={{
                position: "absolute",
                inset: 0,
                background: element.css,
                zIndex: element.zIndex,
              }}
            />
          );
        }
        const common: React.CSSProperties = {
          position: "absolute",
          left: element.x * scale,
          top: element.y * scale,
          width: element.width * scale,
          height: element.height * scale,
          zIndex: element.zIndex,
          transform: element.rotation
            ? `rotate(${element.rotation}deg)`
            : undefined,
          transformOrigin: "center",
        };
        if (element.type === "TEXT") {
          return (
            <FittedHeadline
              key={element.id}
              element={element}
              scale={scale}
              style={common}
            />
          );
        }
        if (element.type === "SHAPE")
          return (
            <div
              key={element.id}
              style={{
                ...common,
                background: element.bgColor || "#ffffff",
                borderRadius: element.borderRadius || "0",
                boxShadow: layerShadowCss(element, scale),
              }}
            />
          );
        return element.url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <div
            key={element.id}
            style={{
              ...common,
              background: element.bgColor,
              borderRadius: element.borderRadius,
              padding: (parseFloat(element.padding ?? "0") || 0) * scale,
              boxSizing: "border-box",
            }}
          >
            <BoundedArtwork
              url={element.url}
              width={
                (element.width -
                  2 * (parseFloat(element.padding ?? "0") || 0)) *
                scale
              }
              height={
                (element.height -
                  2 * (parseFloat(element.padding ?? "0") || 0)) *
                scale
              }
              scale={element.imageScale ?? 1}
              tight={element.tightBounds}
              mirrorX={element.mirrorX}
              mirrorY={element.mirrorY}
              shadow={layerShadowCss(element, scale)}
              alt=""
            />
          </div>
        ) : null;
      })}
    </div>
  );
}

export function Composer({
  jobId = null,
  onDirtyChange,
  onBack,
}: {
  jobId?: string | null;
  onDirtyChange?: (dirty: boolean) => void;
  onBack?: () => void;
}) {
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const styleRequest = useRef(0);
  const canvasSurfaceRef = useRef<HTMLDivElement | null>(null);
  const initialLanguageApplied = useRef(false);
  const [canvasViewportWidth, setCanvasViewportWidth] = useState(800);
  const [canvasViewportHeight, setCanvasViewportHeight] = useState(720);
  const [canvasZoom, setCanvasZoom] = useState<"fit" | "100">("fit");
  const layoutsRef = useRef<Record<string, ThumbnailElement[]>>({});
  const dirtyCopyLanguages = useRef(new Set<string>());
  const editVersions = useRef<Record<string, number>>({});
  const [localeOverrides, setLocaleOverrides] = useState<
    Record<string, boolean>
  >({});

  const [activeTab, setActiveTab] = useState<LibraryTab>("PRESETS");
  const [activeLang, setActiveLang] = useState<string>("English");
  const currentEditorLanguage = useRef(activeLang);
  currentEditorLanguage.current = activeLang;
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [aspectRatio, setAspectRatio] = useState<"16:9" | "9:16">("16:9");

  const [customAssets, setCustomAssets] = useState<CustomThumbnailAsset[]>([]);
  const [assetPreferences, setAssetPreferences] = useState<AssetPreferences>(
    {},
  );
  const [elements, setElements] = useState<ThumbnailElement[]>(() =>
    initialElements(),
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [isBatchExporting, setIsBatchExporting] = useState(false);
  const [title, setTitle] = useState("");
  const [variantCopy, setVariantCopy] =
    useState<Record<string, VariantCopy>>(INITIAL_VARIANT_COPY);
  const [bundle, setBundle] = useState<ThumbnailBundle | null>(null);
  const [bundleLoadError, setBundleLoadError] = useState<string | null>(null);
  const [savingApproval, setSavingApproval] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [showAi, setShowAi] = useState(false);
  const [preparingDrafts, setPreparingDrafts] = useState(false);
  const [assetCursor, setAssetCursor] = useState<string | null>(null);
  const [assetHasMore, setAssetHasMore] = useState(false);
  const [loadingAssets, setLoadingAssets] = useState(false);
  const [retryingCopy, setRetryingCopy] = useState(false);
  const [logoName, setLogoName] = useState("");
  const [failedAssetUrls, setFailedAssetUrls] = useState<Set<string>>(
    new Set(),
  );
  // Worker-rendered procedural/AI thumbnails are often deliberately flattened.
  // Review the exact selected pixels by default; never impersonate them with
  // the editor's starter layout. A VA must explicitly start a replacement.
  const [reviewingSelectedLanguages, setReviewingSelectedLanguages] = useState<
    Set<string>
  >(new Set());

  useEffect(() => {
    onDirtyChange?.(dirtyCopyLanguages.current.size > 0);
  }, [bundle, elements, localeOverrides, onDirtyChange]);
  useEffect(() => {
    const preventLoss = (event: BeforeUnloadEvent) => {
      if (dirtyCopyLanguages.current.size > 0) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", preventLoss);
    return () => window.removeEventListener("beforeunload", preventLoss);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLoadingAssets(true);
    const timer = setTimeout(() => {
      void fetch(
        `/api/thumbnails/assets?limit=36&q=${encodeURIComponent(searchQuery)}`,
        { signal: controller.signal },
      )
        .then((response) =>
          response.ok
            ? response.json()
            : Promise.reject(new Error("Could not load shared assets")),
        )
        .then(
          (data: {
            assets: CustomThumbnailAsset[];
            preferences?: AssetPreferences;
            hasMore: boolean;
            nextCursor: string | null;
          }) => {
            if (controller.signal.aborted) return;
            setCustomAssets((local) => [
              ...data.assets,
              ...local.filter(
                (item) =>
                  item.id.startsWith("custom_") &&
                  !data.assets.some((server) => server.id === item.id),
              ),
            ]);
            setAssetPreferences(data.preferences ?? {});
            setAssetHasMore(data.hasMore);
            setAssetCursor(data.nextCursor);
          },
        )
        .catch(() => undefined)
        .finally(() => {
          if (!controller.signal.aborted) setLoadingAssets(false);
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [searchQuery]);

  async function loadMoreAssets() {
    if (!assetCursor || loadingAssets) return;
    setLoadingAssets(true);
    try {
      const response = await fetch(
        `/api/thumbnails/assets?limit=36&q=${encodeURIComponent(searchQuery)}&cursor=${encodeURIComponent(assetCursor)}`,
      );
      if (!response.ok) throw new Error("Could not load more assets");
      const data = (await response.json()) as {
        assets: CustomThumbnailAsset[];
        hasMore: boolean;
        nextCursor: string | null;
      };
      setCustomAssets((previous) => [
        ...previous,
        ...data.assets.filter(
          (asset) => !previous.some((item) => item.id === asset.id),
        ),
      ]);
      setAssetHasMore(data.hasMore);
      setAssetCursor(data.nextCursor);
    } catch (error) {
      alert(error instanceof Error ? error.message : String(error));
    } finally {
      setLoadingAssets(false);
    }
  }

  useEffect(() => {
    if (!jobId) return;
    let cancelled = false;
    setBundle(null);
    setBundleLoadError(null);
    layoutsRef.current = {};
    initialLanguageApplied.current = false;
    dirtyCopyLanguages.current.clear();
    setActiveLang("English");
    fetch(`/api/production/jobs/${jobId}/thumbnail-bundle`)
      .then((response) =>
        response.ok
          ? response.json()
          : Promise.reject(new Error("Could not load video")),
      )
      .then((data: ThumbnailBundle) => {
        if (cancelled) return;
        data = {
          ...data,
          variants: data.variants.map((variant) => ({
            ...variant,
            savedApproved: variant.approved,
            ...(variant.draftLayout
              ? { layout: variant.draftLayout, approved: false }
              : {}),
          })),
        };
        setReviewingSelectedLanguages(
          new Set(
            data.variants
              .filter(
                (variant) =>
                  variant.thumbnailId &&
                  variant.hasSelectedImage &&
                  !variant.layout &&
                  !variant.draftLayout,
              )
              .map(
                (variant) =>
                  CODE_TO_LANG_NAME[variant.language.toLowerCase()] ??
                  variant.language,
              ),
          ),
        );
        const openedVariant =
          data.variants.find((variant) => variant.id === jobId) ??
          data.variants.find(
            (variant) => variant.language.toLowerCase() === "en",
          ) ??
          data.variants[0];
        const openedModes = thumbnailEditorAvailability(
          openedVariant?.thumbnailMode,
          data.generationMode,
        );
        setShowAi(
          !openedModes.procedural ||
            (openedModes.ai &&
              data.generationMode === "ai" &&
              !data.variants.some(
                (variant) => variant.draftLayout || variant.layout,
              )),
        );
        setLocaleOverrides(
          Object.fromEntries(
            data.variants.map((variant) => [
              CODE_TO_LANG_NAME[variant.language] ?? variant.language,
              variant.layout?.localeOverride ?? false,
            ]),
          ),
        );
        const copy = Object.fromEntries(
          Object.entries(INITIAL_VARIANT_COPY).map(([language, lines]) => [
            language,
            { ...lines },
          ]),
        ) as Record<string, VariantCopy>;
        for (const variant of data.variants) {
          const language = CODE_TO_LANG_NAME[variant.language.toLowerCase()];
          if (language) {
            if (variant.layout)
              layoutsRef.current[language] = variant.layout.elements.map(
                (element) => ({ ...element }),
              );
            const effectiveLayout = variant.draftLayout ?? variant.layout;
            const loadedCopy =
              !effectiveLayout &&
              variant.hasSelectedImage &&
              variant.selectedHeadlineLines?.length
                ? copyFromLines(variant.selectedHeadlineLines)
                : copyFromLayout(
                    effectiveLayout?.elements ?? [],
                    variant.thumbnailTextTop ?? "",
                    variant.thumbnailTextBottom ?? "",
                  );
            const originalLines = copyLines(loadedCopy).filter((line) =>
              line.trim(),
            );
            const cleaned = removeRepresentedProduct(
              originalLines.join(" "),
              data.softwareSubject ?? data.softwareLogo?.name,
            );
            const cleanedLines =
              cleaned && cleaned !== originalLines.join(" ")
                ? distributeHeadlineWords(
                    copyWords(cleaned),
                    Math.max(1, originalLines.length),
                  )
                : originalLines;
            copy[language] = copyFromLines(cleanedLines);
            if (cleanedLines.join(" ") !== originalLines.join(" ")) {
              dirtyCopyLanguages.current.add(language);
              variant.approved = false;
              const corrected = arrangeTextHitboxes(
                effectiveLayout?.elements ?? initialElements(),
                cleanedLines,
              );
              layoutsRef.current[language] = corrected;
              variant.layout = {
                aspectRatio: effectiveLayout?.aspectRatio ?? "16:9",
                elements: corrected,
              };
            }
          }
        }
        setBundle(data);
        setVariantCopy(copy);
        const english =
          data.variants.find(
            (variant) => variant.language.toLowerCase() === "en",
          ) ?? data.variants[0];
        if (english?.title) {
          setTitle(english.title);
          if (english.layout) {
            setElements(
              english.layout.elements.map((element) => {
                const key = textLineKey(element.id);
                return key
                  ? { ...element, text: copy.English?.[key] ?? "" }
                  : { ...element };
              }),
            );
            setAspectRatio(english.layout.aspectRatio);
            return;
          }
          const logo = data.softwareLogo?.url ?? logoForTitle(english.title);
          setElements(
            initialElements().map((element) => {
              const key = textLineKey(element.id);
              if (key) return { ...element, text: copy.English?.[key] ?? "" };
              if (element.id === "logo-1")
                return { ...element, url: logo, autoLogo: true };
              return element;
            }),
          );
        }
      })
      .catch((error) => {
        if (!cancelled)
          setBundleLoadError(
            error instanceof Error ? error.message : String(error),
          );
      });
    return () => {
      cancelled = true;
    };
  }, [jobId]);

  // Worker-prepared headlines arrive independently of video localization.
  // Fill only empty local text; never overwrite an operator's unsaved edits.
  useEffect(() => {
    if (!jobId) return;
    const controller = new AbortController();
    const timer = setInterval(async () => {
      try {
        const response = await fetch(
          `/api/production/jobs/${jobId}/thumbnail-bundle`,
          { signal: controller.signal },
        );
        if (!response.ok) return;
        const refreshed = (await response.json()) as ThumbnailBundle;
        setBundle({
          ...refreshed,
          variants: refreshed.variants.map((variant) => ({
            ...variant,
            savedApproved: variant.approved,
            ...(variant.draftLayout ||
            dirtyCopyLanguages.current.has(
              CODE_TO_LANG_NAME[variant.language] ?? "",
            )
              ? { approved: false }
              : {}),
          })),
        });
        setVariantCopy((previous) => {
          const next = { ...previous };
          for (const variant of refreshed.variants) {
            const language = CODE_TO_LANG_NAME[variant.language];
            if (language)
              next[language] = compactCopyPair(
                previous[language]?.top || variant.thumbnailTextTop || "",
                previous[language]?.bottom || variant.thumbnailTextBottom || "",
                previous[language]?.third,
                previous[language]?.fourth,
              );
          }
          return next;
        });
        const active = refreshed.variants.find(
          (variant) => CODE_TO_LANG_NAME[variant.language] === activeLang,
        );
        if (active)
          setElements((previous) =>
            previous.map((element) => {
              if (element.text?.trim()) return element;
              if (element.id === "text-top" && active.thumbnailTextTop)
                return { ...element, text: active.thumbnailTextTop };
              if (element.id === "text-bottom" && active.thumbnailTextBottom)
                return { ...element, text: active.thumbnailTextBottom };
              return element;
            }),
          );
      } catch {
        /* Next poll retries without interrupting editing. */
      }
    }, 10_000);
    return () => {
      clearInterval(timer);
      controller.abort();
    };
  }, [jobId, activeLang]);

  const selectedElement = elements.find((el) => el.id === selectedId);
  useEffect(() => {
    if (!bundle?.softwareLogo?.url) return;
    for (const variant of bundle.variants) {
      const language = CODE_TO_LANG_NAME[variant.language];
      if (!language) continue;
      const protectedLayout =
        variant.approved || Boolean(localeOverrides[language]);
      const existing = layoutsRef.current[language];
      if (existing)
        layoutsRef.current[language] = applySoftwareLogo(
          existing,
          bundle.softwareLogo.url,
          protectedLayout,
        );
      if (language === activeLang)
        setElements((previous) =>
          applySoftwareLogo(
            previous,
            bundle.softwareLogo?.url,
            protectedLayout,
          ),
        );
    }
  }, [bundle, activeLang, localeOverrides]);

  async function retryHeadline() {
    if (!activeVariant?.id || retryingCopy) return;
    setRetryingCopy(true);
    try {
      const response = await fetch(
        `/api/production/jobs/${activeVariant.id}/thumbnail-copy`,
        { method: "POST" },
      );
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error || "Could not queue headline generation");
      toast.success(
        "Headline generation queued. You can keep editing; existing text will not be replaced.",
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setRetryingCopy(false);
    }
  }
  const activeVariant =
    bundle?.variants.find(
      (variant) =>
        (CODE_TO_LANG_NAME[variant.language.toLowerCase()] ?? "English") ===
        activeLang,
    ) ?? bundle?.variants[0];
  const activeEditorModes = thumbnailEditorAvailability(
    activeVariant?.thumbnailMode,
    bundle?.generationMode,
  );
  const reviewingExactSelectedImage = Boolean(
    activeVariant?.thumbnailId && reviewingSelectedLanguages.has(activeLang),
  );
  useEffect(() => {
    if (!activeEditorModes.ai && showAi) setShowAi(false);
    else if (!activeEditorModes.procedural && !showAi) setShowAi(true);
  }, [activeEditorModes.ai, activeEditorModes.procedural, showAi]);
  const availableLanguages = bundle
    ? [
        ...new Set(
          bundle.variants.map(
            (variant) =>
              CODE_TO_LANG_NAME[variant.language.toLowerCase()] ??
              variant.language,
          ),
        ),
      ]
    : [...LANGUAGES];

  const filteredLogos = useMemo(
    () =>
      ALL_APP_LOGOS.filter(
        (name) =>
          !searchQuery ||
          name.toLowerCase().includes(searchQuery.toLowerCase()),
      ),
    [searchQuery],
  );

  const filteredSymbols = useMemo(
    () =>
      ALL_SYMBOLS.filter(
        (sym) =>
          !searchQuery || sym.toLowerCase().includes(searchQuery.toLowerCase()),
      ),
    [searchQuery],
  );

  const canvasWidth = aspectRatio === "16:9" ? 800 : 450;
  const canvasHeight = aspectRatio === "16:9" ? 450 : 800;
  const displayScale = thumbnailCanvasScale(
    canvasViewportWidth,
    canvasWidth,
    aspectRatio === "9:16",
    canvasZoom,
    canvasViewportHeight,
  );

  useEffect(() => {
    const surface = canvasSurfaceRef.current;
    if (!surface) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setCanvasViewportWidth(entry.contentRect.width);
    });
    observer.observe(surface);
    const updateHeight = () => setCanvasViewportHeight(window.innerHeight);
    updateHeight();
    window.addEventListener("resize", updateHeight);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateHeight);
    };
  }, [Boolean(bundle), jobId, showAi]);

  useEffect(() => {
    if (!bundle || initialLanguageApplied.current) return;
    initialLanguageApplied.current = true;
    const parameter = new URLSearchParams(window.location.search).get(
      "language",
    );
    const requestedVariant = bundle.variants.find(
      (variant) => variant.id === jobId,
    );
    const requested =
      CODE_TO_LANG_NAME[parameter ?? requestedVariant?.language ?? "en"];
    if (requested && availableLanguages.includes(requested)) {
      if (initialLocaleOnly(parameter, requestedVariant?.language))
        setLocaleOverrides((previous) => ({ ...previous, [requested]: true }));
      switchLanguage(requested);
    }
  }, [bundle]);

  const previewLayouts = availableLanguages.map((language) => {
    const englishSource =
      activeLang === "English"
        ? elements
        : (layoutsRef.current.English ?? elements);
    return {
      language,
      selectedThumbnailId:
        bundle?.variants.find(
          (variant) =>
            CODE_TO_LANG_NAME[variant.language] === language &&
            variant.hasSelectedImage,
        )?.thumbnailId ?? null,
      selectedThumbnailApproved: Boolean(
        bundle?.variants.find(
          (variant) =>
            CODE_TO_LANG_NAME[variant.language] === language &&
            variant.approved,
        )?.thumbnailId,
      ),
      elements:
        language === activeLang
          ? elements
          : languageLayout(language, englishSource),
    };
  });

  function hostForLanguage(language: string): string | undefined {
    const configured = bundle?.variants.find(
      (variant) => CODE_TO_LANG_NAME[variant.language] === language,
    )?.hostImageUrls;
    if (configured?.length) {
      const index =
        [...`${title}:${language}`].reduce(
          (n, char) => (n * 31 + char.charCodeAt(0)) >>> 0,
          7,
        ) % configured.length;
      return configured[index];
    }
    const hosts = DEFAULT_PERSONAS[language] ?? [];
    if (hosts.length === 0) return undefined;
    const seed = `${title}:${language}`;
    const hash = [...seed].reduce(
      (total, char) => (total * 31 + char.charCodeAt(0)) >>> 0,
      7,
    );
    return hosts[hash % hosts.length]?.url;
  }

  function languageLayout(
    language: string,
    source: ThumbnailElement[],
  ): ThumbnailElement[] {
    const saved = layoutsRef.current[language];
    const hostUrl = hostForLanguage(language);
    const copy = variantCopy[language] ?? EMPTY_COPY;
    const base = saved ?? source;
    return base.map((element) => {
      // A saved locale layout is an explicit operator edit. Do not replace its
      // text with the original generated copy on every switch or export.
      if (saved && element.type === "TEXT" && element.text?.trim())
        return { ...element };
      const key = textLineKey(element.id);
      if (key) return { ...element, text: copy[key] };
      if (element.id === "person-1" && hostUrl && !saved) {
        return { ...element, url: hostUrl };
      }
      return { ...element };
    });
  }

  function switchLanguage(language: string) {
    if (savingApproval) return;
    if (language === activeLang) return;
    layoutsRef.current[activeLang] = elements.map((element) => ({
      ...element,
    }));
    const englishSource =
      activeLang === "English"
        ? elements
        : (layoutsRef.current["English"] ?? elements);
    setElements(languageLayout(language, englishSource));
    setSelectedId(null);
    setActiveLang(language);
  }

  function beginEditableReplacement() {
    if (!reviewingExactSelectedImage) return;
    const preset =
      REFERENCE_LAYOUTS.find((item) => item.id === "ui-card-host-right") ??
      REFERENCE_LAYOUTS[0]!;
    const copy = variantCopy[activeLang] ?? EMPTY_COPY;
    const logo = bundle?.softwareLogo?.url ?? logoForTitle(title);
    const starter = applyPresetPatches(initialElements(), preset).map(
      (element) => {
        const key = textLineKey(element.id);
        if (key) return { ...element, text: copy[key] };
        if (element.id === "logo-1")
          return { ...element, url: logo, autoLogo: true };
        const host = hostForLanguage(activeLang);
        if (element.id === "person-1" && host) return { ...element, url: host };
        return element;
      },
    );
    setReviewingSelectedLanguages((current) => {
      const next = new Set(current);
      next.delete(activeLang);
      return next;
    });
    layoutsRef.current[activeLang] = starter;
    setElements(starter);
    setSelectedId(null);
    dirtyCopyLanguages.current.add(activeLang);
    setBundle((current) =>
      current
        ? {
            ...current,
            variants: current.variants.map((variant) =>
              CODE_TO_LANG_NAME[variant.language] === activeLang
                ? { ...variant, approved: false }
                : variant,
            ),
          }
        : current,
    );
    toast.info(
      "Editable replacement started. The selected rendered image remains unchanged until you explicitly approve the replacement.",
    );
  }

  function editHeadline(language: string, line: TextLineKey, text: string) {
    if (savingApproval) return;
    const safeText = text.replace(/[\r\n]+/g, " ");
    editVersions.current[language] = (editVersions.current[language] ?? 0) + 1;
    dirtyCopyLanguages.current.add(language);
    setVariantCopy((previous) => ({
      ...previous,
      [language]: { ...(previous[language] ?? EMPTY_COPY), [line]: safeText },
    }));
    const id = textLayerId(line);
    const update = (layout: ThumbnailElement[]) =>
      layout.map((element) =>
        element.id === id ? { ...element, text: safeText } : element,
      );
    if (layoutsRef.current[language])
      layoutsRef.current[language] = update(layoutsRef.current[language]!);
    if (activeLang === language) setElements(update);
    setBundle((previous) =>
      previous
        ? {
            ...previous,
            variants: previous.variants.map((variant) =>
              CODE_TO_LANG_NAME[variant.language] === language
                ? { ...variant, approved: false }
                : variant,
            ),
          }
        : previous,
    );
  }

  function arrangeHeadline(blockCount: 1 | 2 | 3 | 4) {
    if (savingApproval) return;
    const cleaned = removeRepresentedProduct(
      copyLines(variantCopy[activeLang]).join(" "),
      bundle?.softwareSubject ?? bundle?.softwareLogo?.name,
    );
    const words = copyWords(cleaned);
    const lines = distributeHeadlineWords(words, blockCount);
    const next = copyFromLines(lines);
    editVersions.current[activeLang] =
      (editVersions.current[activeLang] ?? 0) + 1;
    dirtyCopyLanguages.current.add(activeLang);
    setVariantCopy((previous) => ({ ...previous, [activeLang]: next }));
    const update = (layout: ThumbnailElement[]) =>
      arrangeTextHitboxes(layout, lines);
    setElements(update);
    if (layoutsRef.current[activeLang])
      layoutsRef.current[activeLang] = update(layoutsRef.current[activeLang]!);
    setBundle((previous) =>
      previous
        ? {
            ...previous,
            variants: previous.variants.map((variant) =>
              CODE_TO_LANG_NAME[variant.language] === activeLang
                ? { ...variant, approved: false }
                : variant,
            ),
          }
        : previous,
    );
    setSelectedId(blockCount === 1 ? "text-top" : null);
  }

  function selectPersona(language: string, url: string) {
    if (savingApproval) return;
    layoutsRef.current[activeLang] = elements.map((element) => ({
      ...element,
    }));
    const source =
      language === activeLang
        ? elements
        : languageLayout(language, layoutsRef.current["English"] ?? elements);
    const next = source.map((element) =>
      element.id === "person-1"
        ? { ...element, url, tightBounds: true }
        : { ...element },
    );
    layoutsRef.current[language] = next;
    setElements(next);
    markLayoutsDirty([language]);
    setSelectedId("person-1");
    setActiveLang(language);
  }

  // ── mutation helpers ──
  function markLayoutsDirty(languages: string[]) {
    // Delayed image sampling must not replace edits made while it was loading.
    styleRequest.current++;
    languages.forEach((language) => {
      dirtyCopyLanguages.current.add(language);
      editVersions.current[language] =
        (editVersions.current[language] ?? 0) + 1;
    });
    setBundle((previous) =>
      previous
        ? {
            ...previous,
            variants: previous.variants.map((variant) =>
              languages.includes(CODE_TO_LANG_NAME[variant.language] ?? "")
                ? { ...variant, approved: false }
                : variant,
            ),
          }
        : previous,
    );
  }

  function editLayout(
    update: (previous: ThumbnailElement[]) => ThumbnailElement[],
  ) {
    if (savingApproval) return;
    const next = update(elements);
    const changed = [activeLang];
    if (!localeOverrides[activeLang]) {
      for (const language of availableLanguages) {
        if (language === activeLang || localeOverrides[language]) continue;
        if (
          bundle?.variants.find(
            (variant) => CODE_TO_LANG_NAME[variant.language] === language,
          )?.approved
        )
          continue;
        const localized = languageLayout(
          language,
          layoutsRef.current.English ?? elements,
        );
        layoutsRef.current[language] = inheritThumbnailLayout(next, localized);
        changed.push(language);
      }
    }
    layoutsRef.current[activeLang] = next;
    setElements(next);
    markLayoutsDirty(changed);
  }

  function patchElement(id: string, patch: Partial<ThumbnailElement>) {
    const textKey = textLineKey(id);
    if (textKey && patch.text !== undefined) {
      editHeadline(activeLang, textKey, patch.text);
      return;
    }
    editLayout((prev) =>
      prev.map((el) => (el.id === id ? { ...el, ...patch } : el)),
    );
  }

  function startRotation(
    event: React.PointerEvent<HTMLButtonElement>,
    element: ThumbnailElement,
  ) {
    event.preventDefault();
    event.stopPropagation();
    const box = event.currentTarget.parentElement?.getBoundingClientRect();
    if (!box) return;
    const cx = box.left + box.width / 2;
    const cy = box.top + box.height / 2;
    const initialAngle = Math.atan2(event.clientY - cy, event.clientX - cx);
    const initialRotation = element.rotation ?? 0;
    const move = (pointer: PointerEvent) => {
      const angle = Math.atan2(pointer.clientY - cy, pointer.clientX - cx);
      patchElement(element.id, {
        rotation: Math.round(
          initialRotation + ((angle - initialAngle) * 180) / Math.PI,
        ),
      });
    };
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop, { once: true });
    window.addEventListener("pointercancel", stop, { once: true });
  }

  async function handleAddAsset(type: ElementType, url: string) {
    const replaceLogo =
      type === "LOGO"
        ? selectedElement?.type === "LOGO"
          ? selectedElement
          : elements.find((layer) => layer.type === "LOGO")
        : null;
    if (replaceLogo) {
      editLayout((previous) =>
        previous.map((layer) =>
          layer.id === replaceLogo.id
            ? { ...layer, url, autoLogo: false, tightBounds: true }
            : layer,
        ),
      );
      setSelectedId(replaceLogo.id);
      return;
    }
    if (type === "BACKGROUND") {
      await applyBackground(
        DEFAULT_BGS.find((bg) => bg.url === url) ?? {
          name: "Selected background",
          url,
          backgroundTone: "auto",
        },
      );
      return;
    }
    const newEl: ThumbnailElement = {
      id: nextLayerId(),
      type,
      url,
      x: 220,
      y: 120,
      width: type === "LOGO" ? 140 : type === "PERSON" ? 360 : 100,
      height: type === "LOGO" ? 140 : type === "PERSON" ? 440 : 100,
      zIndex: elements.length + 1,
      rotation: 0,
      shadow: true,
      tightBounds: true,
    };
    editLayout((prev) => [...prev, newEl]);
    setSelectedId(newEl.id);
  }

  async function applyBackground(bg: BgOption) {
    const request = ++styleRequest.current;
    const color =
      backgroundToneColor(bg.backgroundTone) ??
      (await sampleBackgroundColor(bg.url, bg.css));
    if (
      request !== styleRequest.current ||
      currentEditorLanguage.current !== activeLang
    )
      return;
    editLayout((prev) => {
      const layers = prev.some((el) => el.type === "BACKGROUND")
        ? prev
        : [
            {
              id: nextLayerId(),
              type: "BACKGROUND" as const,
              x: 0,
              y: 0,
              width: canvasWidth,
              height: canvasHeight,
              zIndex: 0,
            },
            ...prev,
          ];
      return layers.map((el) =>
        el.type === "BACKGROUND"
          ? {
              ...el,
              url: bg.url,
              css: bg.css,
              backgroundTone: bg.backgroundTone ?? "auto",
            }
          : el.type === "TEXT" && el.autoColor && color
            ? {
                ...el,
                color,
                strokeColor: "#000000",
                strokeWidth: Math.max(5, el.strokeWidth ?? 5),
              }
            : el,
      );
    });
    if (!color)
      toast.info(
        "Background applied. Automatic color could not be sampled; check headline contrast.",
      );
  }

  async function applyReferenceLayout(preset: ReferenceLayoutPreset) {
    const request = ++styleRequest.current;
    const bg = elements.find((layer) => layer.type === "BACKGROUND");
    const color =
      backgroundToneColor(bg?.backgroundTone) ??
      (await sampleBackgroundColor(bg?.url, bg?.css));
    if (
      request !== styleRequest.current ||
      currentEditorLanguage.current !== activeLang
    )
      return;
    editLayout((previous) => {
      const patched = applyPresetPatches(previous, preset).map((el) =>
        el.type === "TEXT" && el.autoColor && color
          ? {
              ...el,
              color,
              strokeColor: "#000000",
              strokeWidth: Math.max(5, el.strokeWidth ?? 5),
            }
          : el,
      );
      const lines = copyLines(variantCopy[activeLang]).filter(Boolean);
      return pointArrowAtLogo(arrangeTextHitboxes(patched, lines));
    });
    setSelectedId(null);
  }

  function handleAddTextElement() {
    const count = orderedTextLayers(elements).length;
    if (count >= 4) {
      toast.error("A thumbnail can contain at most four headline hitboxes.");
      return;
    }
    const words = copyLines(variantCopy[activeLang]).flatMap(copyWords);
    if (words.length <= count) {
      toast.info("Add another word before creating another headline hitbox.");
      return;
    }
    arrangeHeadline(Math.min(4, count + 1) as 1 | 2 | 3 | 4);
  }

  function handleDuplicate(el: ThumbnailElement) {
    const dupe: ThumbnailElement = {
      ...el,
      id: nextLayerId(),
      x: el.x + 20,
      y: el.y + 20,
      zIndex: elements.length + 1,
    };
    editLayout((prev) => [...prev, dupe]);
    setSelectedId(dupe.id);
  }

  function handleMoveLayer(id: string, direction: "up" | "down") {
    editLayout((prev) => {
      const idx = prev.findIndex((e) => e.id === id);
      if (idx < 0) return prev;
      const targetIdx = direction === "up" ? idx + 1 : idx - 1;
      if (targetIdx < 0 || targetIdx >= prev.length) return prev;
      const updated = [...prev];
      const temp = updated[idx]!;
      updated[idx] = updated[targetIdx]!;
      updated[targetIdx] = temp;
      return updated.map((el, i) => ({ ...el, zIndex: i + 1 }));
    });
  }

  function handleDeleteLayer(id: string) {
    editLayout((prev) => prev.filter((el) => el.id !== id));
    if (selectedId === id) setSelectedId(null);
  }

  function addShape(kind: "circle" | "rounded" | "rectangle" = "rounded") {
    const square = kind === "circle";
    const shape: ThumbnailElement = {
      id: nextLayerId(),
      type: "SHAPE",
      x: 160,
      y: 180,
      width: square ? 180 : 220,
      height: square ? 180 : 128,
      zIndex: Math.max(0, ...elements.map((layer) => layer.zIndex)) + 1,
      bgColor: "#ffffff",
      borderRadius:
        kind === "circle" ? "50%" : kind === "rounded" ? "24px" : "0",
      shadow: true,
    };
    editLayout((previous) => [...previous, shape]);
    setSelectedId(shape.id);
  }

  async function handleUploadCustomAsset(
    e: React.ChangeEvent<HTMLInputElement>,
    category: AssetCategory,
  ) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    const form = new FormData();
    form.append("file", file);
    form.append("category", category);
    if (category === "LOGOS" && logoName.trim())
      form.append("name", logoName.trim());
    try {
      const response = await fetch("/api/thumbnails/assets", {
        method: "POST",
        body: form,
      });
      if (!response.ok)
        throw new Error(
          ((await response.json().catch(() => ({}))) as { error?: string })
            .error || "Upload failed",
        );
      const { asset } = (await response.json()) as {
        asset: CustomThumbnailAsset;
      };
      setCustomAssets((previous) => [asset, ...previous]);
      handleAddAsset(
        category === "BGS"
          ? "BACKGROUND"
          : category === "PERSONAS"
            ? "PERSON"
            : category === "SYMBOLS"
              ? "SYMBOL"
              : "LOGO",
        asset.url,
      );
      return;
    } catch (error) {
      alert(error instanceof Error ? error.message : String(error));
    }
  }

  async function updateAssetPreference(
    assetKey: string,
    patch: { hidden?: boolean; includeInRotation?: boolean },
  ) {
    const response = await fetch("/api/thumbnails/assets", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assetKey, ...patch }),
    });
    const result = await response.json();
    if (!response.ok)
      throw new Error(result.error ?? "Preference could not be saved");
    setAssetPreferences((previous) => ({
      ...previous,
      [assetKey]: { ...previous[assetKey], ...patch },
    }));
  }

  const catalogAssets: CollectionAsset[] = [
    ...customAssets.map((asset) => ({
      key: asset.id,
      name: asset.name,
      category: asset.category,
      url: asset.url,
    })),
    ...ALL_APP_LOGOS.map((name) => ({
      key: `/app_logos_png/${name}`,
      name: name.replace(/\.png$/i, "").replace(/[-_]/g, " "),
      category: "LOGOS",
      url: `/app_logos_png/${name}`,
    })),
    ...ALL_SYMBOLS.map((name) => ({
      key: `/bulk_symbols_110_colored/${name}`,
      name: name.replace(/\.png$/i, "").replace(/[-_]/g, " "),
      category: "SYMBOLS",
      url: `/bulk_symbols_110_colored/${name}`,
    })),
    ...DEFAULT_BGS.filter((bg) => bg.url).map((bg) => ({
      key: bg.url!,
      name: bg.name,
      category: "BGS",
      url: bg.url!,
    })),
    ...PERSONA_LANG_ORDER.flatMap((language) =>
      (DEFAULT_PERSONAS[language] ?? []).map((persona) => ({
        key: persona.url,
        name: `${language} · ${persona.name}`,
        category: "PERSONAS",
        url: persona.url,
        language,
      })),
    ),
  ].filter(
    (asset) =>
      (activeTab === "CUSTOM"
        ? customAssets.some((item) => item.id === asset.key)
        : asset.category === activeTab) &&
      (!searchQuery ||
        asset.name.toLowerCase().includes(searchQuery.toLowerCase())),
  );

  // ── exporters ──
  async function handleExportPNG() {
    if (!canvasRef.current) return;
    setIsExporting(true);
    setSelectedId(null);
    try {
      const { blob } = await captureCanvas(elements);
      if (blob) {
        saveAs(
          blob,
          `thumbnail_${(title || "custom").replace(/[^a-z0-9]/gi, "_")}_${activeLang}.png`,
        );
      }
    } catch (err) {
      console.error("Export failed:", err);
      alert(
        "Export failed: " + (err instanceof Error ? err.message : String(err)),
      );
    } finally {
      setIsExporting(false);
    }
  }

  async function handleBatchExportZip() {
    if (!canvasRef.current) return;
    if (bundle && !bundle.ready) {
      alert(
        "The thumbnail drafts are incomplete. Resolve the listed language or localized-copy blockers before exporting.",
      );
      return;
    }
    setIsBatchExporting(true);
    setSelectedId(null);
    // Snapshot the current headline text so we can restore it afterwards.
    const originalElements = elements.map((element) => ({ ...element }));
    layoutsRef.current[activeLang] = elements.map((element) => ({
      ...element,
    }));
    const englishSource = layoutsRef.current["English"] ?? elements;
    try {
      const zip = new JSZip();
      for (const lang of availableLanguages) {
        const layout = languageLayout(lang, englishSource);
        const { blob } = await captureCanvas(layout);
        if (blob) {
          const folder = zip.folder(lang.toLowerCase());
          folder?.file(`thumbnail_${lang.toLowerCase()}.png`, blob);
        }
      }
      const zipContent = await zip.generateAsync({ type: "blob" });
      saveAs(
        zipContent,
        `thumbnail_pack_${(title || "tutorial").replace(/[^a-z0-9]/gi, "_")}_5channels.zip`,
      );
    } catch (err) {
      console.error("Batch export failed:", err);
      alert(
        "Batch export failed: " +
          (err instanceof Error ? err.message : String(err)),
      );
    } finally {
      setElements(originalElements);
      setIsBatchExporting(false);
    }
  }

  async function captureCanvas(
    input: ThumbnailElement[],
  ): Promise<{ blob: Blob; layout: ThumbnailElement[] }> {
    if (!canvasRef.current) throw new Error("Canvas is not ready");
    flushSync(() => {
      setSelectedId(null);
      setElements(input);
    });
    await prepareThumbnailExport(canvasRef.current);
    const context = document.createElement("canvas").getContext("2d");
    if (!context)
      throw new Error("Text measurement is unavailable in this browser.");
    const layout = input.map((element) => {
      if (element.type !== "TEXT" || !element.text?.trim())
        return { ...element };
      const node = canvasRef.current!.querySelector<HTMLElement>(
        `[data-thumbnail-text="${CSS.escape(element.id)}"]`,
      );
      if (!node)
        throw new Error(
          "A text layer is not rendered yet. Reopen the editor and retry.",
        );
      const style = getComputedStyle(node);
      const renderedText =
        style.textTransform === "uppercase"
          ? element.text.toUpperCase()
          : element.text;
      const spacingRatio =
        (parseFloat(style.letterSpacing) || 0) /
        (parseFloat(style.fontSize) || 64);
      const stroke = (element.strokeWidth ?? 8) * 2;
      const horizontalPadding =
        (parseFloat(style.paddingLeft) || 0) +
        (parseFloat(style.paddingRight) || 0);
      const verticalPadding =
        (parseFloat(style.paddingTop) || 0) +
        (parseFloat(style.paddingBottom) || 0);
      const fontSize = fitThumbnailText(
        {
          width: element.width - stroke - horizontalPadding,
          height: element.height - stroke - verticalPadding,
          preferredSize:
            element.autoFit === false
              ? (element.fontSize ?? 64)
              : automaticHeadlineCeiling(element.width, element.height),
          minimumSize: (canvasWidth * 15) / 320,
        },
        (size) => {
          // Canvas cannot resolve CSS var() font families. Use the renderer's
          // computed font, casing and tracking so measurement matches the image.
          context.font = `${style.fontStyle} ${style.fontWeight} ${size}px ${style.fontFamily}`;
          const metrics = context.measureText(renderedText);
          return {
            width:
              Math.max(
                metrics.width,
                (metrics.actualBoundingBoxLeft || 0) +
                  (metrics.actualBoundingBoxRight || 0),
              ) +
              renderedText.length * spacingRatio * size,
            height:
              (metrics.actualBoundingBoxAscent || size) +
              (metrics.actualBoundingBoxDescent || 0),
          };
        },
      );
      return { ...element, text: renderedText, fontSize };
    });
    flushSync(() => {
      setSelectedId(null);
      setElements(layout);
    });
    await prepareThumbnailExport(canvasRef.current);
    for (const node of canvasRef.current.querySelectorAll<HTMLElement>(
      "[data-thumbnail-text]",
    )) {
      if (
        node.scrollWidth > node.clientWidth + 1 ||
        node.scrollHeight > node.clientHeight + 1
      )
        throw new Error(
          "Text still overflows its box. Shorten the headline or enlarge the box before approval.",
        );
    }
    // Workspace zoom is presentation only; exports always use logical canvas dimensions.
    const blob = await toBlob(canvasRef.current, {
      pixelRatio: 2.4,
      width: canvasWidth,
      height: canvasHeight,
      style: { transform: "none", transformOrigin: "top left" },
    });
    if (!blob) throw new Error("Could not render thumbnail");
    return { blob, layout };
  }

  async function saveVariantApproval(
    variant: ThumbnailBundle["variants"][number],
    blob: Blob,
    layout: ThumbnailElement[],
  ) {
    if (!variant.id)
      throw new Error(`${variant.language}: language variant job is missing`);
    const body = new FormData();
    body.append("file", blob, `thumbnail-${variant.language}.png`);
    body.append(
      "layout",
      JSON.stringify({
        aspectRatio,
        elements: layout,
        localeOverride:
          localeOverrides[CODE_TO_LANG_NAME[variant.language] ?? ""] ?? false,
      }),
    );
    const headlineLines = orderedTextLayers(layout)
      .map((element) => element.text?.trim() ?? "")
      .filter(Boolean);
    body.append("top", headlineLines[0] ?? "");
    body.append("bottom", headlineLines.slice(1).join(" "));
    body.append("baseThumbnailId", variant.thumbnailId ?? "");
    body.append("draftRevision", String(variant.draftRevision ?? 0));
    const response = await fetch(
      `/api/production/jobs/${variant.id}/thumbnail/manual`,
      { method: "POST", body },
    );
    if (!response.ok) {
      const failure = await response.json().catch(() => null);
      const reasons = Array.isArray(failure?.reasons)
        ? `: ${failure.reasons.join("; ")}`
        : "";
      throw new Error(`${failure?.error ?? "Save failed"}${reasons}`);
    }
    return (await response.json()) as { thumbnailId: string };
  }

  async function saveDrafts() {
    if (!bundle || savingDraft) return;
    layoutsRef.current[activeLang] = elements.map((layer) => ({ ...layer }));
    const changed = bundle.variants.filter((variant) =>
      dirtyCopyLanguages.current.has(CODE_TO_LANG_NAME[variant.language] ?? ""),
    );
    const requested = changed.length
      ? changed
      : bundle.variants.filter(
          (variant) => CODE_TO_LANG_NAME[variant.language] === activeLang,
        );
    const targets = requested.filter((variant) => variant.id);
    if (!targets.length) {
      toast.error("Prepare this language draft before saving its layout.");
      return;
    }
    setSavingDraft(true);
    try {
      for (const variant of targets) {
        const language = CODE_TO_LANG_NAME[variant.language] ?? activeLang;
        const layout = {
          aspectRatio,
          elements: languageLayout(
            language,
            layoutsRef.current.English ?? elements,
          ),
          localeOverride: localeOverrides[language] ?? false,
        };
        const savedEditVersion = editVersions.current[language] ?? 0;
        const response = await fetch(
          `/api/production/jobs/${variant.id}/thumbnail/draft`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              layout,
              revision: variant.draftRevision ?? 0,
              baseThumbnailId: variant.thumbnailId ?? null,
            }),
          },
        );
        const result = await response.json();
        if (!response.ok)
          throw new Error(
            `${language}: ${result.error ?? "Draft save failed"}`,
          );
        if ((editVersions.current[language] ?? 0) === savedEditVersion)
          dirtyCopyLanguages.current.delete(language);
        setBundle((previous) =>
          previous
            ? {
                ...previous,
                variants: previous.variants.map((item) =>
                  item.id === variant.id
                    ? {
                        ...item,
                        draftRevision: result.revision,
                        draftLayout: layout,
                        approved: false,
                      }
                    : item,
                ),
              }
            : previous,
        );
      }
      toast.success(
        "Draft layouts saved. Approved images and delivery remain unchanged.",
      );
      if (requested.length !== targets.length)
        toast.warning(
          "Unprepared languages remain unsaved. Prepare those language drafts before leaving the editor.",
        );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSavingDraft(false);
    }
  }

  async function saveApproved(all: boolean) {
    if (!bundle) return;
    if (aspectRatio !== "16:9") {
      toast.error(
        "Tutorial delivery requires a 16:9 thumbnail. Switch to 16:9 and check the layout before approving.",
      );
      return;
    }
    setSavingApproval(true);
    layoutsRef.current[activeLang] = elements.map((element) => ({
      ...element,
    }));
    const originalLanguage = activeLang;
    const englishSource = layoutsRef.current.English ?? elements;
    try {
      const variants = all
        ? bundle.variants.filter(
            (variant) =>
              !variant.approved ||
              dirtyCopyLanguages.current.has(
                CODE_TO_LANG_NAME[variant.language] ?? "",
              ),
          )
        : bundle.variants.filter(
            (variant) =>
              (CODE_TO_LANG_NAME[variant.language.toLowerCase()] ??
                "English") === activeLang,
          );
      const blocked = variants.filter((variant) => !variant.id);
      if (blocked.length > 0) {
        throw new Error(
          blocked
            .map(
              (variant) =>
                `${variant.language}: ${variant.reasons.join("; ") || "variant is not ready"}`,
            )
            .join("\n"),
        );
      }
      const rendered: Array<{
        variant: ThumbnailBundle["variants"][number];
        blob: Blob;
        layout: ThumbnailElement[];
      }> = [];
      for (const variant of variants) {
        const language =
          CODE_TO_LANG_NAME[variant.language.toLowerCase()] ?? "English";
        const layout = languageLayout(language, englishSource);
        const copyError = validateProceduralHeadlines(layout);
        if (copyError) throw new Error(`${language}: ${copyError}`);
        flushSync(() => {
          setElements(layout);
          setActiveLang(language);
        });
        rendered.push({ variant, ...(await captureCanvas(layout)) });
      }
      for (const item of rendered) {
        const saved = await saveVariantApproval(
          item.variant,
          item.blob,
          item.layout,
        );
        layoutsRef.current[CODE_TO_LANG_NAME[item.variant.language] ?? ""] =
          item.layout;
        setBundle((current) =>
          current
            ? {
                ...current,
                variants: current.variants.map((variant) =>
                  variant.id === item.variant.id
                    ? {
                        ...variant,
                        thumbnailId: saved.thumbnailId,
                        layout: { aspectRatio, elements: item.layout },
                        draftLayout: null,
                        draftRevision: 0,
                        approved: true,
                        savedApproved: true,
                      }
                    : variant,
                ),
              }
            : current,
        );
        dirtyCopyLanguages.current.delete(
          CODE_TO_LANG_NAME[item.variant.language] ?? "",
        );
      }
      const savedIds = new Set(rendered.map((item) => item.variant.id));
      setBundle((current) =>
        current
          ? {
              ...current,
              variants: current.variants.map((variant) =>
                savedIds.has(variant.id)
                  ? { ...variant, approved: true }
                  : variant,
              ),
            }
          : current,
      );
      toast.success(
        all
          ? "All video thumbnails were saved and approved."
          : `${originalLanguage} thumbnail was saved and approved.`,
      );
      if (
        bundle.variants.every(
          (variant) => variant.approved || savedIds.has(variant.id),
        )
      ) {
        const response = await fetch(
          "/api/production/tutorial-translate/enqueue",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              sourceJobId: bundle.rootId,
              mode: "automatic",
              languages: bundle.variants
                .map((variant) => variant.language)
                .filter((language) => language !== "en"),
            }),
          },
        );
        const result = await response.json().catch(() => null);
        if (!response.ok)
          toast.warning(
            `Thumbnails are saved. Localization needs attention: ${result?.error ?? "queue unavailable"}. Retry from Languages; do not recreate the thumbnails.`,
          );
        else
          toast.success(
            "Thumbnail pack approved. Localization is queued or already in progress.",
          );
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setElements(languageLayout(originalLanguage, englishSource));
      setActiveLang(originalLanguage);
      setSavingApproval(false);
    }
  }

  async function approveSelectedImage(all: boolean) {
    if (!bundle || savingApproval) return;
    const targets = bundle.variants.filter((variant) => {
      const language =
        CODE_TO_LANG_NAME[variant.language.toLowerCase()] ?? variant.language;
      return Boolean(
        variant.thumbnailId &&
        reviewingSelectedLanguages.has(language) &&
        (all || language === activeLang),
      );
    });
    if (!targets.length) {
      toast.error("No rendered thumbnail is selected for this language.");
      return;
    }
    setSavingApproval(true);
    try {
      const response = await fetch("/api/thumbnails/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          thumbnailIds: targets.map((variant) => variant.thumbnailId),
        }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok)
        throw new Error(
          result?.error ?? "Could not approve the selected thumbnail",
        );
      const approvedIds = new Set(targets.map((variant) => variant.id));
      setBundle((current) =>
        current
          ? {
              ...current,
              variants: current.variants.map((variant) =>
                approvedIds.has(variant.id)
                  ? { ...variant, approved: true, savedApproved: true }
                  : variant,
              ),
            }
          : current,
      );

      // English is the master. Its approval is the explicit signal to create
      // configured locale variants; the operator never has to approve fake
      // reconstructions first.
      if (targets.some((variant) => variant.language.toLowerCase() === "en")) {
        const localization = await fetch(
          "/api/production/tutorial-translate/enqueue",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              sourceJobId: bundle.rootId,
              mode: "automatic",
              languages: bundle.variants
                .map((variant) => variant.language)
                .filter((language) => language.toLowerCase() !== "en"),
            }),
          },
        );
        const localizationResult = await localization.json().catch(() => null);
        if (!localization.ok)
          toast.warning(
            `English is approved. Localization needs attention: ${localizationResult?.error ?? "queue unavailable"}.`,
          );
        else
          toast.success(
            "Exact English thumbnail approved. Configured language variants are queued.",
          );
      } else {
        toast.success(
          all
            ? "Exact rendered thumbnails approved."
            : `Exact ${activeLang} thumbnail approved.`,
        );
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSavingApproval(false);
    }
  }

  // ── shared inline style tokens ──
  const panelBtn = (active: boolean): React.CSSProperties => ({
    padding: "9px 12px",
    minHeight: 40,
    borderRadius: 6,
    border: active
      ? "1px solid var(--v2-accent)"
      : "1px solid var(--v2-border-2)",
    background: active ? "rgba(var(--v2-accent-rgb), 0.14)" : "transparent",
    color: active ? "var(--v2-accent)" : TEXT_2,
    fontSize: 13,
    fontWeight: 700,
    cursor: "pointer",
  });

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "7px 9px",
    borderRadius: 6,
    background: "var(--v2-surface-2)",
    border: "1px solid var(--v2-border-2)",
    color: TEXT_1,
    fontSize: 12,
  };

  if (jobId && !bundle)
    return (
      <div role={bundleLoadError ? "alert" : "status"} style={{ padding: 24 }}>
        {bundleLoadError ?? "Loading your saved thumbnail pack…"}
        {bundleLoadError && (
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{ marginLeft: 12 }}
          >
            Retry loading
          </button>
        )}
      </div>
    );

  return (
    <div className={workspace.editor}>
      <header className={workspace.compactHeader}>
        {onBack && (
          <button type="button" onClick={onBack} style={panelBtn(false)}>
            ← Matrix
          </button>
        )}
        <div className={workspace.titleBlock}>
          <h1>{title || "Thumbnail editor"}</h1>
          <span>
            {bundle
              ? `Current edits: ${bundle.variants.filter((variant) => variant.approved).length}/${bundle.variants.length} approved · Saved images: ${bundle.variants.filter((variant) => variant.savedApproved ?? variant.approved).length}/${bundle.variants.length} approved`
              : "Manual thumbnail"}{" "}
            · {activeLang}
          </span>
        </div>
        <label className={workspace.languageSelect}>
          Language
          <select
            aria-label="Editing language"
            value={activeLang}
            onChange={(event) => switchLanguage(event.target.value)}
          >
            {availableLanguages.map((language) => (
              <option key={language} value={language}>
                {language}
                {bundle?.variants.find(
                  (variant) => CODE_TO_LANG_NAME[variant.language] === language,
                )?.approved
                  ? " · Approved"
                  : ""}
              </option>
            ))}
          </select>
        </label>
        {bundle && !showAi && (
          <div className={workspace.compactActions}>
            <button
              type="button"
              disabled={
                reviewingExactSelectedImage ||
                savingApproval ||
                savingDraft ||
                !activeVariant?.id
              }
              onClick={() => void saveDrafts()}
              style={panelBtn(false)}
            >
              {savingDraft ? "Saving…" : "Save draft"}
            </button>
            <button
              type="button"
              disabled={savingApproval || savingDraft || !activeVariant?.id}
              onClick={() =>
                void (reviewingExactSelectedImage
                  ? approveSelectedImage(false)
                  : saveApproved(false))
              }
              style={{
                ...panelBtn(true),
                background: "var(--v2-accent)",
                color: "var(--v2-on-accent)",
              }}
            >
              {savingApproval
                ? "Approving…"
                : reviewingExactSelectedImage
                  ? `Approve exact ${activeLang} image`
                  : `Approve ${activeLang} replacement`}
            </button>
            <button
              type="button"
              disabled={
                savingApproval || bundle.variants.some((variant) => !variant.id)
              }
              onClick={() =>
                void (reviewingExactSelectedImage
                  ? approveSelectedImage(true)
                  : saveApproved(true))
              }
              style={panelBtn(false)}
            >
              {reviewingExactSelectedImage
                ? "Approve rendered images"
                : "Approve replacement pack"}
            </button>
          </div>
        )}
      </header>
      <div className={workspace.utilities}>
        <details className={workspace.reference}>
          <summary>Reference video</summary>
          <div className={workspace.referenceBody}>
            {activeVariant?.videoUrl ? (
              <video
                key={activeVariant.id}
                controls
                preload="none"
                src={activeVariant.videoUrl}
                style={{
                  display: "block",
                  width: "100%",
                  maxHeight: 330,
                  background: "#000",
                  borderRadius: 6,
                }}
              />
            ) : (
              <p>
                The localized video is not ready. You can prepare its thumbnail
                now.
              </p>
            )}
            <p>{activeVariant?.title ?? title}</p>
          </div>
        </details>
        <details>
          <summary>Export & format</summary>
          <div className={workspace.exportOptions}>
            <button
              type="button"
              disabled={isExporting || isBatchExporting}
              onClick={handleExportPNG}
              style={panelBtn(false)}
            >
              {isExporting ? "Exporting…" : "Download PNG"}
            </button>
            <button
              type="button"
              disabled={
                isBatchExporting ||
                isExporting ||
                Boolean(bundle && !bundle.ready)
              }
              onClick={handleBatchExportZip}
              style={panelBtn(false)}
            >
              {isBatchExporting ? "Packaging…" : "Download language ZIP"}
            </button>
            <label>
              Format{" "}
              <select
                aria-label="Thumbnail format"
                value={aspectRatio}
                onChange={(event) =>
                  setAspectRatio(event.target.value as "16:9" | "9:16")
                }
              >
                <option value="16:9">16:9</option>
                <option value="9:16" disabled={Boolean(jobId)}>
                  9:16 Shorts
                </option>
              </select>
            </label>
          </div>
        </details>
        {bundle?.variants.some((variant) => !variant.id) && (
          <button
            type="button"
            disabled={preparingDrafts}
            style={panelBtn(false)}
            onClick={async () => {
              setPreparingDrafts(true);
              try {
                const response = await fetch(
                  `/api/production/jobs/${bundle.rootId}/thumbnail-drafts`,
                  { method: "POST" },
                );
                const result = await response.json();
                if (!response.ok)
                  throw new Error(result.error ?? "Could not prepare drafts");
                const refreshed = await fetch(
                  `/api/production/jobs/${bundle.rootId}/thumbnail-bundle`,
                );
                if (!refreshed.ok)
                  throw new Error(
                    "Drafts saved; reload the editor to refresh.",
                  );
                setBundle(await refreshed.json());
                toast.success(
                  "Language drafts ready. Headlines are prepared by the worker; you can also enter them manually.",
                );
              } catch (error) {
                toast.error(
                  error instanceof Error ? error.message : String(error),
                );
              } finally {
                setPreparingDrafts(false);
              }
            }}
          >
            {preparingDrafts ? "Preparing…" : "Prepare missing language drafts"}
          </button>
        )}
        <span className={workspace.saveState}>
          {activeVariant?.savedApproved && !activeVariant.approved
            ? "Replacement draft · approved image retained"
            : activeVariant?.approved
              ? `${activeLang} saved and approved`
              : "Draft · not yet approved"}
          {dirtyCopyLanguages.current.size
            ? ` · Unsaved: ${[...dirtyCopyLanguages.current].join(", ")}`
            : ""}
        </span>
      </div>
      {activeEditorModes.procedural && activeEditorModes.ai && (
        <div
          role="group"
          aria-label="Thumbnail creation mode"
          style={{ display: "flex", gap: 8 }}
        >
          <button
            type="button"
            className="v2-btn"
            aria-pressed={!showAi}
            onClick={() => setShowAi(false)}
          >
            Procedural editor
          </button>
          <button
            type="button"
            className="v2-btn"
            aria-pressed={showAi}
            onClick={() => setShowAi(true)}
          >
            AI thumbnails
          </button>
        </div>
      )}
      {showAi &&
        (activeVariant?.id ? (
          <TutorialAiPanel
            key={activeVariant.id}
            jobId={activeVariant.id}
            top={copyLines(variantCopy[activeLang])[0] ?? ""}
            bottom={copyLines(variantCopy[activeLang])
              .slice(1)
              .filter(Boolean)
              .join(" ")}
            hasUnsavedEdits={dirtyCopyLanguages.current.size > 0}
          />
        ) : (
          <p>
            Prepare this language draft first to use its assigned channel and
            branding.
          </p>
        ))}
      {!showAi && (
        <>
          {!reviewingExactSelectedImage && (
            <div
              className={workspace.scope}
              role="group"
              aria-label="Layout and artwork edit scope"
            >
              <strong>Apply edits to</strong>
              <div className={workspace.scopeOptions}>
                {[
                  { value: false, label: "Shared layout" },
                  { value: true, label: `${activeLang} only` },
                ].map((option) => (
                  <label key={option.label}>
                    <input
                      type="radio"
                      name="thumbnail-edit-scope"
                      checked={
                        Boolean(localeOverrides[activeLang]) === option.value
                      }
                      onChange={() => {
                        setLocaleOverrides((previous) => ({
                          ...previous,
                          [activeLang]: option.value,
                        }));
                        markLayoutsDirty([activeLang]);
                      }}
                    />
                    {option.label}
                  </label>
                ))}
              </div>
              <details>
                <summary>What changes?</summary>
                <p>
                  {localeOverrides[activeLang]
                    ? `Edits stay in ${activeLang}, protected from future shared edits.`
                    : "Layout and artwork edits carry to other unapproved languages using the shared layout."}{" "}
                  Headlines and assigned hosts remain local. Other approved
                  images and locale overrides are preserved.
                </p>
              </details>
            </div>
          )}
          {/* Main layout */}
          <div
            className={workspace.main}
            data-reviewing-exact={
              reviewingExactSelectedImage ? "true" : "false"
            }
          >
            {/* ── Left: asset library + layers ── */}
            <GlassCard
              className={workspace.library}
              style={{
                padding: 12,
                display: "flex",
                flexDirection: "column",
                gap: 10,
                height: "max(420px, calc(100dvh - 250px))",
              }}
            >
              {/* Category tabs */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                  gap: 8,
                  padding: 3,
                  borderRadius: 8,
                  background: "var(--v2-surface-2)",
                  border: "1px solid var(--v2-border-2)",
                }}
              >
                {(
                  [
                    "PRESETS",
                    "CUSTOM",
                    "PERSONAS",
                    "LOGOS",
                    "SYMBOLS",
                    "SHAPES",
                    "BGS",
                    "LAYERS",
                  ] as const
                ).map((tab) => {
                  const on = activeTab === tab;
                  return (
                    <button
                      key={tab}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setActiveTab(tab)}
                      style={{
                        padding: "6px 2px",
                        borderRadius: 5,
                        border: "none",
                        background: on
                          ? "rgba(var(--v2-accent-rgb), 0.16)"
                          : "transparent",
                        color: on ? "var(--v2-accent)" : TEXT_2,
                        fontSize: 12,
                        minHeight: 36,
                        fontWeight: 600,
                        letterSpacing: 0,
                        cursor: "pointer",
                      }}
                    >
                      {
                        {
                          PRESETS: "Layouts",
                          CUSTOM: "Uploads",
                          PERSONAS: "Characters",
                          LOGOS: "Logos",
                          SYMBOLS: "Symbols",
                          SHAPES: "Shapes",
                          BGS: "Backgrounds",
                          LAYERS: "Layers",
                        }[tab]
                      }
                    </button>
                  );
                })}
              </div>

              {/* Custom upload panel */}
              {activeTab === "CUSTOM" && (
                <div
                  style={{
                    padding: 10,
                    borderRadius: 8,
                    background: "var(--v2-surface-2)",
                    border: "1px solid var(--v2-border-2)",
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                    }}
                  >
                    <span
                      style={{
                        fontSize: 13,
                        fontWeight: 800,
                        letterSpacing: "0.04em",
                        color: TEXT_1,
                      }}
                    >
                      CUSTOM BRAND UPLOAD
                    </span>
                    <button
                      type="button"
                      onClick={handleAddTextElement}
                      style={panelBtn(false)}
                    >
                      + Add Text
                    </button>
                  </div>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr",
                      gap: 8,
                    }}
                  >
                    <label
                      style={{
                        ...panelBtn(false),
                        textAlign: "center",
                        display: "inline-flex",
                        justifyContent: "center",
                        gap: 4,
                      }}
                    >
                      <span
                        className="material-symbols-outlined"
                        style={{ fontSize: 14 }}
                      >
                        upload
                      </span>
                      Face
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        style={{ display: "none" }}
                        onChange={(e) => handleUploadCustomAsset(e, "PERSONAS")}
                      />
                    </label>
                    <label
                      style={{
                        ...panelBtn(false),
                        textAlign: "center",
                        display: "inline-flex",
                        justifyContent: "center",
                        gap: 4,
                      }}
                    >
                      <span
                        className="material-symbols-outlined"
                        style={{ fontSize: 14 }}
                      >
                        upload
                      </span>
                      Symbol
                      <input
                        type="file"
                        accept="image/png,image/svg+xml,image/webp"
                        style={{ display: "none" }}
                        onChange={(e) =>
                          void handleUploadCustomAsset(e, "SYMBOLS")
                        }
                      />
                    </label>
                    <label
                      style={{
                        ...panelBtn(false),
                        textAlign: "center",
                        display: "inline-flex",
                        justifyContent: "center",
                        gap: 4,
                      }}
                    >
                      <span
                        className="material-symbols-outlined"
                        style={{ fontSize: 14 }}
                      >
                        upload
                      </span>
                      Background
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        style={{ display: "none" }}
                        onChange={(e) => void handleUploadCustomAsset(e, "BGS")}
                      />
                    </label>
                    <label
                      style={{
                        ...panelBtn(false),
                        textAlign: "center",
                        display: "inline-flex",
                        justifyContent: "center",
                        gap: 4,
                      }}
                    >
                      <span
                        className="material-symbols-outlined"
                        style={{ fontSize: 14 }}
                      >
                        upload
                      </span>
                      Logo
                      <input
                        type="file"
                        accept="image/png,image/svg+xml,image/webp"
                        style={{ display: "none" }}
                        onChange={(e) => handleUploadCustomAsset(e, "LOGOS")}
                      />
                    </label>
                  </div>
                </div>
              )}

              {/* Search box */}
              {activeTab === "CUSTOM" && (
                <label style={{ color: TEXT_2, fontSize: 12 }}>
                  Software name for logo uploads
                  <input
                    aria-label="Software name for logo uploads"
                    value={logoName}
                    onChange={(event) => setLogoName(event.target.value)}
                    placeholder="e.g. Notion (otherwise filename is used)"
                    style={inputStyle}
                  />
                  <span>
                    Exact software names are matched to tutorial titles. New
                    logos update automatic draft layers; approved images and
                    overrides stay unchanged.
                  </span>
                </label>
              )}
              {jobId &&
                elements.some(
                  (layer) =>
                    layer.type === "LOGO" && layer.autoLogo && !layer.url,
                ) && (
                  <p role="status" style={{ color: TEXT_2, fontSize: 12 }}>
                    No matching software logo yet. Upload a named logo in
                    Custom, select one from Logos, or remove the empty logo
                    layer if this tutorial needs no logo.
                  </p>
                )}
              {activeTab !== "LAYERS" &&
                activeTab !== "PRESETS" &&
                activeTab !== "SHAPES" && (
                  <div style={{ position: "relative" }}>
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Filter assets…"
                      style={inputStyle}
                    />
                    <span
                      className="material-symbols-outlined"
                      style={{
                        position: "absolute",
                        right: 8,
                        top: 7,
                        fontSize: 16,
                        color: TEXT_2,
                        pointerEvents: "none",
                      }}
                    >
                      search
                    </span>
                  </div>
                )}

              {/* Content area */}
              <div style={{ flex: 1, overflowY: "auto", paddingRight: 2 }}>
                {activeTab === "PRESETS" && (
                  <div
                    style={{ display: "flex", flexDirection: "column", gap: 9 }}
                  >
                    <details>
                      <summary style={{ fontSize: 12 }}>About layouts</summary>
                      <p style={{ fontSize: 12, color: TEXT_2 }}>
                        Choose a layout, then adjust its editable person, copy
                        and logo layers.
                      </p>
                    </details>
                    {REFERENCE_LAYOUTS.map((preset) => (
                      <div key={preset.id}>
                        <button
                          type="button"
                          onClick={() => applyReferenceLayout(preset)}
                          style={{
                            padding: 8,
                            borderRadius: 9,
                            border: "1px solid var(--v2-border-2)",
                            background: "var(--v2-surface-2)",
                            color: TEXT_1,
                            cursor: "pointer",
                            textAlign: "left",
                            width: "100%",
                          }}
                        >
                          <ThumbnailPreview
                            elements={applyPresetPatches(elements, preset)}
                            portrait={aspectRatio === "9:16"}
                          />
                          <div
                            style={{
                              marginTop: 5,
                              fontSize: 12,
                              fontWeight: 600,
                              lineHeight: 1.3,
                            }}
                          >
                            {preset.name}
                          </div>
                        </button>
                        <details>
                          <summary style={{ fontSize: 12, padding: "3px 0" }}>
                            Layout details
                          </summary>
                          <p
                            style={{
                              fontSize: 12,
                              color: TEXT_2,
                              margin: "4px 0",
                            }}
                          >
                            {preset.description} Reference: {preset.references}.
                          </p>
                        </details>
                      </div>
                    ))}
                  </div>
                )}

                {activeTab === "SHAPES" && (
                  <div style={{ display: "grid", gap: 8 }}>
                    <p
                      style={{
                        margin: 0,
                        color: TEXT_2,
                        fontSize: 12,
                        lineHeight: 1.45,
                      }}
                    >
                      Add a real editable layer. Drag, resize, recolour, rotate,
                      shadow or send it behind the host from Layers.
                    </p>
                    <button
                      type="button"
                      style={panelBtn(false)}
                      onClick={() => addShape("circle")}
                    >
                      <span className="material-symbols-outlined">circle</span>{" "}
                      Circle
                    </button>
                    <button
                      type="button"
                      style={panelBtn(false)}
                      onClick={() => addShape("rounded")}
                    >
                      <span className="material-symbols-outlined">
                        rounded_corner
                      </span>{" "}
                      Rounded box
                    </button>
                    <button
                      type="button"
                      style={panelBtn(false)}
                      onClick={() => addShape("rectangle")}
                    >
                      <span className="material-symbols-outlined">
                        rectangle
                      </span>{" "}
                      Square-corner box
                    </button>
                  </div>
                )}

                {activeTab === "BGS" && (
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr",
                      gap: 8,
                      marginBottom: 10,
                    }}
                  >
                    {DEFAULT_BGS.filter((background) => background.css).map(
                      (background) => (
                        <button
                          key={background.name}
                          type="button"
                          onClick={() => void applyBackground(background)}
                          style={{
                            ...panelBtn(false),
                            minHeight: 64,
                            background: background.css,
                            color:
                              background.backgroundTone === "dark"
                                ? "#ffffff"
                                : "#111827",
                            border: "1px solid var(--v2-border-2)",
                          }}
                        >
                          {background.name}
                        </button>
                      ),
                    )}
                  </div>
                )}

                {(
                  ["CUSTOM", "LOGOS", "SYMBOLS", "BGS", "PERSONAS"] as string[]
                ).includes(activeTab) && (
                  <AssetCollection
                    assets={catalogAssets}
                    category={activeTab}
                    preferences={assetPreferences}
                    currentBackground={
                      elements.find((layer) => layer.type === "BACKGROUND")?.url
                    }
                    onPreference={updateAssetPreference}
                    onSelect={(asset) => {
                      if (asset.language)
                        selectPersona(asset.language, asset.url);
                      else
                        handleAddAsset(
                          asset.category === "BGS"
                            ? "BACKGROUND"
                            : asset.category === "PERSONAS"
                              ? "PERSON"
                              : asset.category === "LOGOS"
                                ? "LOGO"
                                : "SYMBOL",
                          asset.url,
                        );
                    }}
                  />
                )}
                {assetHasMore && (
                  <button
                    type="button"
                    style={panelBtn(false)}
                    disabled={loadingAssets}
                    onClick={() => void loadMoreAssets()}
                  >
                    {loadingAssets ? "Loading…" : "Load more uploaded assets"}
                  </button>
                )}

                {/* Layer tree */}
                {activeTab === "LAYERS" && (
                  <div
                    style={{ display: "flex", flexDirection: "column", gap: 6 }}
                  >
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 800,
                        letterSpacing: "0.04em",
                        color: TEXT_2,
                        padding: "0 2px",
                      }}
                    >
                      ACTIVE LAYERS ({elements.length})
                    </div>
                    {elements.map((el) => {
                      const on = selectedId === el.id;
                      return (
                        <div
                          key={el.id}
                          draggable={el.type !== "BACKGROUND"}
                          onDragStart={(event) =>
                            event.dataTransfer.setData(
                              "application/x-thumbnail-layer",
                              el.id,
                            )
                          }
                          onDragOver={(event) => event.preventDefault()}
                          onDrop={(event) => {
                            event.preventDefault();
                            const moving = event.dataTransfer.getData(
                              "application/x-thumbnail-layer",
                            );
                            editLayout((previous) =>
                              moveLayerBefore(previous, moving, el.id),
                            );
                          }}
                          role="button"
                          tabIndex={0}
                          aria-label={`Select or drag ${el.type.toLowerCase()} layer ${el.text || el.id}`}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              setSelectedId(el.id);
                            }
                          }}
                          onClick={() => setSelectedId(el.id)}
                          style={{
                            padding: 8,
                            borderRadius: 8,
                            border: on
                              ? "1px solid var(--v2-accent)"
                              : "1px solid var(--v2-border-2)",
                            background: on
                              ? "rgba(var(--v2-accent-rgb), 0.12)"
                              : "var(--v2-surface-2)",
                            cursor: "pointer",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: 6,
                          }}
                        >
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 6,
                              overflow: "hidden",
                            }}
                          >
                            <span
                              style={{
                                fontSize: 8,
                                fontWeight: 800,
                                padding: "1px 4px",
                                borderRadius: 3,
                                background: "var(--v2-surface-2)",
                                color: TEXT_2,
                              }}
                            >
                              {el.type}
                            </span>
                            <span
                              style={{
                                fontSize: 13,
                                color: TEXT_1,
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {el.text || el.url?.split("/").pop() || el.id}
                            </span>
                          </div>
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 2,
                            }}
                          >
                            {(
                              [
                                {
                                  icon: "arrow_upward",
                                  fn: () => handleMoveLayer(el.id, "up"),
                                  title: "Up",
                                },
                                {
                                  icon: "arrow_downward",
                                  fn: () => handleMoveLayer(el.id, "down"),
                                  title: "Down",
                                },
                                {
                                  icon: "content_copy",
                                  fn: () => handleDuplicate(el),
                                  title: "Duplicate",
                                },
                                {
                                  icon: "delete",
                                  fn: () => handleDeleteLayer(el.id),
                                  title: "Delete",
                                },
                              ] as const
                            ).map((a) => (
                              <button
                                key={a.icon}
                                type="button"
                                title={a.title}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  a.fn();
                                }}
                                style={{
                                  padding: 2,
                                  border: "none",
                                  background: "transparent",
                                  color:
                                    a.icon === "delete"
                                      ? "var(--v2-error-soft)"
                                      : TEXT_2,
                                  cursor: "pointer",
                                  display: "inline-flex",
                                }}
                              >
                                <span
                                  className="material-symbols-outlined"
                                  style={{ fontSize: 14 }}
                                >
                                  {a.icon}
                                </span>
                              </button>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </GlassCard>

            {/* ── Right: canvas + inspector ── */}
            <div className={workspace.canvasColumn}>
              <div className={workspace.canvasToolbar}>
                {reviewingExactSelectedImage ? (
                  <button
                    type="button"
                    style={panelBtn(false)}
                    onClick={beginEditableReplacement}
                  >
                    Create editable replacement
                  </button>
                ) : (
                  <button
                    type="button"
                    style={panelBtn(false)}
                    onClick={() => {
                      setActiveTab("SHAPES");
                      addShape("rounded");
                    }}
                  >
                    + Shape
                  </button>
                )}
                <label>
                  Layer{" "}
                  <select
                    aria-label="Select canvas layer"
                    value={selectedId ?? ""}
                    onChange={(event) =>
                      setSelectedId(event.target.value || null)
                    }
                  >
                    <option value="">Choose layer…</option>
                    {elements.map((element) => (
                      <option key={element.id} value={element.id}>
                        {element.type.toLowerCase()} ·{" "}
                        {element.text || element.id}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Zoom{" "}
                  <select
                    aria-label="Canvas zoom"
                    value={canvasZoom}
                    onChange={(event) =>
                      setCanvasZoom(event.target.value as "fit" | "100")
                    }
                  >
                    <option value="fit">Fit workspace</option>
                    <option value="100">100%</option>
                  </select>
                </label>
              </div>
              <div ref={canvasSurfaceRef} className={workspace.canvasSurface}>
                {/* Scaling wrapper — reserves the on-screen (scaled) footprint so the
                unscaled canvas below can be captured at full resolution. */}
                <div
                  style={{
                    width: canvasWidth * displayScale,
                    height: canvasHeight * displayScale,
                  }}
                >
                  <div
                    ref={canvasRef}
                    style={{
                      width: canvasWidth,
                      height: canvasHeight,
                      transform: `scale(${displayScale})`,
                      transformOrigin: "top left",
                      background: "#000",
                      borderRadius: 6,
                      // The canvas is the export crop. Keep the live preview clipped
                      // as well, so a host dragged half outside visibly disappears
                      // at the exact same boundary used by the PNG export.
                      overflow: "hidden",
                      position: "relative",
                      userSelect: "none",
                    }}
                  >
                    {reviewingExactSelectedImage &&
                    activeVariant?.thumbnailId ? (
                      <ThumbnailPreviewImage
                        src={`/api/thumbnails/image/${activeVariant.thumbnailId}`}
                        alt={`Exact selected ${activeLang} thumbnail`}
                        style={{
                          position: "absolute",
                          inset: 0,
                          width: "100%",
                          height: "100%",
                          objectFit: "cover",
                          display: "block",
                        }}
                      />
                    ) : (
                      elements.map((el) => {
                        const isSelected = selectedId === el.id;

                        if (el.type === "BACKGROUND") {
                          if (el.css) {
                            return (
                              <div
                                key={el.id}
                                style={{
                                  position: "absolute",
                                  inset: 0,
                                  width: "100%",
                                  height: "100%",
                                  background: el.css,
                                  pointerEvents: "none",
                                  zIndex: el.zIndex,
                                }}
                              />
                            );
                          }
                          if (el.url) {
                            return (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                key={el.id}
                                src={el.url}
                                alt="Background"
                                style={{
                                  position: "absolute",
                                  inset: 0,
                                  width: "100%",
                                  height: "100%",
                                  objectFit: "cover",
                                  pointerEvents: "none",
                                  zIndex: el.zIndex,
                                }}
                              />
                            );
                          }
                          return null;
                        }

                        return (
                          <Rnd
                            scale={displayScale}
                            key={el.id}
                            position={{ x: el.x, y: el.y }}
                            size={{ width: el.width, height: el.height }}
                            cancel="button,input,select"
                            disableDragging={
                              savingApproval || isExporting || isBatchExporting
                            }
                            onDragStop={(_e, d) =>
                              patchElement(el.id, { x: d.x, y: d.y })
                            }
                            onResizeStop={(_e, _dir, ref, _delta, position) =>
                              patchElement(el.id, {
                                width: parseInt(ref.style.width, 10),
                                height: parseInt(ref.style.height, 10),
                                x: position.x,
                                y: position.y,
                              })
                            }
                            style={{
                              zIndex: el.zIndex,
                              outline: isSelected
                                ? "2px solid var(--v2-accent)"
                                : "none",
                            }}
                            onClick={() => setSelectedId(el.id)}
                          >
                            {isSelected && (
                              <button
                                type="button"
                                aria-label="Rotate layer"
                                title="Drag to rotate"
                                onPointerDown={(event) =>
                                  startRotation(event, el)
                                }
                                onClick={(event) => event.stopPropagation()}
                                style={{
                                  position: "absolute",
                                  left: "50%",
                                  top: 4,
                                  transform: "translateX(-50%)",
                                  width: 24,
                                  height: 24,
                                  borderRadius: "50%",
                                  border: "1px solid var(--v2-accent)",
                                  background: "var(--v2-surface-1)",
                                  color: "var(--v2-accent)",
                                  zIndex: 20,
                                  cursor: "grab",
                                  display: "grid",
                                  placeItems: "center",
                                  padding: 0,
                                }}
                              >
                                <span
                                  className="material-symbols-outlined"
                                  style={{ fontSize: 16 }}
                                >
                                  rotate_right
                                </span>
                              </button>
                            )}
                            {el.type === "TEXT" ? (
                              <FittedHeadline
                                element={el}
                                style={{
                                  width: "100%",
                                  height: "100%",
                                  transform: el.rotation
                                    ? `rotate(${el.rotation}deg)`
                                    : undefined,
                                }}
                              />
                            ) : (
                              <div
                                style={{
                                  width: "100%",
                                  height: "100%",
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  backgroundColor: el.bgColor || "transparent",
                                  borderRadius: el.borderRadius || "0",
                                  padding: el.padding || "0",
                                  boxSizing: "border-box",
                                  boxShadow:
                                    el.type === "SHAPE"
                                      ? layerShadowCss(el)
                                      : undefined,
                                  transform: el.rotation
                                    ? `rotate(${el.rotation}deg)`
                                    : undefined,
                                }}
                              >
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                {el.type === "SHAPE" ? null : !el.url ||
                                  failedAssetUrls.has(el.url) ? (
                                  <button
                                    type="button"
                                    data-missing-asset={el.id}
                                    aria-label={
                                      el.type === "LOGO"
                                        ? "Missing logo — choose a logo before approving"
                                        : "Choose missing image"
                                    }
                                    onClick={() => {
                                      setSelectedId(el.id);
                                      setActiveTab(
                                        el.type === "LOGO" ? "LOGOS" : "CUSTOM",
                                      );
                                    }}
                                    style={{
                                      width: "100%",
                                      height: "100%",
                                      border: "4px solid #dc2626",
                                      borderRadius: 18,
                                      background: "#dc2626",
                                      color: "#ffffff",
                                      fontSize: 24,
                                      fontWeight: 900,
                                      letterSpacing: ".04em",
                                      cursor: "pointer",
                                    }}
                                  >
                                    {el.type === "LOGO" ? "LOGO?" : "IMAGE?"}
                                  </button>
                                ) : (
                                  <BoundedArtwork
                                    url={el.url}
                                    alt={el.type.toLowerCase()}
                                    width={
                                      el.width -
                                      2 * (parseFloat(el.padding ?? "0") || 0)
                                    }
                                    height={
                                      el.height -
                                      2 * (parseFloat(el.padding ?? "0") || 0)
                                    }
                                    scale={el.imageScale ?? 1}
                                    tight={el.tightBounds}
                                    mirrorX={el.mirrorX}
                                    mirrorY={el.mirrorY}
                                    shadow={layerShadowCss(el)}
                                    onError={() =>
                                      setFailedAssetUrls((previous) =>
                                        new Set(previous).add(el.url!),
                                      )
                                    }
                                  />
                                )}
                              </div>
                            )}
                          </Rnd>
                        );
                      })
                    )}
                  </div>
                </div>
              </div>

              {!reviewingExactSelectedImage && (
                <>
                  <div className={workspace.copyGrid}>
                    {orderedTextLayers(elements).map((element, index) => {
                      const line = textLineKey(element.id)!;
                      return (
                        <label
                          key={line}
                          style={{ fontSize: 13, color: TEXT_2 }}
                        >
                          {activeLang} · Headline {index + 1}
                          <input
                            aria-label={`Active ${activeLang} headline ${index + 1}`}
                            value={
                              variantCopy[activeLang]?.[line] ??
                              element.text ??
                              ""
                            }
                            maxLength={48}
                            onFocus={() => setSelectedId(element.id)}
                            onChange={(event) =>
                              editHeadline(activeLang, line, event.target.value)
                            }
                            style={inputStyle}
                          />
                        </label>
                      );
                    })}
                  </div>
                  {validateProceduralHeadlines(elements) && (
                    <p
                      role="status"
                      style={{ color: "var(--v2-text-2)", fontSize: 13 }}
                    >
                      {validateProceduralHeadlines(elements)} You can save a
                      draft while correcting it.
                    </p>
                  )}
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 10,
                      flexWrap: "wrap",
                    }}
                  >
                    <p
                      role="status"
                      style={{ margin: 0, fontSize: 12, color: TEXT_2 }}
                    >
                      {
                        copyLines(variantCopy[activeLang]).flatMap(copyWords)
                          .length
                      }{" "}
                      / {MAX_THUMBNAIL_WORDS} words · every headline maximises
                      inside its own safe hitbox
                    </p>
                    <div
                      role="group"
                      aria-label="Headline line count"
                      style={{ display: "flex", gap: 8, flexWrap: "wrap" }}
                    >
                      {([1, 2, 3, 4] as const).map((count) => (
                        <button
                          key={count}
                          type="button"
                          aria-pressed={
                            orderedTextLayers(elements).length === count
                          }
                          style={panelBtn(
                            orderedTextLayers(elements).length === count,
                          )}
                          onClick={() => arrangeHeadline(count)}
                        >
                          {count} {count === 1 ? "line" : "lines"}
                        </button>
                      ))}
                    </div>
                  </div>
                  {activeVariant?.copyError && (
                    <div
                      role="alert"
                      style={{ fontSize: 13, color: "var(--v2-error-soft)" }}
                    >
                      Headline generation failed: {activeVariant.copyError}.
                      Enter the lines above or{" "}
                      <button
                        type="button"
                        style={panelBtn(false)}
                        disabled={retryingCopy}
                        onClick={() => void retryHeadline()}
                      >
                        {retryingCopy ? "Queueing…" : "Retry headline"}
                      </button>
                    </div>
                  )}
                </>
              )}
              {reviewingExactSelectedImage && (
                <p role="status" style={{ fontSize: 13, color: TEXT_2 }}>
                  You are reviewing the exact quality-checked rendered image.
                  Choose “Create editable replacement” only when this image
                  needs a manual change; the selected image stays intact until a
                  replacement is explicitly approved.
                </p>
              )}
            </div>
            <aside
              className={workspace.inspector}
              aria-label="Selected layer properties"
            >
              <h2>Layer properties</h2>
              {!selectedElement && (
                <p>
                  Select a layer on the canvas or in Layers to edit its
                  appearance and position.
                </p>
              )}
              {/* Property inspector */}
              {selectedElement && (
                <GlassCard
                  style={{
                    padding: 12,
                    display: "flex",
                    flexDirection: "column",
                    gap: 10,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      gap: 12,
                      alignItems: "center",
                      flexWrap: "wrap",
                    }}
                  >
                    <label style={{ fontSize: 13 }}>
                      Layer fill{" "}
                      <input
                        aria-label="Layer fill color"
                        type="color"
                        value={
                          selectedElement.bgColor?.startsWith("#")
                            ? selectedElement.bgColor
                            : "#ffffff"
                        }
                        onChange={(event) =>
                          patchElement(selectedElement.id, {
                            bgColor: event.target.value,
                          })
                        }
                      />
                    </label>
                    <button
                      type="button"
                      style={panelBtn(false)}
                      onClick={() =>
                        patchElement(selectedElement.id, {
                          bgColor: "transparent",
                        })
                      }
                    >
                      No fill
                    </button>
                    <label style={{ fontSize: 13 }}>
                      Corner radius{" "}
                      <input
                        aria-label="Layer corner radius"
                        type="number"
                        min={0}
                        max={400}
                        value={
                          Number.parseFloat(
                            selectedElement.borderRadius || "0",
                          ) || 0
                        }
                        onChange={(event) =>
                          patchElement(selectedElement.id, {
                            borderRadius: `${Math.max(0, Number(event.target.value) || 0)}px`,
                          })
                        }
                        style={{ ...inputStyle, width: 90 }}
                      />
                    </label>
                    <label style={{ fontSize: 13 }}>
                      <input
                        type="checkbox"
                        checked={
                          selectedElement.shadow !== false &&
                          (selectedElement.type === "TEXT" ||
                            Boolean(selectedElement.shadow))
                        }
                        onChange={(event) =>
                          patchElement(selectedElement.id, {
                            shadow: event.target.checked,
                          })
                        }
                      />{" "}
                      Shadow
                    </label>
                    {(selectedElement.shadow ||
                      (selectedElement.type === "TEXT" &&
                        selectedElement.shadow !== false)) && (
                      <details>
                        <summary>Soft shadow settings</summary>
                        <label>
                          Blur{" "}
                          <input
                            aria-label="Shadow blur"
                            type="number"
                            min={0}
                            max={40}
                            value={selectedElement.shadowBlur ?? 12}
                            onChange={(event) =>
                              patchElement(selectedElement.id, {
                                shadowBlur: Math.max(
                                  0,
                                  Math.min(40, Number(event.target.value) || 0),
                                ),
                              })
                            }
                            style={inputStyle}
                          />
                        </label>
                        <label>
                          Opacity{" "}
                          <input
                            aria-label="Shadow opacity"
                            type="range"
                            min={0}
                            max={1}
                            step={0.05}
                            value={selectedElement.shadowOpacity ?? 0.45}
                            onChange={(event) =>
                              patchElement(selectedElement.id, {
                                shadowOpacity: Number(event.target.value),
                              })
                            }
                          />
                        </label>
                        <label>
                          Vertical offset{" "}
                          <input
                            aria-label="Shadow vertical offset"
                            type="number"
                            min={-30}
                            max={30}
                            value={selectedElement.shadowOffsetY ?? 5}
                            onChange={(event) =>
                              patchElement(selectedElement.id, {
                                shadowOffsetY: Math.max(
                                  -30,
                                  Math.min(30, Number(event.target.value) || 0),
                                ),
                              })
                            }
                            style={inputStyle}
                          />
                        </label>
                      </details>
                    )}
                    {selectedElement.type === "TEXT" && (
                      <label>
                        <input
                          type="checkbox"
                          checked={Boolean(selectedElement.autoColor)}
                          onChange={async (event) => {
                            const autoColor = event.target.checked;
                            const id = selectedElement.id;
                            const request = ++styleRequest.current;
                            const bg = elements.find(
                              (layer) => layer.type === "BACKGROUND",
                            );
                            const color = autoColor
                              ? await sampleBackgroundColor(bg?.url, bg?.css)
                              : null;
                            if (
                              request !== styleRequest.current ||
                              currentEditorLanguage.current !== activeLang
                            )
                              return;
                            patchElement(id, {
                              autoColor,
                              ...(color
                                ? {
                                    color,
                                    strokeColor: "#000000",
                                    strokeWidth: 5,
                                  }
                                : {}),
                            });
                          }}
                        />{" "}
                        Auto color: white on dark, yellow on light
                      </label>
                    )}
                    <label style={{ fontSize: 13 }}>
                      Rotation °{" "}
                      <input
                        aria-label="Layer rotation degrees"
                        type="number"
                        min={-180}
                        max={180}
                        value={selectedElement.rotation ?? 0}
                        onChange={(event) =>
                          patchElement(selectedElement.id, {
                            rotation: Math.max(
                              -180,
                              Math.min(180, Number(event.target.value) || 0),
                            ),
                          })
                        }
                        style={{ ...inputStyle, width: 90 }}
                      />
                    </label>
                    {selectedElement.type === "BACKGROUND" && (
                      <label>
                        Background tone
                        <select
                          aria-label="Background light or dark metadata"
                          value={selectedElement.backgroundTone ?? "auto"}
                          onChange={(event) => {
                            const backgroundTone = event.target.value as
                              "light" | "dark" | "auto";
                            void applyBackground({
                              name: "Current background",
                              url: selectedElement.url,
                              css: selectedElement.css,
                              backgroundTone,
                            });
                          }}
                          style={inputStyle}
                        >
                          <option value="auto">
                            Not classified · sample image
                          </option>
                          <option value="light">Light · yellow copy</option>
                          <option value="dark">Dark · white copy</option>
                        </select>
                      </label>
                    )}
                    {["PERSON", "LOGO", "SYMBOL", "UPLOAD"].includes(
                      selectedElement.type,
                    ) && (
                      <label>
                        <input
                          type="checkbox"
                          checked={Boolean(selectedElement.tightBounds)}
                          onChange={(event) =>
                            patchElement(selectedElement.id, {
                              tightBounds: event.target.checked,
                            })
                          }
                        />
                        Tight artwork bounds (remove transparent margins)
                      </label>
                    )}
                    {selectedElement.type === "SYMBOL" && (
                      <div
                        style={{ display: "flex", gap: 8, flexWrap: "wrap" }}
                      >
                        <button
                          type="button"
                          aria-pressed={Boolean(selectedElement.mirrorX)}
                          onClick={() =>
                            patchElement(selectedElement.id, {
                              mirrorX: !selectedElement.mirrorX,
                            })
                          }
                          style={panelBtn(Boolean(selectedElement.mirrorX))}
                        >
                          Mirror horizontally
                        </button>
                        <button
                          type="button"
                          aria-pressed={Boolean(selectedElement.mirrorY)}
                          onClick={() =>
                            patchElement(selectedElement.id, {
                              mirrorY: !selectedElement.mirrorY,
                            })
                          }
                          style={panelBtn(Boolean(selectedElement.mirrorY))}
                        >
                          Mirror vertically
                        </button>
                        <button
                          type="button"
                          onClick={() => editLayout(pointArrowAtLogo)}
                          style={panelBtn(false)}
                        >
                          Point at logo
                        </button>
                      </div>
                    )}
                  </div>
                  {selectedElement.type === "LOGO" && (
                    <div
                      style={{
                        display: "grid",
                        gap: 10,
                        padding: 10,
                        border: "1px solid var(--v2-border-1)",
                        borderRadius: 6,
                      }}
                    >
                      <label style={{ display: "grid", gap: 5, fontSize: 13 }}>
                        Logo artwork size ·{" "}
                        {Math.round((selectedElement.imageScale ?? 1) * 100)}%
                        <input
                          aria-label="Logo artwork size"
                          type="range"
                          min={50}
                          max={180}
                          step={5}
                          value={(selectedElement.imageScale ?? 1) * 100}
                          onChange={(event) =>
                            patchElement(selectedElement.id, {
                              imageScale: Number(event.target.value) / 100,
                            })
                          }
                        />
                      </label>
                      <label
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 8,
                          minHeight: 40,
                          fontSize: 13,
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={
                            selectedElement.bgColor === "#ffffff" &&
                            selectedElement.borderRadius === "50%"
                          }
                          onChange={(event) =>
                            patchElement(
                              selectedElement.id,
                              event.target.checked
                                ? {
                                    bgColor: "#ffffff",
                                    borderRadius: "50%",
                                    padding: "14px",
                                  }
                                : {
                                    bgColor: "transparent",
                                    borderRadius: "0",
                                    padding: "0",
                                  },
                            )
                          }
                        />{" "}
                        White circle behind logo
                      </label>
                    </div>
                  )}
                  <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                    {(["x", "y", "width", "height"] as const).map((field) => (
                      <label
                        key={field}
                        style={{
                          flex: "1 1 100px",
                          fontSize: 13,
                          color: TEXT_2,
                        }}
                      >
                        {field === "x"
                          ? "Horizontal position"
                          : field === "y"
                            ? "Vertical position"
                            : field === "width"
                              ? "Width"
                              : "Height"}
                        <input
                          aria-label={`Layer ${field}`}
                          type="number"
                          value={Math.round(selectedElement[field])}
                          min={
                            field === "width" || field === "height"
                              ? 1
                              : undefined
                          }
                          onChange={(event) => {
                            const value = Number(event.target.value);
                            if (
                              Number.isFinite(value) &&
                              (!(field === "width" || field === "height") ||
                                value > 0)
                            )
                              patchElement(selectedElement.id, {
                                [field]: value,
                              });
                          }}
                          style={inputStyle}
                        />
                      </label>
                    ))}
                  </div>
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 8,
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        flex: 1,
                        minWidth: 0,
                      }}
                    >
                      <span
                        style={{
                          fontSize: 13,
                          fontWeight: 800,
                          padding: "3px 6px",
                          borderRadius: 4,
                          background: "var(--v2-surface-2)",
                          color: TEXT_2,
                        }}
                      >
                        {selectedElement.type}
                      </span>
                      {selectedElement.type === "TEXT" && (
                        <input
                          type="text"
                          value={selectedElement.text || ""}
                          onChange={(e) =>
                            patchElement(selectedElement.id, {
                              text: e.target.value,
                            })
                          }
                          style={{ ...inputStyle, flex: 1, fontWeight: 700 }}
                        />
                      )}
                    </div>
                    <div style={{ display: "flex", gap: 6 }}>
                      <button
                        type="button"
                        onClick={() => handleDuplicate(selectedElement)}
                        style={panelBtn(false)}
                      >
                        Duplicate
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteLayer(selectedElement.id)}
                        style={{
                          ...panelBtn(false),
                          color: "var(--v2-error-soft)",
                        }}
                      >
                        Remove
                      </button>
                    </div>
                  </div>

                  {selectedElement.type === "TEXT" && (
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns:
                          "repeat(auto-fit, minmax(150px, 1fr))",
                        gap: 10,
                        paddingTop: 10,
                        borderTop: "1px solid var(--v2-border-2)",
                      }}
                    >
                      {/* Font family */}
                      <label
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: 3,
                        }}
                      >
                        <span
                          style={{
                            fontSize: 13,
                            fontWeight: 800,
                            color: TEXT_2,
                            letterSpacing: "0.04em",
                          }}
                        >
                          FONT
                        </span>
                        <select
                          value={selectedElement.fontFamily || THUMBNAIL_FONT}
                          onChange={(e) =>
                            patchElement(selectedElement.id, {
                              fontFamily: e.target.value,
                            })
                          }
                          style={inputStyle}
                        >
                          {FONT_OPTIONS.map((f) => (
                            <option key={f.value} value={f.value}>
                              {f.label}
                            </option>
                          ))}
                        </select>
                      </label>

                      {/* Font size */}
                      <label
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: 3,
                        }}
                      >
                        <span
                          style={{
                            fontSize: 13,
                            fontWeight: 800,
                            color: TEXT_2,
                            letterSpacing: "0.04em",
                          }}
                        >
                          MAX SIZE: {selectedElement.fontSize || 64}px
                        </span>
                        <span
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            minHeight: 32,
                            fontSize: 12,
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={selectedElement.autoFit !== false}
                            onChange={(event) =>
                              patchElement(selectedElement.id, {
                                autoFit: event.target.checked,
                              })
                            }
                          />
                          Maximise automatically
                        </span>
                        <input
                          type="range"
                          min={24}
                          max={220}
                          value={selectedElement.fontSize || 64}
                          onChange={(e) =>
                            patchElement(selectedElement.id, {
                              fontSize: parseInt(e.target.value, 10),
                              autoFit: false,
                            })
                          }
                          style={{
                            width: "100%",
                            accentColor: "var(--v2-accent)",
                          }}
                        />
                      </label>

                      {/* Fill color */}
                      <label
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: 3,
                        }}
                      >
                        <span
                          style={{
                            fontSize: 13,
                            fontWeight: 800,
                            color: TEXT_2,
                            letterSpacing: "0.04em",
                          }}
                        >
                          TEXT COLOR
                        </span>
                        <input
                          type="color"
                          value={selectedElement.color || "#ffffff"}
                          onChange={(e) =>
                            patchElement(selectedElement.id, {
                              color: e.target.value,
                              autoColor: false,
                            })
                          }
                          style={{
                            width: "100%",
                            height: 30,
                            borderRadius: 6,
                            border: "1px solid var(--v2-border-2)",
                            background: "var(--v2-surface-2)",
                            cursor: "pointer",
                          }}
                        />
                      </label>

                      {/* Stroke width */}
                      <label
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: 3,
                        }}
                      >
                        <span
                          style={{
                            fontSize: 13,
                            fontWeight: 800,
                            color: TEXT_2,
                            letterSpacing: "0.04em",
                          }}
                        >
                          STROKE: {selectedElement.strokeWidth ?? 8}px
                        </span>
                        <input
                          type="range"
                          min={0}
                          max={20}
                          value={selectedElement.strokeWidth ?? 8}
                          onChange={(e) =>
                            patchElement(selectedElement.id, {
                              strokeWidth: parseInt(e.target.value, 10),
                            })
                          }
                          style={{
                            width: "100%",
                            accentColor: "var(--v2-accent)",
                          }}
                        />
                      </label>
                    </div>
                  )}
                </GlassCard>
              )}
            </aside>
          </div>
          {/* English is always the anchor column; localized versions extend to the
          right and scroll as a single comparison row. This lets QA catch text
          overflow before localized narration/video rendering begins. */}
          <details open className={workspace.secondary}>
            <summary>Compare all language thumbnails</summary>
            <GlassCard className={workspace.previews} style={{ padding: 16 }}>
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 800,
                  color: TEXT_1,
                  marginBottom: 9,
                }}
              >
                ALL LANGUAGE THUMBNAILS · CLICK ONE TO EDIT
              </div>
              <div
                style={{
                  display: "grid",
                  gridAutoFlow: "column",
                  gridAutoColumns: aspectRatio === "16:9" ? 220 : 124,
                  gap: 10,
                  overflowX: "auto",
                  paddingBottom: 7,
                }}
              >
                {previewLayouts.map(
                  ({
                    language,
                    elements: previewElements,
                    selectedThumbnailId,
                    selectedThumbnailApproved,
                  }) => (
                    <button
                      key={language}
                      type="button"
                      aria-label={`Edit ${language} thumbnail`}
                      onClick={() => switchLanguage(language)}
                      style={{
                        padding: 7,
                        borderRadius: 9,
                        border:
                          activeLang === language
                            ? "2px solid var(--v2-accent)"
                            : "1px solid var(--v2-border-2)",
                        background: "var(--v2-surface-2)",
                        cursor: "pointer",
                        textAlign: "left",
                      }}
                    >
                      <div
                        style={{
                          color:
                            language === "English"
                              ? "var(--v2-accent)"
                              : TEXT_1,
                          fontSize: 13,
                          fontWeight: 850,
                          marginBottom: 6,
                        }}
                      >
                        {language === "English"
                          ? "ENGLISH · MASTER"
                          : language.toUpperCase()}
                      </div>
                      {selectedThumbnailId ? (
                        // A selected rendered image is always the review truth,
                        // including before approval. Never preview a reconstruction.
                        // eslint-disable-next-line @next/next/no-img-element
                        <>
                          <ThumbnailPreviewImage
                            src={`/api/thumbnails/image/${selectedThumbnailId}`}
                            alt={`Selected ${language} thumbnail`}
                            style={{
                              width: "100%",
                              aspectRatio: "16 / 9",
                              objectFit: "contain",
                              display: "block",
                            }}
                          />
                          <span
                            style={{
                              display: "block",
                              marginTop: 4,
                              fontSize: 11,
                              color: selectedThumbnailApproved
                                ? "var(--v2-success)"
                                : TEXT_2,
                            }}
                          >
                            {selectedThumbnailApproved
                              ? "Approved"
                              : "Awaiting approval"}
                          </span>
                        </>
                      ) : (
                        <ThumbnailPreview
                          elements={previewElements}
                          portrait={aspectRatio === "9:16"}
                        />
                      )}
                    </button>
                  ),
                )}
              </div>
            </GlassCard>
          </details>
          <details open className={workspace.secondary}>
            <summary>Edit all language headlines</summary>
            <GlassCard className={workspace.copy} style={{ padding: 16 }}>
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 800,
                  color: TEXT_1,
                  marginBottom: 8,
                }}
              >
                LOCALIZED 1–4-LINE THUMBNAIL COPY
              </div>
              <div className={workspace.copyGrid}>
                {availableLanguages.map((lang) => (
                  <label
                    key={lang}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "26px 1fr",
                      gap: 6,
                      alignItems: "center",
                      padding: 5,
                      borderRadius: 7,
                      border:
                        activeLang === lang
                          ? "1px solid var(--v2-accent)"
                          : "1px solid transparent",
                    }}
                  >
                    <button
                      type="button"
                      title={`Edit ${lang}`}
                      onClick={() => switchLanguage(lang)}
                      style={{
                        border: 0,
                        background: "transparent",
                        padding: 0,
                        cursor: "pointer",
                      }}
                    >
                      <FlagIcon code={LANG_NAME_TO_CODE[lang] ?? "en"} />
                    </button>
                    <div style={{ display: "grid", gap: 5 }}>
                      {TEXT_LINE_KEYS.slice(
                        0,
                        Math.max(
                          1,
                          orderedTextLayers(
                            layoutsRef.current.English ?? elements,
                          ).length,
                        ),
                      ).map((line, index) => (
                        <input
                          key={line}
                          value={variantCopy[lang]?.[line] ?? ""}
                          onChange={(event) =>
                            editHeadline(lang, line, event.target.value)
                          }
                          maxLength={48}
                          onFocus={() => switchLanguage(lang)}
                          aria-label={`${lang} thumbnail headline ${index + 1}`}
                          title={`${lang} headline ${index + 1}`}
                          style={inputStyle}
                        />
                      ))}
                    </div>
                  </label>
                ))}
              </div>
            </GlassCard>
          </details>
        </>
      )}
    </div>
  );
}

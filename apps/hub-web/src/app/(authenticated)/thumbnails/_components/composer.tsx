"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Rnd } from "react-rnd";
import { toBlob } from "html-to-image";
import JSZip from "jszip";
import { saveAs } from "file-saver";
import { GlassCard } from "@/app/(authenticated)/_components";
import { FlagIcon } from "@/lib/tutorial/flag-icon";

/**
 * Manual Thumbnail Composer — the PRIMARY, fully-offline thumbnail tool.
 *
 * Ported from the standalone facade tool (repo-root src/pages/ThumbnailStudio.tsx)
 * and reskinned to the V2 design system. Everything here runs 100% client-side:
 * drag/resize layers on a fixed canvas, a static offline asset catalog served
 * from /public, shared uploads persisted on the server (with a local fallback), PNG
 * export (html-to-image), and a launch-network ZIP export that swaps the
 * approved 1–3-word headline and the assigned host for each language.
 *
 * The AI-generation flow (Generate/Archetypes tabs) depends on media-gateway
 * infra the target box does not have; this composer is the real tool + fallback.
 *
 * Channel variants remain editable so a VA can fix font fit before export.
 */

const TEXT_1 = "#e5e2e1";
const TEXT_2 = "#cdc3d7";

const CUSTOM_ASSETS_KEY = "ts_custom_assets";

// English source + the five localized launch channels, in export order.
const LANGUAGES = [
  "English",
  "German",
  "French",
  "Italian",
  "Dutch",
  "Swedish",
] as const;

const INITIAL_VARIANT_TEXT: Record<(typeof LANGUAGES)[number], string> = {
  English: "UPLOAD VIDEO",
  German: "VIDEO HOCHLADEN",
  French: "IMPORTER VIDÉO",
  Italian: "CARICA VIDEO",
  Dutch: "VIDEO UPLOADEN",
  Swedish: "LADDA UPP VIDEO",
};

const FONT_OPTIONS = [
  { label: "Impact (Standard Bold)", value: "Impact" },
  { label: "Anton (Heavy Punch)", value: "Anton" },
  { label: "Montserrat ExtraBold", value: "Montserrat" },
  { label: "Bebas Neue (Tall Condensed)", value: "Bebas Neue" },
  { label: "Plus Jakarta Sans", value: "Plus Jakarta Sans" },
  { label: "Arial Black", value: "Arial Black" },
  { label: "Inter Black", value: "Inter" },
];

// A background swatch is EITHER a served image (url) OR a pure CSS background
// (gradient/solid). The canvas BACKGROUND element carries the same two fields.
interface BgOption {
  name: string;
  url?: string;
  css?: string;
}

const DEFAULT_BGS: BgOption[] = [
  // Original served image backgrounds (public/background/).
  { name: "Abstract Gradient Blue", url: "/background/bg_1_1128207.jpg" },
  { name: "Dark Corporate Slate", url: "/background/bg_5_4386356.jpg" },
  { name: "Neon Glow Studio", url: "/background/bg_6_322338.jpg" },
  { name: "Modern Minimal Tech", url: "/background/bg_9_5717314.jpg" },
  // Built-in CSS studio gradients — no assets required.
  { name: "Dark Slate", css: "linear-gradient(135deg, #1e293b 0%, #0f172a 100%)" },
  { name: "Soft Blue", css: "linear-gradient(135deg, #3b82f6 0%, #1e3a8a 100%)" },
  { name: "Warm Sunset", css: "linear-gradient(135deg, #f97316 0%, #b91c1c 100%)" },
  { name: "Fresh Green", css: "linear-gradient(135deg, #10b981 0%, #065f46 100%)" },
  { name: "Royal Purple", css: "linear-gradient(135deg, #8b5cf6 0%, #3b0764 100%)" },
  { name: "Neutral Gray", css: "linear-gradient(135deg, #9ca3af 0%, #374151 100%)" },
];

// Per-language display order + flag emoji for the grouped PERSONAS library.
const PERSONA_LANG_ORDER = [
  "English",
  "Spanish",
  "German",
  "Italian",
  "French",
  "Portuguese",
  "Japanese",
  "Korean",
  "Swedish",
  "Dutch",
] as const;

// Windows has no flag-emoji glyphs, so these render as SVGs via FlagIcon.
const LANG_NAME_TO_CODE: Record<string, string> = {
  English: "en",
  Spanish: "es",
  German: "de",
  Italian: "it",
  French: "fr",
  Portuguese: "pt",
  Japanese: "ja",
  Korean: "ko",
  Swedish: "sv",
  Dutch: "nl",
};

const CODE_TO_LANG_NAME: Record<string, (typeof LANGUAGES)[number]> = {
  en: "English", english: "English",
  de: "German", german: "German",
  fr: "French", french: "French",
  it: "Italian", italian: "Italian",
  nl: "Dutch", dutch: "Dutch",
  sv: "Swedish", swedish: "Swedish",
};

interface ThumbnailBundle {
  rootId: string;
  variants: Array<{ id: string; language: string; title: string; status: string; videoUrl: string; headline: string | null; approved: boolean }>;
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

// Legacy UUID/persona uploads were different people from the established
// language hosts. Keep one person per language and offer only that person's
// named pose set (pointing, thinking, smiling, etc.).
const DEFAULT_PERSONAS: Record<string, { name: string; url: string }[]> = Object.fromEntries(
  Object.entries(RAW_PERSONAS).map(([language, personas]) => [
    language,
    personas.filter((persona) => !/(removalai|persona_|\/new_)/i.test(persona.url)),
  ]),
);

const ALL_APP_LOGOS = [
  "asana.png", "blender.png", "calendly.png", "cashapp.png", "ChatGPT-Logo.png",
  "clickup.png", "cloudflare.png", "davinciresolve.png", "discord.png", "dropbox.png",
  "ebay.png", "epicgames.png", "etsy.png", "facebook.png", "figma.png",
  "gimp.png", "github.png", "gmail.png", "googlecalendar.png", "googlechrome.png",
  "googledocs.png", "googledrive.png", "googlemaps.png", "googlemeet.png", "googlephotos.png",
  "googlesheets.png", "gumroad.png", "icloud.png", "imessage.png", "inkscape.png",
  "instagram.png", "krita.png", "macos.png", "mailchimp.png", "namecheap.png",
  "netflix.png", "netlify.png", "notion.png", "obsidian.png", "obsstudio.png",
  "paypal.png", "pinterest.png", "playstation.png", "reddit.png", "replit.png",
  "roblox.png", "safari.png", "shopify.png", "snapchat.png", "spotify.png",
  "steam.png", "streamlabs.png", "stripe.png", "telegram.png", "tiktok.png",
  "todoist.png", "trello.png", "twitch.png", "venmo.png", "vercel.png",
  "whatsapp.png", "wix.png", "woocommerce.png", "wordpress.png", "youtube.png",
  "youtubestudio.png", "zapier.png", "zelle.png", "zoom.png",
];

const ALL_SYMBOLS = [
  "curved-arrow.png", "alert-circle.png", "alert-triangle.png", "badge-check.png",
  "badge.png", "bell-ring.png", "bell.png", "camera.png", "check-circle.png",
  "clock.png", "cloud.png", "code.png", "crown.png", "database.png",
  "diamond.png", "dollar-sign.png", "eye.png", "file-text.png", "flame.png",
  "gift.png", "globe.png", "heart.png", "key.png", "laptop.png",
  "lightbulb.png", "lock.png", "megaphone.png", "mic.png", "play.png",
  "rocket.png", "shield.png", "sparkle.png", "sparkles.png", "star.png",
  "target.png", "thumbs-up.png", "trending-up.png", "trophy.png", "tv.png",
  "video.png", "wand-sparkles.png", "zap.png",
];

type ElementType =
  | "TEXT"
  | "PERSON"
  | "LOGO"
  | "SYMBOL"
  | "BACKGROUND"
  | "UPLOAD";

interface ThumbnailElement {
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
}

type AssetCategory = "PERSONAS" | "LOGOS" | "SYMBOLS" | "BGS" | "CUSTOM";

interface CustomThumbnailAsset {
  id: string;
  name: string;
  category: AssetCategory;
  url: string;
  createdAt: string;
}

type LibraryTab = "CUSTOM" | "PERSONAS" | "LOGOS" | "SYMBOLS" | "BGS" | "LAYERS";

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
      url: "/English/american-hero.png",
      x: 20,
      y: 40,
      width: 320,
      height: 410,
      zIndex: 2,
    },
    {
      id: "text-top",
      type: "TEXT",
      text: "LEARN FAST",
      x: 370,
      y: 45,
      width: 400,
      height: 80,
      zIndex: 4,
      fontFamily: "Impact",
      fontSize: 64,
      color: "#ffffff",
      strokeColor: "#000000",
      strokeWidth: 8,
      fontWeight: "bold",
      fontStyle: "italic",
      rotation: 0,
    },
    {
      id: "text-bottom",
      type: "TEXT",
      text: "IN 10 MINS",
      x: 370,
      y: 125,
      width: 400,
      height: 80,
      zIndex: 5,
      fontFamily: "Impact",
      fontSize: 64,
      color: "#ffffff",
      strokeColor: "#000000",
      strokeWidth: 8,
      fontWeight: "bold",
      fontStyle: "italic",
      rotation: 0,
    },
    {
      id: "logo-1",
      type: "LOGO",
      url: "/app_logos_png/notion.png",
      x: 450,
      y: 230,
      width: 150,
      height: 150,
      zIndex: 3,
      bgColor: "#ffffff",
      borderRadius: "50%",
      padding: "16px",
    },
    {
      id: "arrow-1",
      type: "SYMBOL",
      url: "/bulk_symbols_110_colored/curved-arrow.png",
      x: 620,
      y: 150,
      width: 120,
      height: 120,
      zIndex: 6,
      rotation: 0,
    },
  ];
}

function fallbackThumbnailWords(title: string): string {
  return title
    .replace(/^(how to|so |comment |come |come si |hoe |sådan |så )/i, "")
    .replace(/\s+[-–—|:].*$/, "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3)
    .join(" ")
    .toUpperCase();
}

function logoForTitle(title: string): string | undefined {
  const normalisedTitle = title.toLowerCase().replace(/[^a-z0-9]/g, "");
  const filename = ALL_APP_LOGOS.find((name) =>
    normalisedTitle.includes(name.replace(/\.[^.]+$/, "").toLowerCase().replace(/[^a-z0-9]/g, "")),
  );
  return filename ? `/app_logos_png/${filename}` : undefined;
}

function ThumbnailPreview({ elements, portrait }: { elements: ThumbnailElement[]; portrait: boolean }) {
  const sourceWidth = portrait ? 450 : 800;
  const sourceHeight = portrait ? 800 : 450;
  const width = portrait ? 170 : 284;
  const scale = width / sourceWidth;
  return (
    <div style={{ position: "relative", width, height: sourceHeight * scale, overflow: "hidden", background: "#000", borderRadius: 6 }}>
      {elements.map((element) => {
        if (element.type === "BACKGROUND") {
          return element.url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={element.id} src={element.url} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", zIndex: element.zIndex }} />
          ) : (
            <div key={element.id} style={{ position: "absolute", inset: 0, background: element.css, zIndex: element.zIndex }} />
          );
        }
        const common: React.CSSProperties = {
          position: "absolute",
          left: element.x * scale,
          top: element.y * scale,
          width: element.width * scale,
          height: element.height * scale,
          zIndex: element.zIndex,
          transform: element.rotation ? `rotate(${element.rotation}deg)` : undefined,
          transformOrigin: "center",
        };
        if (element.type === "TEXT") {
          return (
            <div key={element.id} style={{ ...common, display: "flex", alignItems: "center", overflow: "hidden", whiteSpace: "nowrap", color: element.color || "#fff", fontFamily: element.fontFamily || "Impact", fontStyle: element.fontStyle || "italic", fontWeight: element.fontWeight || 800, fontSize: (element.fontSize || 64) * scale, lineHeight: 1, WebkitTextStroke: `${(element.strokeWidth ?? 8) * scale}px ${element.strokeColor || "#000"}`, paintOrder: "stroke fill" }}>
              {element.text}
            </div>
          );
        }
        return element.url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={element.id} src={element.url} alt="" style={{ ...common, objectFit: "contain" }} />
        ) : null;
      })}
    </div>
  );
}

export function Composer({ jobId = null }: { jobId?: string | null }) {
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const layoutsRef = useRef<Record<string, ThumbnailElement[]>>({});

  const [activeTab, setActiveTab] = useState<LibraryTab>("CUSTOM");
  const [activeLang, setActiveLang] = useState<string>("English");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [aspectRatio, setAspectRatio] = useState<"16:9" | "9:16">("16:9");

  const [customAssets, setCustomAssets] = useState<CustomThumbnailAsset[]>(() =>
    readCustomAssets(),
  );
  const [elements, setElements] = useState<ThumbnailElement[]>(() =>
    initialElements(),
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [isBatchExporting, setIsBatchExporting] = useState(false);
  const [title, setTitle] = useState("");
  const [variantText, setVariantText] = useState<Record<string, string>>(
    INITIAL_VARIANT_TEXT,
  );
  const [bundle, setBundle] = useState<ThumbnailBundle | null>(null);
  const [savingApproval, setSavingApproval] = useState(false);
  const [assetCursor, setAssetCursor] = useState<string | null>(null);
  const [assetHasMore, setAssetHasMore] = useState(false);
  const [loadingAssets, setLoadingAssets] = useState(false);

  useEffect(() => {
    setLoadingAssets(true);
    fetch("/api/thumbnails/assets?limit=36")
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("Could not load shared assets")))
      .then((data: { assets: CustomThumbnailAsset[]; hasMore: boolean; nextCursor: string | null }) => {
        setCustomAssets((local) => [...data.assets, ...local.filter((item) => !data.assets.some((server) => server.id === item.id))]);
        setAssetHasMore(data.hasMore);
        setAssetCursor(data.nextCursor);
      })
      .catch(() => undefined)
      .finally(() => setLoadingAssets(false));
  }, []);

  async function loadMoreAssets() {
    if (!assetCursor || loadingAssets) return;
    setLoadingAssets(true);
    try {
      const response = await fetch(`/api/thumbnails/assets?limit=36&cursor=${encodeURIComponent(assetCursor)}`);
      if (!response.ok) throw new Error("Could not load more assets");
      const data = await response.json() as { assets: CustomThumbnailAsset[]; hasMore: boolean; nextCursor: string | null };
      setCustomAssets((previous) => [...previous, ...data.assets.filter((asset) => !previous.some((item) => item.id === asset.id))]);
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
    fetch(`/api/production/jobs/${jobId}/thumbnail-bundle`)
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("Could not load video")))
      .then((data: ThumbnailBundle) => {
        setBundle(data);
        const words = { ...INITIAL_VARIANT_TEXT } as Record<string, string>;
        for (const variant of data.variants) {
          const language = CODE_TO_LANG_NAME[variant.language.toLowerCase()];
          if (language) words[language] = variant.headline || fallbackThumbnailWords(variant.title);
        }
        setVariantText(words);
        const english = data.variants.find((variant) => variant.language.toLowerCase() === "en") ?? data.variants[0];
        if (english) {
          setTitle(english.title);
          const logo = logoForTitle(english.title);
          setElements((previous) => previous
            .filter((element) => logo || element.id !== "logo-1")
            .map((element) => {
            if (element.id === "text-top") return { ...element, text: words.English };
            if (element.id === "text-bottom") return { ...element, text: "" };
            if (element.id === "logo-1") return logo ? { ...element, url: logo } : element;
            return element;
          }));
        }
      })
      .catch((error) => alert(error instanceof Error ? error.message : String(error)));
  }, [jobId]);

  const selectedElement = elements.find((el) => el.id === selectedId);
  const activeVariant = bundle?.variants.find(
    (variant) => (CODE_TO_LANG_NAME[variant.language.toLowerCase()] ?? "English") === activeLang,
  ) ?? bundle?.variants[0];
  const availableLanguages = bundle
    ? LANGUAGES.filter((language) => bundle.variants.some(
        (variant) => (CODE_TO_LANG_NAME[variant.language.toLowerCase()] ?? "English") === language,
      ))
    : [...LANGUAGES];

  const filteredLogos = useMemo(
    () =>
      ALL_APP_LOGOS.filter(
        (name) =>
          !searchQuery || name.toLowerCase().includes(searchQuery.toLowerCase()),
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
  const displayScale = aspectRatio === "9:16" ? 0.65 : 1;

  const previewLayouts = availableLanguages.map((language) => {
    const englishSource = activeLang === "English"
      ? elements
      : (layoutsRef.current.English ?? elements);
    return {
      language,
      elements: language === activeLang
        ? elements
        : languageLayout(language, englishSource),
    };
  });

  function hostForLanguage(language: string): string | undefined {
    const hosts = DEFAULT_PERSONAS[language] ?? [];
    if (hosts.length === 0) return undefined;
    const seed = `${title}:${language}`;
    const hash = [...seed].reduce((total, char) => ((total * 31) + char.charCodeAt(0)) >>> 0, 7);
    return hosts[hash % hosts.length]?.url;
  }

  function languageLayout(language: string, source: ThumbnailElement[]): ThumbnailElement[] {
    const saved = layoutsRef.current[language];
    if (saved) return saved.map((element) => ({ ...element }));
    const hostUrl = hostForLanguage(language);
    const words = (variantText[language] ?? "").trim().split(/\s+/).filter(Boolean).slice(0, 3).join(" ").toUpperCase();
    return source.map((element) => {
      if (element.id === "text-top") {
        const fitted = Math.max(24, Math.min(element.fontSize ?? 64, Math.floor((element.width * 1.45) / Math.max(1, words.length))));
        return { ...element, text: words, fontSize: fitted };
      }
      if (element.id === "text-bottom") return { ...element, text: "" };
      if (element.id === "person-1" && hostUrl) return { ...element, url: hostUrl };
      return { ...element };
    });
  }

  function switchLanguage(language: string) {
    if (language === activeLang) return;
    layoutsRef.current[activeLang] = elements.map((element) => ({ ...element }));
    const englishSource = activeLang === "English"
      ? elements
      : (layoutsRef.current["English"] ?? elements);
    setElements(languageLayout(language, englishSource));
    setSelectedId(null);
    setActiveLang(language);
  }

  function selectPersona(language: string, url: string) {
    layoutsRef.current[activeLang] = elements.map((element) => ({ ...element }));
    const source = language === activeLang
      ? elements
      : languageLayout(language, layoutsRef.current["English"] ?? elements);
    const next = source.map((element) =>
      element.id === "person-1" ? { ...element, url } : { ...element },
    );
    layoutsRef.current[language] = next;
    setElements(next);
    setSelectedId("person-1");
    setActiveLang(language);
  }

  // ── mutation helpers ──
  function patchElement(id: string, patch: Partial<ThumbnailElement>) {
    setElements((prev) =>
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
        rotation: Math.round(initialRotation + ((angle - initialAngle) * 180) / Math.PI),
      });
    };
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop, { once: true });
  }

  function handleAddAsset(type: ElementType, url: string) {
    if (type === "BACKGROUND") {
      setElements((prev) =>
        prev.map((el) =>
          el.type === "BACKGROUND" ? { ...el, url, css: undefined } : el,
        ),
      );
      return;
    }
    const newEl: ThumbnailElement = {
      id: `el_${Date.now()}`,
      type,
      url,
      x: 220,
      y: 120,
      width: type === "LOGO" ? 140 : type === "PERSON" ? 300 : 100,
      height: type === "LOGO" ? 140 : type === "PERSON" ? 360 : 100,
      zIndex: elements.length + 1,
      rotation: 0,
    };
    setElements((prev) => [...prev, newEl]);
    setSelectedId(newEl.id);
  }

  function applyBackground(bg: BgOption) {
    setElements((prev) =>
      prev.map((el) =>
        el.type === "BACKGROUND"
          ? { ...el, url: bg.url, css: bg.css }
          : el,
      ),
    );
  }

  function handleAddTextElement() {
    const newText: ThumbnailElement = {
      id: `text_${Date.now()}`,
      type: "TEXT",
      text: "NEW TEXT",
      x: 350,
      y: 200,
      width: 380,
      height: 70,
      zIndex: elements.length + 1,
      fontFamily: "Impact",
      fontSize: 56,
      color: "#ffffff",
      strokeColor: "#000000",
      strokeWidth: 6,
      fontWeight: "bold",
      fontStyle: "italic",
      rotation: 0,
    };
    setElements((prev) => [...prev, newText]);
    setSelectedId(newText.id);
  }

  function handleDuplicate(el: ThumbnailElement) {
    const dupe: ThumbnailElement = {
      ...el,
      id: `el_${Date.now()}`,
      x: el.x + 20,
      y: el.y + 20,
      zIndex: elements.length + 1,
    };
    setElements((prev) => [...prev, dupe]);
    setSelectedId(dupe.id);
  }

  function handleMoveLayer(id: string, direction: "up" | "down") {
    setElements((prev) => {
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
    setElements((prev) => prev.filter((el) => el.id !== id));
    if (selectedId === id) setSelectedId(null);
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
    try {
      const response = await fetch("/api/thumbnails/assets", { method: "POST", body: form });
      if (!response.ok) throw new Error((await response.json().catch(() => ({})) as { error?: string }).error || "Upload failed");
      const { asset } = await response.json() as { asset: CustomThumbnailAsset };
      setCustomAssets((previous) => [asset, ...previous]);
      handleAddAsset(category === "BGS" ? "BACKGROUND" : category === "PERSONAS" ? "PERSON" : "LOGO", asset.url);
      return;
    } catch (error) {
      alert(error instanceof Error ? error.message : String(error));
    }
    /* Offline/local fallback keeps the editor usable if the asset service is
       temporarily unavailable, without losing the operator's selection. */
    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target?.result as string;
      const newAsset: CustomThumbnailAsset = {
        id: `custom_${Date.now()}`,
        name: file.name.replace(/\.[^/.]+$/, ""),
        category,
        url: dataUrl,
        createdAt: new Date().toISOString(),
      };
      const next = [newAsset, ...readCustomAssets()];
      writeCustomAssets(next);
      setCustomAssets(next);
      handleAddAsset(
        category === "BGS"
          ? "BACKGROUND"
          : category === "PERSONAS"
            ? "PERSON"
            : "LOGO",
        dataUrl,
      );
    };
    reader.readAsDataURL(file);
  }

  async function handleDeleteCustomAsset(id: string) {
    if (!id.startsWith("custom_")) {
      const response = await fetch(`/api/thumbnails/assets?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!response.ok) {
        alert("Could not delete the shared asset");
        return;
      }
    }
    const next = readCustomAssets().filter((a) => a.id !== id);
    writeCustomAssets(next);
    setCustomAssets((previous) => previous.filter((asset) => asset.id !== id));
  }

  // ── exporters ──
  async function handleExportPNG() {
    if (!canvasRef.current) return;
    setIsExporting(true);
    setSelectedId(null);
    try {
      await new Promise((r) => setTimeout(r, 200));
      const blob = await toBlob(canvasRef.current, { pixelRatio: 2.4 });
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
    setIsBatchExporting(true);
    setSelectedId(null);
    // Snapshot the current headline text so we can restore it afterwards.
    const originalTop = elements.find((el) => el.id === "text-top")?.text;
    const originalBottom = elements.find((el) => el.id === "text-bottom")?.text;
    const originalPerson = elements.find((el) => el.id === "person-1")?.url;
    layoutsRef.current[activeLang] = elements.map((element) => ({ ...element }));
    const englishSource = layoutsRef.current["English"] ?? elements;
    try {
      const zip = new JSZip();
      for (const lang of availableLanguages) {
        const words = (variantText[lang] ?? "")
          .trim()
          .split(/\s+/)
          .filter(Boolean)
          .slice(0, 3)
          .join(" ")
          .toUpperCase();
        const hostUrl = hostForLanguage(lang);
        const layout = languageLayout(lang, englishSource);
        setElements(
          layout.map((el) => {
            if (el.id === "text-top") return { ...el, text: words };
            if (el.id === "text-bottom") return { ...el, text: "" };
            if (el.id === "person-1" && hostUrl) return { ...el, url: hostUrl };
            return el;
          }),
        );
        // let React flush the text swap before capturing
        await new Promise((r) => setTimeout(r, 250));
        const blob = await toBlob(canvasRef.current, { pixelRatio: 2.4 });
        if (blob) {
          const folder = zip.folder(lang.toLowerCase());
          folder?.file(`thumbnail_${lang.toLowerCase()}.png`, blob);
        }
      }
      const zipContent = await zip.generateAsync({ type: "blob" });
      saveAs(
        zipContent,
        `thumbnail_pack_${(title || "tutorial").replace(/[^a-z0-9]/gi, "_")}_6channels.zip`,
      );
    } catch (err) {
      console.error("Batch export failed:", err);
      alert(
        "Batch export failed: " +
          (err instanceof Error ? err.message : String(err)),
      );
    } finally {
      // restore the pre-batch headline text
      setElements((prev) =>
        prev.map((el) => {
          if (el.id === "text-top" && originalTop !== undefined)
            return { ...el, text: originalTop };
          if (el.id === "text-bottom" && originalBottom !== undefined)
            return { ...el, text: originalBottom };
          if (el.id === "person-1" && originalPerson)
            return { ...el, url: originalPerson };
          return el;
        }),
      );
      setIsBatchExporting(false);
    }
  }

  async function captureCanvas(): Promise<Blob> {
    if (!canvasRef.current) throw new Error("Canvas is not ready");
    setSelectedId(null);
    await new Promise((resolve) => setTimeout(resolve, 180));
    const blob = await toBlob(canvasRef.current, { pixelRatio: 2.4 });
    if (!blob) throw new Error("Could not render thumbnail");
    return blob;
  }

  async function saveVariantApproval(
    variant: ThumbnailBundle["variants"][number],
    language: string,
  ) {
    const blob = await captureCanvas();
    const body = new FormData();
    body.append("file", blob, `thumbnail-${variant.language}.png`);
    body.append("jobId", variant.id);
    body.append("language", variant.language);
    body.append("headline", variantText[language] ?? "");
    body.append("aspectRatio", aspectRatio);
    const response = await fetch("/api/thumbnails/manual", { method: "POST", body });
    if (!response.ok) {
      throw new Error((await response.json().catch(() => null))?.error ?? "Save failed");
    }
  }

  async function saveApproved(all: boolean) {
    if (!bundle) return;
    setSavingApproval(true);
    layoutsRef.current[activeLang] = elements.map((element) => ({ ...element }));
    const originalLanguage = activeLang;
    const englishSource = layoutsRef.current.English ?? elements;
    try {
      const variants = all
        ? bundle.variants
        : bundle.variants.filter(
            (variant) =>
              (CODE_TO_LANG_NAME[variant.language.toLowerCase()] ?? "English") === activeLang,
          );
      for (const variant of variants) {
        const language = CODE_TO_LANG_NAME[variant.language.toLowerCase()] ?? "English";
        const layout = languageLayout(language, englishSource);
        setElements(layout);
        setActiveLang(language);
        await new Promise((resolve) => setTimeout(resolve, 180));
        await saveVariantApproval(variant, language);
      }
      alert(all ? "All video thumbnails were saved and approved." : `${originalLanguage} thumbnail was saved and approved.`);
    } catch (error) {
      alert(error instanceof Error ? error.message : String(error));
    } finally {
      setElements(languageLayout(originalLanguage, englishSource));
      setActiveLang(originalLanguage);
      setSavingApproval(false);
    }
  }

  // ── shared inline style tokens ──
  const panelBtn = (active: boolean): React.CSSProperties => ({
    padding: "6px 10px",
    borderRadius: 6,
    border: active
      ? "1px solid var(--v2-accent)"
      : "1px solid rgba(255,255,255,0.12)",
    background: active ? "rgba(var(--v2-accent-rgb), 0.14)" : "transparent",
    color: active ? "var(--v2-accent)" : TEXT_2,
    fontSize: 11,
    fontWeight: 700,
    cursor: "pointer",
  });

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "7px 9px",
    borderRadius: 6,
    background: "rgba(0,0,0,0.28)",
    border: "1px solid rgba(255,255,255,0.14)",
    color: TEXT_1,
    fontSize: 12,
    outline: "none",
  };

  return (
    <div>
      {bundle && (
        <GlassCard style={{ padding: 14, marginBottom: 14 }}>
          <div style={{ fontSize: 10, fontWeight: 800, color: "var(--v2-accent)", letterSpacing: "0.08em" }}>THUMBNAILS FOR THIS VIDEO</div>
          <div style={{ display: "grid", gridTemplateColumns: "minmax(420px, 1.35fr) minmax(300px, 1fr)", gap: 18, marginTop: 10 }}>
            <div>
              <div style={{ fontSize: 10, fontWeight: 800, color: TEXT_2, marginBottom: 7 }}>VIDEO YOU ARE WORKING ON · {activeLang.toUpperCase()}</div>
              {activeVariant && (
                <>
                  <video key={activeVariant.id} controls preload="metadata" src={activeVariant.videoUrl} style={{ display: "block", width: "100%", maxHeight: 330, background: "#000", borderRadius: 9 }} />
                  <div style={{ marginTop: 8, fontSize: 13, color: TEXT_1, fontWeight: 750 }}>{activeVariant.title}</div>
                </>
              )}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
              <div style={{ fontSize: 10, fontWeight: 800, color: TEXT_2, letterSpacing: ".08em" }}>WORKFLOW</div>
              {["1  Watch the video", "2  Adjust the layout and check every language", "3  Approve the finished thumbnails"].map((step) => (
                <div key={step} style={{ padding: "9px 11px", borderRadius: 7, background: "rgba(255,255,255,.045)", color: TEXT_1, fontSize: 11 }}>{step}</div>
              ))}
              <button type="button" disabled={savingApproval} onClick={() => void saveApproved(false)} style={{ ...panelBtn(true), padding: "11px 14px", marginTop: 4, background: "var(--v2-accent)", color: "#071000", fontSize: 12 }}>
                {activeVariant?.approved ? `${activeLang} approved · Save changes` : `Approve ${activeLang} thumbnail`}
              </button>
              <button type="button" disabled={savingApproval} onClick={() => void saveApproved(true)} style={{ ...panelBtn(false), padding: "10px 14px", fontSize: 12 }}>
                Approve all {bundle.variants.length} language thumbnails
              </button>
            </div>
          </div>
          <div style={{ display: "flex", gap: 10, overflowX: "auto", marginTop: 9 }}>
            {bundle.variants.map((variant) => {
              const language = CODE_TO_LANG_NAME[variant.language.toLowerCase()] ?? "English";
              return (
              <button type="button" onClick={() => switchLanguage(language)} key={variant.id} style={{ minWidth: 220, padding: 9, borderRadius: 8, border: language === activeLang ? "1px solid var(--v2-accent)" : "1px solid rgba(255,255,255,.1)", background: language === activeLang ? "rgba(var(--v2-accent-rgb),.08)" : "transparent", textAlign: "left", cursor: "pointer" }}>
                <div style={{ fontSize: 11, color: TEXT_1, fontWeight: 700 }}>{variant.language.toUpperCase()} · {variant.title}</div>
                <div style={{ display: "flex", gap: 10, marginTop: 6, fontSize: 10 }}>
                  <a href={variant.videoUrl} target="_blank" rel="noreferrer" style={{ color: "var(--v2-accent)" }}>Watch video</a>
                  <span style={{ color: variant.approved ? "#82e6aa" : TEXT_2 }}>{variant.approved ? "Approved" : "Needs approval"}</span>
                </div>
              </button>
              );
            })}
          </div>
        </GlassCard>
      )}
      {/* Toolbar */}
      <GlassCard
        style={{
          padding: 12,
          marginBottom: 14,
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: 12,
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          {/* Aspect toggle */}
          <div
            style={{
              display: "inline-flex",
              padding: 3,
              borderRadius: 8,
              background: "rgba(0,0,0,0.3)",
              border: "1px solid rgba(255,255,255,0.1)",
              gap: 3,
            }}
          >
            {(["16:9", "9:16"] as const).map((ar) => {
              const on = aspectRatio === ar;
              return (
                <button
                  key={ar}
                  type="button"
                  onClick={() => setAspectRatio(ar)}
                  style={{
                    padding: "6px 12px",
                    borderRadius: 6,
                    border: "none",
                    background: on ? "var(--v2-accent)" : "transparent",
                    color: on ? "#0b0b0f" : TEXT_2,
                    fontSize: 11,
                    fontWeight: 800,
                    cursor: "pointer",
                  }}
                >
                  {ar === "16:9" ? "16:9 HD" : "9:16 Shorts"}
                </button>
              );
            })}
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: TEXT_1 }}>
              Manual Composer
            </div>
            <div style={{ fontSize: 10.5, color: TEXT_2 }}>
              Adjust this video’s thumbnail, check its available languages, then approve delivery.
            </div>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <button
            type="button"
            disabled={isExporting || isBatchExporting}
            onClick={handleExportPNG}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "8px 12px",
              borderRadius: 8,
              border: "1px solid rgba(var(--v2-accent-rgb), 0.4)",
              background: "rgba(var(--v2-accent-rgb), 0.12)",
              color: "var(--v2-accent)",
              fontSize: 11.5,
              fontWeight: 700,
              cursor: isExporting || isBatchExporting ? "not-allowed" : "pointer",
              opacity: isExporting || isBatchExporting ? 0.5 : 1,
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
              download
            </span>
            {isExporting ? "Exporting…" : "Download current PNG"}
          </button>
          <button
            type="button"
            disabled={isBatchExporting || isExporting}
            onClick={handleBatchExportZip}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "8px 12px",
              borderRadius: 8,
              border: "none",
              background: "var(--v2-accent)",
              color: "#0b0b0f",
              fontSize: 11.5,
              fontWeight: 800,
              cursor: isBatchExporting || isExporting ? "not-allowed" : "pointer",
              opacity: isBatchExporting || isExporting ? 0.6 : 1,
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
              folder_zip
            </span>
            {isBatchExporting ? "Packaging ZIP…" : availableLanguages.length === 1 ? "Download ZIP" : `Download all ${availableLanguages.length} (ZIP)`}
          </button>
        </div>
      </GlassCard>

      <GlassCard style={{ padding: 12 }}>
        <div style={{ fontSize: 11, fontWeight: 800, color: TEXT_1, marginBottom: 8 }}>
          THUMBNAIL WORDS · MAXIMUM 3 WORDS PER LANGUAGE
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(180px, 1fr))", gap: 8 }}>
          {availableLanguages.map((lang) => (
            <label key={lang} style={{ display: "grid", gridTemplateColumns: "26px 1fr", gap: 6, alignItems: "center", padding: 5, borderRadius: 7, border: activeLang === lang ? "1px solid var(--v2-accent)" : "1px solid transparent" }}>
              <button type="button" title={`Edit ${lang}`} onClick={() => switchLanguage(lang)} style={{ border: 0, background: "transparent", padding: 0, cursor: "pointer" }}>
                <FlagIcon code={LANG_NAME_TO_CODE[lang] ?? "en"} />
              </button>
              <input
                value={variantText[lang] ?? ""}
                onFocus={() => switchLanguage(lang)}
                onChange={(event) => {
                  const value = event.target.value
                    .split(/\s+/)
                    .slice(0, 3)
                    .join(" ");
                  setVariantText((previous) => ({ ...previous, [lang]: value }));
                  if (activeLang === lang) {
                    setElements((previous) => previous.map((element) =>
                      element.id === "text-top" ? { ...element, text: value.toUpperCase() } : element.id === "text-bottom" ? { ...element, text: "" } : element,
                    ));
                  }
                }}
                aria-label={`${lang} thumbnail words`}
                title={lang}
                style={inputStyle}
              />
            </label>
          ))}
        </div>
      </GlassCard>

      {/* English is always the anchor column; localized versions extend to the
          right and scroll as a single comparison row. This lets QA catch text
          overflow before localized narration/video rendering begins. */}
      <GlassCard style={{ padding: 12, marginTop: 14 }}>
        <div style={{ fontSize: 11, fontWeight: 800, color: TEXT_1, marginBottom: 9 }}>
          ALL LANGUAGE THUMBNAILS · CLICK ONE TO EDIT
        </div>
        <div style={{ display: "grid", gridAutoFlow: "column", gridAutoColumns: aspectRatio === "16:9" ? 300 : 190, gap: 10, overflowX: "auto", paddingBottom: 7 }}>
          {previewLayouts.map(({ language, elements: previewElements }) => (
            <button
              key={language}
              type="button"
              onClick={() => switchLanguage(language)}
              style={{ padding: 7, borderRadius: 9, border: activeLang === language ? "2px solid var(--v2-accent)" : "1px solid rgba(255,255,255,.12)", background: "rgba(0,0,0,.22)", cursor: "pointer", textAlign: "left" }}
            >
              <div style={{ color: language === "English" ? "var(--v2-accent)" : TEXT_1, fontSize: 10, fontWeight: 850, marginBottom: 6 }}>
                {language === "English" ? "ENGLISH · MASTER" : language.toUpperCase()}
              </div>
              <ThumbnailPreview elements={previewElements} portrait={aspectRatio === "9:16"} />
            </button>
          ))}
        </div>
      </GlassCard>

      {/* Main layout */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(300px, 380px) 1fr",
          gap: 14,
          alignItems: "start",
        }}
      >
        {/* ── Left: asset library + layers ── */}
        <GlassCard
          style={{
            padding: 12,
            display: "flex",
            flexDirection: "column",
            gap: 10,
            height: 660,
          }}
        >
          {/* Category tabs */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(6, 1fr)",
              gap: 3,
              padding: 3,
              borderRadius: 8,
              background: "rgba(0,0,0,0.3)",
              border: "1px solid rgba(255,255,255,0.1)",
            }}
          >
            {(
              ["CUSTOM", "PERSONAS", "LOGOS", "SYMBOLS", "BGS", "LAYERS"] as const
            ).map((tab) => {
              const on = activeTab === tab;
              return (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setActiveTab(tab)}
                  style={{
                    padding: "6px 2px",
                    borderRadius: 5,
                    border: "none",
                    background: on ? "rgba(var(--v2-accent-rgb), 0.16)" : "transparent",
                    color: on ? "var(--v2-accent)" : TEXT_2,
                    fontSize: 8.5,
                    fontWeight: 800,
                    letterSpacing: "0.03em",
                    cursor: "pointer",
                  }}
                >
                  {tab}
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
                background: "rgba(0,0,0,0.22)",
                border: "1px solid rgba(255,255,255,0.1)",
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
                    fontSize: 9.5,
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
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <label
                  style={{
                    ...panelBtn(false),
                    textAlign: "center",
                    display: "inline-flex",
                    justifyContent: "center",
                    gap: 4,
                  }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 14 }}>
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
                <label style={{ ...panelBtn(false), textAlign: "center", display: "inline-flex", justifyContent: "center", gap: 4 }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 14 }}>upload</span>
                  Symbol
                  <input type="file" accept="image/png,image/svg+xml,image/webp" style={{ display: "none" }} onChange={(e) => void handleUploadCustomAsset(e, "SYMBOLS")} />
                </label>
                <label style={{ ...panelBtn(false), textAlign: "center", display: "inline-flex", justifyContent: "center", gap: 4 }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 14 }}>upload</span>
                  Background
                  <input type="file" accept="image/png,image/jpeg,image/webp" style={{ display: "none" }} onChange={(e) => void handleUploadCustomAsset(e, "BGS")} />
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
                  <span className="material-symbols-outlined" style={{ fontSize: 14 }}>
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
          {activeTab !== "LAYERS" && (
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
            {/* Custom references */}
            {activeTab === "CUSTOM" &&
              (customAssets.length === 0 ? (
                <div
                  style={{
                    textAlign: "center",
                    padding: "40px 12px",
                    color: TEXT_2,
                    fontSize: 11.5,
                  }}
                >
                  <p style={{ fontWeight: 700, color: TEXT_1, margin: "0 0 4px" }}>
                    No custom references uploaded.
                  </p>
                  <p style={{ margin: 0 }}>
                    Upload persona faces or transparent logo PNGs above.
                  </p>
                </div>
              ) : (
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(3, 1fr)",
                    gap: 8,
                  }}
                >
                  {customAssets.map((asset) => (
                    <div key={asset.id} style={{ position: "relative" }}>
                      <button
                        type="button"
                        onClick={() =>
                          handleAddAsset(
                            asset.category === "BGS"
                              ? "BACKGROUND"
                              : asset.category === "PERSONAS"
                                ? "PERSON"
                                : asset.category === "SYMBOLS" ? "SYMBOL" : "LOGO",
                            asset.url,
                          )
                        }
                        style={{
                          width: "100%",
                          aspectRatio: "1 / 1",
                          borderRadius: 8,
                          background: "rgba(255,255,255,0.05)",
                          border: "1px solid rgba(255,255,255,0.12)",
                          padding: 4,
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={asset.url}
                          alt={asset.name}
                          style={{ maxHeight: "100%", maxWidth: "100%", objectFit: "contain" }}
                        />
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDeleteCustomAsset(asset.id)}
                        title="Delete asset"
                        style={{
                          position: "absolute",
                          top: 3,
                          right: 3,
                          padding: 2,
                          borderRadius: 4,
                          border: "none",
                          background: "rgba(0,0,0,0.75)",
                          color: "#fff",
                          cursor: "pointer",
                          display: "inline-flex",
                        }}
                      >
                        <span className="material-symbols-outlined" style={{ fontSize: 13 }}>
                          delete
                        </span>
                      </button>
                    </div>
                  ))}
                  {assetHasMore && (
                    <button type="button" disabled={loadingAssets} onClick={() => void loadMoreAssets()} style={{ ...panelBtn(false), gridColumn: "1 / -1", justifyContent: "center" }}>
                      {loadingAssets ? "Loading…" : "Load more shared assets"}
                    </button>
                  )}
                </div>
              ))}

            {/* Personas — grouped by language with a flag header. Search
                filters host names across every language group. */}
            {activeTab === "PERSONAS" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                {PERSONA_LANG_ORDER.map((lang) => {
                  const hosts = (DEFAULT_PERSONAS[lang] ?? []).filter(
                    (p) =>
                      !searchQuery ||
                      p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                      lang.toLowerCase().includes(searchQuery.toLowerCase()),
                  );
                  if (hosts.length === 0) return null;
                  return (
                    <div
                      key={lang}
                      style={{ display: "flex", flexDirection: "column", gap: 6 }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                          fontSize: 10.5,
                          fontWeight: 800,
                          letterSpacing: "0.03em",
                          color: TEXT_1,
                          borderBottom: "1px solid rgba(255,255,255,0.08)",
                          paddingBottom: 4,
                        }}
                      >
                        <FlagIcon code={LANG_NAME_TO_CODE[lang] ?? ""} />
                        <span>{lang}</span>
                        <span style={{ color: TEXT_2, fontWeight: 700 }}>
                          ({hosts.length})
                        </span>
                      </div>
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "repeat(3, 1fr)",
                          gap: 8,
                        }}
                      >
                        {hosts.map((p, i) => (
                          <button
                            key={i}
                            type="button"
                            title={p.name}
                            onClick={() => {
                              selectPersona(lang, p.url);
                            }}
                            style={{
                              aspectRatio: "1 / 1",
                              borderRadius: 8,
                              background: "rgba(255,255,255,0.05)",
                              border: "1px solid rgba(255,255,255,0.12)",
                              padding: 4,
                              cursor: "pointer",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                            }}
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={p.url}
                              alt={p.name}
                              style={{
                                maxHeight: "100%",
                                maxWidth: "100%",
                                objectFit: "contain",
                              }}
                            />
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Logos */}
            {activeTab === "LOGOS" && (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(3, 1fr)",
                  gap: 8,
                }}
              >
                {filteredLogos.map((name, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => handleAddAsset("LOGO", `/app_logos_png/${name}`)}
                    style={{
                      aspectRatio: "1 / 1",
                      borderRadius: 8,
                      background: "rgba(255,255,255,0.05)",
                      border: "1px solid rgba(255,255,255,0.12)",
                      padding: 6,
                      cursor: "pointer",
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 3,
                    }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`/app_logos_png/${name}`}
                      alt={name}
                      style={{ width: 30, height: 30, objectFit: "contain" }}
                    />
                    <span
                      style={{
                        fontSize: 8,
                        color: TEXT_2,
                        width: "100%",
                        textAlign: "center",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {name.replace(/\.png$/i, "").replace(/[-_]/g, " ")}
                    </span>
                  </button>
                ))}
              </div>
            )}

            {/* Symbols */}
            {activeTab === "SYMBOLS" && (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(3, 1fr)",
                  gap: 8,
                }}
              >
                {filteredSymbols.map((sym, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() =>
                      handleAddAsset("SYMBOL", `/bulk_symbols_110_colored/${sym}`)
                    }
                    style={{
                      aspectRatio: "1 / 1",
                      borderRadius: 8,
                      background: "rgba(255,255,255,0.05)",
                      border: "1px solid rgba(255,255,255,0.12)",
                      padding: 6,
                      cursor: "pointer",
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 3,
                    }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`/bulk_symbols_110_colored/${sym}`}
                      alt={sym}
                      style={{ width: 30, height: 30, objectFit: "contain" }}
                    />
                    <span
                      style={{
                        fontSize: 8,
                        color: TEXT_2,
                        width: "100%",
                        textAlign: "center",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {sym.replace(/\.png$/i, "").replace(/[-_]/g, " ")}
                    </span>
                  </button>
                ))}
              </div>
            )}

            {/* Backgrounds — image thumbnails + CSS gradient swatches */}
            {activeTab === "BGS" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {DEFAULT_BGS.filter(
                  (bg) =>
                    !searchQuery ||
                    bg.name.toLowerCase().includes(searchQuery.toLowerCase()),
                ).map((bg, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => applyBackground(bg)}
                    style={{
                      position: "relative",
                      aspectRatio: "16 / 9",
                      borderRadius: 8,
                      overflow: "hidden",
                      border: "1px solid rgba(255,255,255,0.12)",
                      cursor: "pointer",
                      padding: 0,
                      // Gradient swatch renders directly on the button.
                      background: bg.css || "rgba(255,255,255,0.05)",
                    }}
                  >
                    {bg.url && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={bg.url}
                        alt={bg.name}
                        style={{ width: "100%", height: "100%", objectFit: "cover" }}
                      />
                    )}
                    <span
                      style={{
                        position: "absolute",
                        bottom: 4,
                        left: 6,
                        fontSize: 9.5,
                        fontWeight: 700,
                        color: "#fff",
                        background: "rgba(0,0,0,0.6)",
                        padding: "2px 6px",
                        borderRadius: 4,
                      }}
                    >
                      {bg.name}
                    </span>
                  </button>
                ))}
              </div>
            )}

            {/* Layer tree */}
            {activeTab === "LAYERS" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <div
                  style={{
                    fontSize: 9.5,
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
                      onClick={() => setSelectedId(el.id)}
                      style={{
                        padding: 8,
                        borderRadius: 8,
                        border: on
                          ? "1px solid var(--v2-accent)"
                          : "1px solid rgba(255,255,255,0.1)",
                        background: on
                          ? "rgba(var(--v2-accent-rgb), 0.12)"
                          : "rgba(255,255,255,0.03)",
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
                            background: "rgba(255,255,255,0.08)",
                            color: TEXT_2,
                          }}
                        >
                          {el.type}
                        </span>
                        <span
                          style={{
                            fontSize: 11,
                            color: TEXT_1,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {el.text || el.url?.split("/").pop() || el.id}
                        </span>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
                        {(
                          [
                            { icon: "arrow_upward", fn: () => handleMoveLayer(el.id, "up"), title: "Up" },
                            { icon: "arrow_downward", fn: () => handleMoveLayer(el.id, "down"), title: "Down" },
                            { icon: "content_copy", fn: () => handleDuplicate(el), title: "Duplicate" },
                            { icon: "delete", fn: () => handleDeleteLayer(el.id), title: "Delete" },
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
                              color: a.icon === "delete" ? "#ff9c9c" : TEXT_2,
                              cursor: "pointer",
                              display: "inline-flex",
                            }}
                          >
                            <span className="material-symbols-outlined" style={{ fontSize: 14 }}>
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
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <GlassCard
            style={{
              padding: 16,
              display: "flex",
              alignItems: "flex-start",
              justifyContent: "center",
              overflow: "auto",
              minHeight: 500,
            }}
          >
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
                {elements.map((el) => {
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
                      key={el.id}
                      position={{ x: el.x, y: el.y }}
                      size={{ width: el.width, height: el.height }}
                      onDragStop={(_e, d) => patchElement(el.id, { x: d.x, y: d.y })}
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
                        outline: isSelected ? "2px solid var(--v2-accent)" : "none",
                      }}
                      onClick={() => setSelectedId(el.id)}
                    >
                      {isSelected && (
                        <button
                          type="button"
                          aria-label="Rotate layer"
                          title="Drag to rotate"
                          onPointerDown={(event) => startRotation(event, el)}
                          style={{
                            position: "absolute",
                            left: "50%",
                            top: -30,
                            transform: "translateX(-50%)",
                            width: 24,
                            height: 24,
                            borderRadius: "50%",
                            border: "1px solid var(--v2-accent)",
                            background: "#17171c",
                            color: "var(--v2-accent)",
                            zIndex: 20,
                            cursor: "grab",
                            display: "grid",
                            placeItems: "center",
                            padding: 0,
                          }}
                        >
                          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>rotate_right</span>
                        </button>
                      )}
                      {el.type === "TEXT" ? (
                        <div
                          style={{
                            width: "100%",
                            height: "100%",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "flex-start",
                            textTransform: "uppercase",
                            letterSpacing: "0.03em",
                            fontWeight: (el.fontWeight as React.CSSProperties["fontWeight"]) || "bold",
                            fontFamily: el.fontFamily || "Impact",
                            fontSize: `${el.fontSize || 64}px`,
                            color: el.color || "#ffffff",
                            WebkitTextStroke: `${el.strokeWidth ?? 8}px ${el.strokeColor || "#000000"}`,
                            paintOrder: "stroke fill",
                            fontStyle: el.fontStyle || "italic",
                            lineHeight: 1,
                            overflow: "hidden",
                            whiteSpace: "nowrap",
                            backgroundColor: el.bgColor || "transparent",
                            borderRadius: el.borderRadius || "0",
                            padding: el.padding || "0",
                            userSelect: "none",
                            transform: el.rotation ? `rotate(${el.rotation}deg)` : undefined,
                          }}
                        >
                          {el.text}
                        </div>
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
                            transform: el.rotation ? `rotate(${el.rotation}deg)` : undefined,
                          }}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={el.url}
                            alt="Asset"
                            style={{
                              width: "100%",
                              height: "100%",
                              objectFit: "contain",
                              pointerEvents: "none",
                            }}
                          />
                        </div>
                      )}
                    </Rnd>
                  );
                })}
              </div>
            </div>
          </GlassCard>

          {/* Property inspector */}
          {selectedElement && (
            <GlassCard style={{ padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 8,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 200 }}>
                  <span
                    style={{
                      fontSize: 9,
                      fontWeight: 800,
                      padding: "3px 6px",
                      borderRadius: 4,
                      background: "rgba(255,255,255,0.08)",
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
                        patchElement(selectedElement.id, { text: e.target.value })
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
                    style={{ ...panelBtn(false), color: "#ff9c9c" }}
                  >
                    Remove
                  </button>
                </div>
              </div>

              {selectedElement.type === "TEXT" && (
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
                    gap: 10,
                    paddingTop: 10,
                    borderTop: "1px solid rgba(255,255,255,0.1)",
                  }}
                >
                  {/* Font family */}
                  <label style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                    <span style={{ fontSize: 9, fontWeight: 800, color: TEXT_2, letterSpacing: "0.04em" }}>
                      FONT
                    </span>
                    <select
                      value={selectedElement.fontFamily || "Impact"}
                      onChange={(e) =>
                        patchElement(selectedElement.id, { fontFamily: e.target.value })
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
                  <label style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                    <span style={{ fontSize: 9, fontWeight: 800, color: TEXT_2, letterSpacing: "0.04em" }}>
                      SIZE: {selectedElement.fontSize || 64}px
                    </span>
                    <input
                      type="range"
                      min={24}
                      max={120}
                      value={selectedElement.fontSize || 64}
                      onChange={(e) =>
                        patchElement(selectedElement.id, {
                          fontSize: parseInt(e.target.value, 10),
                        })
                      }
                      style={{ width: "100%", accentColor: "var(--v2-accent)" }}
                    />
                  </label>

                  {/* Fill color */}
                  <label style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                    <span style={{ fontSize: 9, fontWeight: 800, color: TEXT_2, letterSpacing: "0.04em" }}>
                      TEXT COLOR
                    </span>
                    <input
                      type="color"
                      value={selectedElement.color || "#ffffff"}
                      onChange={(e) =>
                        patchElement(selectedElement.id, { color: e.target.value })
                      }
                      style={{
                        width: "100%",
                        height: 30,
                        borderRadius: 6,
                        border: "1px solid rgba(255,255,255,0.14)",
                        background: "rgba(0,0,0,0.28)",
                        cursor: "pointer",
                      }}
                    />
                  </label>

                  {/* Stroke width */}
                  <label style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                    <span style={{ fontSize: 9, fontWeight: 800, color: TEXT_2, letterSpacing: "0.04em" }}>
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
                      style={{ width: "100%", accentColor: "var(--v2-accent)" }}
                    />
                  </label>
                </div>
              )}
              <label style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                <span style={{ fontSize: 9, fontWeight: 800, color: TEXT_2, letterSpacing: "0.04em" }}>
                  ROTATION: {selectedElement.rotation ?? 0}°
                </span>
                <input
                  type="range"
                  min={-180}
                  max={180}
                  value={selectedElement.rotation ?? 0}
                  onChange={(event) => patchElement(selectedElement.id, { rotation: Number(event.target.value) })}
                  style={{ width: "100%", accentColor: "var(--v2-accent)" }}
                />
              </label>
            </GlassCard>
          )}
        </div>
      </div>
    </div>
  );
}

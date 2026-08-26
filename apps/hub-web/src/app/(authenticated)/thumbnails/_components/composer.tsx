"use client";

import { useMemo, useRef, useState } from "react";
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
 * from /public, custom PNG uploads persisted to localStorage as base64, PNG
 * export (html-to-image), and a 10-language ZIP export that swaps the two
 * headline layers using a STATIC offline translation map — NO API calls.
 *
 * The AI-generation flow (Generate/Archetypes tabs) depends on media-gateway
 * infra the target box does not have; this composer is the real tool + fallback.
 *
 * TODO: per-channel thumbnailStyle presets were intentionally dropped from this
 * port to keep scope tight. Re-add once channel branding data is wired here.
 */

const TEXT_1 = "#e5e2e1";
const TEXT_2 = "#cdc3d7";

const CUSTOM_ASSETS_KEY = "ts_custom_assets";

// The 10 languages of the batch pack, in export order.
const LANGUAGES = [
  "English",
  "German",
  "Spanish",
  "Portuguese",
  "Italian",
  "French",
  "Dutch",
  "Japanese",
  "Korean",
  "Swedish",
] as const;

// STATIC offline translation map — copied verbatim from the facade's
// hardcoded thumbnail-translation fallback. NEVER call an API for this.
const STATIC_TRANSLATIONS: Record<string, { top: string; bottom: string }> = {
  English: { top: "LEARN FAST", bottom: "STEP BY STEP" },
  German: { top: "SCHNELL LERNEN", bottom: "SCHRITT FÜR SCHRITT" },
  Spanish: { top: "APRENDE FÁCIL", bottom: "PASO A PASO" },
  Portuguese: { top: "APRENDA RÁPIDO", bottom: "PASSO A PASSO" },
  Italian: { top: "IMPARA SUBITO", bottom: "PASSO DOPO PASSO" },
  French: { top: "GUIDE RAPIDE", bottom: "ÉTAPE PAR ÉTAPE" },
  Dutch: { top: "SNEL LEREN", bottom: "STAP VOOR STAP" },
  Japanese: { top: "簡単マスター", bottom: "ステップ解説" },
  Korean: { top: "빠른 가이드", bottom: "완벽 정리" },
  Swedish: { top: "LÄR DIG SNABBT", bottom: "STEG FÖR STEG" },
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

// Rebuilt from the ACTUAL files present in apps/hub-web/public/<folder>/.
// URLs are case-sensitive; folder casing matches disk exactly.
const DEFAULT_PERSONAS: Record<string, { name: string; url: string }[]> = {
  English: [
    { name: "American - Pointing", url: "/English/american-pointing.png" },
    { name: "American - Thumbs-up", url: "/English/american-thumbs-up.png" },
    { name: "American - Explaining", url: "/English/american-explaining.png" },
    { name: "American - Pro tip", url: "/English/american-finger-up.png" },
    { name: "American - Thinking", url: "/English/american-thinking.png" },
    { name: "American - Stop", url: "/English/american-stop-palm.png" },
    { name: "American - Celebrate", url: "/English/american-celebrate.png" },
    { name: "American - Smiling", url: "/English/american-hero.png" },
    { name: "English Host 1", url: "/English/English.png" },
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
    { name: "German Host 1", url: "/germanese/Germanese.png" },
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
      url: "/English/English.png",
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

export function Composer() {
  const canvasRef = useRef<HTMLDivElement | null>(null);

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

  const selectedElement = elements.find((el) => el.id === selectedId);

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

  // ── mutation helpers ──
  function patchElement(id: string, patch: Partial<ThumbnailElement>) {
    setElements((prev) =>
      prev.map((el) => (el.id === id ? { ...el, ...patch } : el)),
    );
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

  function handleUploadCustomAsset(
    e: React.ChangeEvent<HTMLInputElement>,
    category: AssetCategory,
  ) {
    const file = e.target.files?.[0];
    if (!file) return;
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
    // allow re-uploading the same file name
    e.target.value = "";
  }

  function handleDeleteCustomAsset(id: string) {
    const next = readCustomAssets().filter((a) => a.id !== id);
    writeCustomAssets(next);
    setCustomAssets(next);
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
    try {
      const zip = new JSZip();
      for (const lang of LANGUAGES) {
        const trans =
          STATIC_TRANSLATIONS[lang] ?? {
            top: "LEARN FAST",
            bottom: "STEP BY STEP",
          };
        setElements((prev) =>
          prev.map((el) => {
            if (el.id === "text-top") return { ...el, text: trans.top };
            if (el.id === "text-bottom") return { ...el, text: trans.bottom };
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
        `thumbnail_pack_${(title || "tutorial").replace(/[^a-z0-9]/gi, "_")}_10langs.zip`,
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
          return el;
        }),
      );
      setIsBatchExporting(false);
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
              Fully offline. Compose, then export PNG or a 10-language ZIP pack.
            </div>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Filename label (optional)…"
            style={{ ...inputStyle, width: 200 }}
          />
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
            {isExporting ? "Exporting…" : "Export PNG"}
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
            {isBatchExporting ? "Packaging ZIP…" : "10-Lang ZIP"}
          </button>
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
                                : "LOGO",
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
                        onClick={() => handleDeleteCustomAsset(asset.id)}
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
                              handleAddAsset("PERSON", p.url);
                              setActiveLang(lang);
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
                      bounds="parent"
                      style={{
                        zIndex: el.zIndex,
                        transform: el.rotation ? `rotate(${el.rotation}deg)` : undefined,
                        outline: isSelected ? "2px solid var(--v2-accent)" : "none",
                      }}
                      onClick={() => setSelectedId(el.id)}
                    >
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
                            backgroundColor: el.bgColor || "transparent",
                            borderRadius: el.borderRadius || "0",
                            padding: el.padding || "0",
                            userSelect: "none",
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
            </GlassCard>
          )}
        </div>
      </div>
    </div>
  );
}

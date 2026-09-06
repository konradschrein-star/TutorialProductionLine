export const ACTIVE_PERSONA_LANGUAGES = [
  "English",
  "German",
  "French",
  "Italian",
  "Swedish",
] as const;

export type ActivePersonaLanguage = (typeof ACTIVE_PERSONA_LANGUAGES)[number];

export interface PersonaAsset {
  name: string;
  /** Public-directory path without a leading slash. */
  path: string;
}

/**
 * The complete approved pose library for the five active tutorial channels.
 * Keep this manifest explicit: public asset paths are case-sensitive in Linux.
 */
export const PERSONA_CATALOG: Record<
  ActivePersonaLanguage,
  readonly PersonaAsset[]
> = {
  English: [
    { name: "American - Celebrate", path: "English/american-celebrate.png" },
    { name: "American - Explaining", path: "English/american-explaining.png" },
    { name: "American - Pro tip", path: "English/american-finger-up.png" },
    { name: "American - Smiling", path: "English/american-hero.png" },
    { name: "American - Pointing", path: "English/american-pointing.png" },
    { name: "American - Stop", path: "English/american-stop-palm.png" },
    { name: "American - Thinking", path: "English/american-thinking.png" },
    { name: "American - Thumbs-up", path: "English/american-thumbs-up.png" },
  ],
  German: [
    { name: "German - Celebrate", path: "germanese/german-celebrate.png" },
    { name: "German - Celebrate 2", path: "germanese/german-celebrate-2.png" },
    { name: "German - Explaining", path: "germanese/german-explaining.png" },
    { name: "German - Pro tip", path: "germanese/german-finger-up.png" },
    { name: "German - Smiling", path: "germanese/german-hero.png" },
    { name: "German - Pointing", path: "germanese/german-pointing.png" },
    { name: "German - Stop", path: "germanese/german-stop-palm.png" },
    { name: "German - Stop 2", path: "germanese/german-stop-palm-2.png" },
    { name: "German - Surprised", path: "germanese/german-surprised.png" },
    { name: "German - Thinking", path: "germanese/german-thinking.png" },
    { name: "German - Thinking 2", path: "germanese/german-thinking-2.png" },
    { name: "German - Thumbs-up", path: "germanese/german-thumbs-up.png" },
  ],
  French: [
    { name: "French - Explaining", path: "French/french-explaining.png" },
    { name: "French - Pro tip", path: "French/french-finger-up.png" },
    { name: "French - Smiling", path: "French/french-hero.png" },
    { name: "French - Pointing", path: "French/french-pointing.png" },
    { name: "French - Stop", path: "French/french-stop-palm.png" },
    { name: "French - Surprised", path: "French/french-surprised.png" },
    { name: "French - Thinking", path: "French/french-thinking.png" },
    { name: "French - Thumbs-up", path: "French/french-thumbs-up.png" },
    { name: "French - Thumbs-up 2", path: "French/french-thumbs-up-2.png" },
  ],
  Italian: [
    { name: "Italian - Explaining", path: "Italy/italian-explaining.png" },
    { name: "Italian - Pro tip", path: "Italy/italian-finger-up.png" },
    { name: "Italian - Smiling", path: "Italy/italian-hero.png" },
    { name: "Italian - Smiling 2", path: "Italy/italian-hero-2.png" },
    { name: "Italian - Smiling 3", path: "Italy/italian-hero-3.png" },
    { name: "Italian - Pointing", path: "Italy/italian-pointing.png" },
    { name: "Italian - Thinking", path: "Italy/italian-thinking.png" },
    { name: "Italian - Thumbs-up", path: "Italy/italian-thumbs-up.png" },
    { name: "Italian - Thumbs-up 2", path: "Italy/italian-thumbs-up-2.png" },
  ],
  Swedish: [
    { name: "Swedish - Pro tip", path: "Swedish/swedish-finger-up.png" },
    { name: "Swedish - Smiling", path: "Swedish/swedish-hero.png" },
    { name: "Swedish - Pointing", path: "Swedish/swedish-pointing.png" },
    { name: "Swedish - Stop", path: "Swedish/swedish-stop-palm.png" },
    { name: "Swedish - Surprised", path: "Swedish/swedish-surprised.png" },
    { name: "Swedish - Thinking", path: "Swedish/swedish-thinking.png" },
    { name: "Swedish - Thumbs-up", path: "Swedish/swedish-thumbs-up.png" },
    { name: "Swedish - Thumbs-up 2", path: "Swedish/swedish-thumbs-up-2.png" },
  ],
};

export const PERSONA_ASSET_PATHS = new Set(
  Object.values(PERSONA_CATALOG).flatMap((assets) =>
    assets.map((asset) => asset.path),
  ),
);

export function cleanedPersonaUrl(path: string): string {
  return `/api/thumbnails/personas?asset=${encodeURIComponent(path)}`;
}

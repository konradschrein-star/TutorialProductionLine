// Thumbnail Studio asset catalogs.
// Every path in this file was verified against the real files in `public/` on disk.
// Prefer editing this file (not the page) when assets are added/removed.

export type ArchetypeCategory =
  | 'Tutorials'
  | 'Comparisons'
  | 'Modern Tech'
  | 'Design & Mobile'
  | 'Classics';

export interface PersonaAsset {
  name: string;
  url: string;
}

export interface BackgroundAsset {
  name: string;
  url: string;
}

export interface ReferenceArchetype {
  id: string;
  name: string;
  category: ArchetypeCategory;
  url: string;
}

// ---------------------------------------------------------------------------
// Directories (public/ is the web root, so these are absolute request paths)
// ---------------------------------------------------------------------------
export const LOGO_DIR = '/app_logos_png';
export const SYMBOL_DIR = '/bulk_symbols_110_colored';

/** Encode every path segment so spaces / unicode in filenames resolve correctly. */
const encPath = (path: string): string =>
  path
    .split('/')
    .map(seg => (seg ? encodeURIComponent(seg) : seg))
    .join('/');

/** Resolve a bare logo filename (e.g. `notion.png`) to a loadable URL. */
export const resolveLogoPath = (file: string): string => encPath(`${LOGO_DIR}/${file}`);

/** Resolve a bare symbol filename (e.g. `curved-arrow.png`) to a loadable URL. */
export const resolveSymbolPath = (file: string): string => encPath(`${SYMBOL_DIR}/${file}`);

/** Human-friendly display name from a raw asset filename. */
export const assetDisplayName = (file: string): string =>
  file
    .replace(/\.(png|jpe?g|webp|svg)$/i, '')
    .replace(/[-_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

// ---------------------------------------------------------------------------
// LOGOS — 70 real files in public/app_logos_png (the "(2)" duplicate is skipped)
// ---------------------------------------------------------------------------
export const LOGOS: string[] = [
  'asana.png', 'blender.png', 'calendly.png', 'cashapp.png', 'ChatGPT-Logo.png',
  'clickup.png', 'cloudflare.png', 'davinciresolve.png', 'discord.png', 'dropbox.png',
  'ebay.png', 'epicgames.png', 'etsy.png', 'facebook.png', 'figma.png',
  'fortnite.png', 'gimp.png', 'github.png', 'gmail.png', 'googlecalendar.png',
  'googlechrome.png', 'googledocs.png', 'googledrive.png', 'googlemaps.png', 'googlemeet.png',
  'googlephotos.png', 'googlesheets.png', 'gumroad.png', 'icloud.png', 'imessage.png',
  'inkscape.png', 'instagram.png', 'krita.png', 'macos.png', 'mailchimp.png',
  'namecheap.png', 'netflix.png', 'netlify.png', 'notion.png', 'obsidian.png',
  'obsstudio.png', 'paypal.png', 'pinterest.png', 'playstation.png', 'reddit.png',
  'replit.png', 'roblox.png', 'safari.png', 'shopify.png', 'snapchat.png',
  'spotify.png', 'steam.png', 'streamlabs.png', 'stripe.png', 'telegram.png',
  'tiktok.png', 'todoist.png', 'trello.png', 'twitch.png', 'venmo.png',
  'vercel.png', 'whatsapp.png', 'wix.png', 'woocommerce.png', 'wordpress.png',
  'youtube.png', 'youtubestudio.png', 'zapier.png', 'zelle.png', 'zoom.png'
];

// Aliases so brief.software_name / topic words map onto the real logo files.
const LOGO_ALIASES: Record<string, string> = {
  chatgpt: 'ChatGPT-Logo.png',
  gpt: 'ChatGPT-Logo.png',
  openai: 'ChatGPT-Logo.png',
  sheets: 'googlesheets.png',
  spreadsheet: 'googlesheets.png',
  spreadsheets: 'googlesheets.png',
  docs: 'googledocs.png',
  document: 'googledocs.png',
  drive: 'googledrive.png',
  gdrive: 'googledrive.png',
  maps: 'googlemaps.png',
  meet: 'googlemeet.png',
  calendar: 'googlecalendar.png',
  gcal: 'googlecalendar.png',
  photos: 'googlephotos.png',
  chrome: 'googlechrome.png',
  browser: 'googlechrome.png',
  mail: 'gmail.png',
  email: 'gmail.png',
  resolve: 'davinciresolve.png',
  davinci: 'davinciresolve.png',
  obs: 'obsstudio.png',
  ps: 'playstation.png',
  wp: 'wordpress.png',
  woo: 'woocommerce.png',
  ig: 'instagram.png',
  yt: 'youtube.png',
  ytstudio: 'youtubestudio.png'
};

const normalizeToken = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Normalized base name of a logo file, with a trailing "logo" stripped. */
const logoBase = (file: string): string => normalizeToken(file.replace(/\.png$/i, '').replace(/logo$/i, ''));

/**
 * Match a free-text software name/topic against the real logo list.
 * Returns the logo FILENAME (e.g. `notion.png`) or null when nothing fits.
 */
export const findLogo = (query: string): string | null => {
  const q = normalizeToken(query || '');
  if (!q) return null;

  // 1. explicit aliases
  for (const [alias, file] of Object.entries(LOGO_ALIASES)) {
    if (q === alias || q.includes(alias) || alias.includes(q)) return file;
  }

  // 2. exact normalized base match
  const exact = LOGOS.find(f => logoBase(f) === q);
  if (exact) return exact;

  // 3. containment either direction (guard against 1-2 char noise)
  if (q.length >= 3) {
    const partial = LOGOS.find(f => {
      const base = logoBase(f);
      return base.length >= 3 && (base.includes(q) || q.includes(base));
    });
    if (partial) return partial;
  }

  return null;
};

// ---------------------------------------------------------------------------
// SYMBOLS — all 111 real files in public/bulk_symbols_110_colored
// ---------------------------------------------------------------------------
export const SYMBOLS: string[] = [
  'alert-circle.png', 'alert-triangle.png', 'aperture.png', 'arrow-big-left.png', 'arrow-big-right.png',
  'arrow-down-right.png', 'arrow-down.png', 'arrow-left.png', 'arrow-right.png', 'arrow-up-right.png',
  'arrow-up.png', 'at-sign.png', 'award.png', 'badge-check.png', 'badge.png',
  'bar-chart.png', 'bell-ring.png', 'bell.png', 'briefcase.png', 'calendar.png',
  'camera.png', 'check-circle.png', 'chevron-right.png', 'chevrons-right.png', 'circle.png',
  'clapperboard.png', 'clipboard.png', 'clock.png', 'cloud.png', 'code.png',
  'corner-down-right.png', 'corner-up-right.png', 'cpu.png', 'credit-card.png', 'crown.png',
  'curved-arrow.png', 'database.png', 'diamond.png', 'dollar-sign.png', 'eye.png',
  'file-text.png', 'film.png', 'flag.png', 'flame.png', 'folder.png',
  'gem.png', 'gift.png', 'globe.png', 'hard-drive.png', 'hash.png',
  'headphones.png', 'heart-handshake.png', 'heart.png', 'help-circle.png', 'hexagon.png',
  'image.png', 'info.png', 'key.png', 'laptop.png', 'lightbulb.png',
  'link.png', 'lock.png', 'mail.png', 'megaphone.png', 'message-circle.png',
  'message-square.png', 'mic.png', 'monitor.png', 'move-left.png', 'move-right.png',
  'music.png', 'pause.png', 'pentagon.png', 'pie-chart.png', 'play.png',
  'podcast.png', 'radio.png', 'rocket.png', 'rotate-cw.png', 'scissors.png',
  'send.png', 'server.png', 'settings.png', 'share-2.png', 'shield.png',
  'shopping-cart.png', 'smartphone.png', 'sparkle.png', 'sparkles.png', 'speaker.png',
  'square.png', 'star.png', 'target.png', 'terminal.png', 'thumbs-down.png',
  'thumbs-up.png', 'trending-down.png', 'trending-up.png', 'triangle.png', 'trophy.png',
  'tv.png', 'user-plus.png', 'user.png', 'users.png', 'video.png',
  'volume-2.png', 'wand-sparkles.png', 'wand.png', 'wifi.png', 'x-circle.png',
  'zap.png'
];

// ---------------------------------------------------------------------------
// BACKGROUNDS — real files in public/background
// ---------------------------------------------------------------------------
export const BACKGROUNDS: BackgroundAsset[] = [
  { name: 'Abstract Gradient Blue', url: '/background/bg_1_1128207.jpg' },
  { name: 'Dark Corporate Slate', url: '/background/bg_5_4386356.jpg' },
  { name: 'Neon Glow Studio', url: '/background/bg_6_322338.jpg' },
  { name: 'Modern Minimal Tech', url: '/background/bg_9_5717314.jpg' },
  { name: 'Nano Banana AI Plate', url: '/background/nano_banana_key1.png' }
];

export const DEFAULT_BACKGROUND_URL = BACKGROUNDS[0].url;

// ---------------------------------------------------------------------------
// PERSONAS — keyed by language, built from the real language directories.
// Every language now has its OWN cutouts (Dutch no longer reuses English).
// Directory mapping: German→germanese, Spanish→spanish, Portuguese→portoguese,
// Italian→Italy, and English/French/Dutch/Japanese/Korean/Swedish match by name.
// ---------------------------------------------------------------------------
const persona = (dir: string, file: string, name: string): PersonaAsset => ({
  name,
  url: encPath(`/${dir}/${file}`)
});

export const PERSONAS: Record<string, PersonaAsset[]> = {
  English: [
    persona('English', 'English.png', 'English Host 1'),
    persona('English', 'english_persona_3_1783711821680-removebg-preview.png', 'English Host 2'),
    persona('English', 'english_persona_4_1783711831752-removebg-preview.png', 'English Host 3'),
    persona('English', 'new_english_persona_1783711373283-removebg-preview.png', 'English Host 4')
  ],
  German: [
    persona('germanese', 'Germanese.png', 'German Host 1'),
    persona('germanese', 'german_persona_3_1783711839868-removebg-preview.png', 'German Host 2'),
    persona('germanese', 'german_persona_4_1783711848080-removebg-preview.png', 'German Host 3'),
    persona('germanese', 'new_german_persona_1783711381520-removebg-preview.png', 'German Host 4')
  ],
  Spanish: [
    persona('spanish', 'new_spanish_persona_1783711397652-removebg-preview.png', 'Spanish Host 1'),
    persona('spanish', 'spanish_1_1783793169018-removebg-preview.png', 'Spanish Host 2'),
    persona('spanish', 'spanish_3_1783793186761-removebg-preview.png', 'Spanish Host 3'),
    persona('spanish', 'spanish_4_1783793195747-removebg-preview.png', 'Spanish Host 4')
  ],
  Portuguese: [
    persona('portoguese', '0d8cea91-3bd0-4a97-b2af-8553cdb5e2c2_removalai_preview.png', 'Portuguese Host 1'),
    persona('portoguese', '28d7a6e2-15c3-467f-bb73-0f146a997ebd_removalai_preview.png', 'Portuguese Host 2'),
    persona('portoguese', '3348eba0-15b7-430a-a89b-164ad35bdf3e_removalai_preview.png', 'Portuguese Host 3'),
    persona('portoguese', 'c3df7faf-0e9b-403d-938b-ba444e0841a9_removalai_preview.png', 'Portuguese Host 4')
  ],
  Italian: [
    persona('Italy', '03009044-1891-4745-8e68-d8e7daf4c47b_removalai_preview.png', 'Italian Host 1'),
    persona('Italy', '081a8de0-1857-420b-a470-ceddf006e88b_removalai_preview.png', 'Italian Host 2'),
    persona('Italy', '26fa11f0-b7c9-4fd1-a283-12225cdced9e_removalai_preview.png', 'Italian Host 3')
  ],
  French: [
    persona('French', '21aaab3a-1cec-4fae-84eb-ab20df8bfa21_removalai_preview.png', 'French Host 1'),
    persona('French', '2e575d5b-1b55-4ade-b6e5-fde911423a55_removalai_preview.png', 'French Host 2'),
    persona('French', '683bfa4d-b18b-4f7c-91df-30a9a109e77a_removalai_preview.png', 'French Host 3')
  ],
  Dutch: [
    persona('Dutch', '9dff44d7-5dda-4215-8b6c-126bef6e362e_removalai_preview.png', 'Dutch Host 1'),
    persona('Dutch', 'f10015c0-4366-4353-8159-bc9950068084_removalai_preview.png', 'Dutch Host 2'),
    persona('Dutch', 'fa99a6c5-496a-47b2-ba9e-fc69f1b17e5d_removalai_preview.png', 'Dutch Host 3')
  ],
  Japanese: [
    persona('Japanese', '31bf9c29-9194-49df-ba56-4baff00537d5_removalai_preview.png', 'Japanese Host 1'),
    persona('Japanese', '55bb0ed9-628e-45dd-8cda-7f85e89953c9_removalai_preview.png', 'Japanese Host 2'),
    persona('Japanese', '7b1a2b0f-7983-4835-8437-34a5d08a3a08_removalai_preview.png', 'Japanese Host 3')
  ],
  Korean: [
    persona('Korean', '48acff93-85ce-4426-b3c9-8b6deb49734b_removalai_preview.png', 'Korean Host 1'),
    persona('Korean', '9acd591f-1c94-4de3-a017-80d19ec14b5c_removalai_preview.png', 'Korean Host 2'),
    persona('Korean', 'd434a2bf-1b06-47f7-b384-ba4a58271b17_removalai_preview.png', 'Korean Host 3')
  ],
  Swedish: [
    persona('Swedish', '218cb5ee-5ebe-400d-a0ff-0cc690b97029_removalai_preview.png', 'Swedish Host 1'),
    persona('Swedish', '2ec1ad55-2e90-480a-8897-57a5f1bbc45d_removalai_preview.png', 'Swedish Host 2'),
    persona('Swedish', '935cadb4-9559-4fd1-932b-9fe90f40b579_removalai_preview.png', 'Swedish Host 3')
  ]
};

export const PERSONA_LANGUAGES = Object.keys(PERSONAS);

/** Default persona used for the initial canvas + AI compose fallback. */
export const DEFAULT_PERSONA_URL = PERSONAS.English[0].url;

export const personasForLanguage = (lang: string): PersonaAsset[] =>
  PERSONAS[lang] || PERSONAS.English;

// ---------------------------------------------------------------------------
// STUDIO HOSTS — premium photoreal host packs (public/<Name>/*.jpeg).
// Extra catalog surfaced alongside the language cutouts.
// ---------------------------------------------------------------------------
const host = (dir: string, files: string[]): PersonaAsset[] =>
  files.map((f, i) => persona(dir, f, `${dir} · ${assetDisplayName(f).replace(/\s*\d{6,}.*$/, '').trim() || `Pose ${i + 1}`}`));

export const STUDIO_HOSTS: Record<string, PersonaAsset[]> = {
  Daan: host('Daan', [
    'Man_gesturing_with_open_palm_202608231247.jpeg',
    'Man_pointing_finger_up_2K_202608231247.jpeg',
    'Man_pointing_toward_copy_space_202608231247.jpeg',
    'Man_warning_stop_gesture_camera_202608231247.jpeg',
    'Person_giving_thumbs-up_2K_202608231247.jpeg',
    'Person_thinking_with_hand_on_202608231247.jpeg',
    'Software_tutor_smiling_at_camera_202608231247.jpeg'
  ]),
  Eric: host('Eric', [
    'Man_giving_thumbs_up_2K_202608231233.jpeg',
    'Man_holding_finger_up_2K_202608231233.jpeg',
    'Man_pointing_toward_copy_space_202608231233.jpeg',
    'Man_posing_with_surprise_expression_202608231233.jpeg',
    'Man_showing_palm_to_camera_202608231233.jpeg',
    'Man_smiling_at_camera_2K_202608231233.jpeg',
    'Person_giving_thumbs_up_2K_202608231233.jpeg',
    'Thoughtful_man_posing_with_hand_202608231233.jpeg'
  ]),
  Jake: host('Jake', [
    'Man_smiling_facing_camera_2K_202608231232.jpeg',
    'Person_celebrating_a_win_2K_202608231231.jpeg',
    'Person_explaining_with_open_palm_202608231231 (1).jpeg',
    'Person_giving_thumbs_up_2K_202608231231.jpeg',
    'Person_holding_palm_out_2K_202608231232.jpeg',
    'Person_pointing_finger_up_2K_202608231231.jpeg',
    'Person_pointing_toward_copy_space_202608231231.jpeg',
    'Thoughtful_person_looking_up_2K_202608231231.jpeg'
  ]),
  Marco: host('Marco', [
    'Man_giving_thumbs_up_2K_202608231230 (1).jpeg',
    'Man_giving_thumbs_up_2K_202608231230.jpeg',
    'Man_pointing_finger_up_2K_202608231230.jpeg',
    'Man_pointing_toward_copy_space_202608231229.jpeg',
    'Man_posing_for_camera_2K_202608231230.jpeg',
    'Man_posing_with_expressive_face_202608231230.jpeg',
    'Man_smiling_for_camera_portrait_202608231230.jpeg',
    'Person_gesturing_open_palm_2K_202608231230.jpeg',
    'Person_posing_with_hand_on_202608231230.jpeg'
  ]),
  Max: host('Max', [
    'Man_celebrating_with_thumbs_up_202608231226.jpeg',
    'Man_explaining_with_open_palm_202608231226.jpeg',
    'Man_giving_thumbs_up_2K_202608231225.jpeg',
    'Man_pointing_toward_copy_space_202608231225.jpeg',
    'Man_posing_thoughtfully_with_hand_202608231226.jpeg',
    'Man_raising_index_finger_2K_202608231226.jpeg',
    'Man_smiling_in_studio_lighting_202608231225.jpeg',
    'Man_thinking_with_hand_on_202608231226.jpeg',
    'Person_celebrating_a_win_2K_202608231226.jpeg',
    'Person_holding_palm_out_2K_202608231226.jpeg',
    'Person_holding_palm_toward_camera_202608231226.jpeg',
    'Person_raising_hands_excitedly_2K_202608231225.jpeg'
  ]),
  Theo: host('Theo', [
    'Man_explaining_with_open_palm_202608231229.jpeg',
    'Man_giving_thumbs-up_gesture_2K_202608231229.jpeg',
    'Man_giving_thumbs_up_2K_202608231229.jpeg',
    'Man_pointing_finger_upward_2K_202608231229.jpeg',
    'Man_raising_hands_in_surprise_202608231229.jpeg',
    'Man_showing_palm_to_camera_202608231229.jpeg',
    'Man_smiling_facing_camera_2K_202608231228.jpeg',
    'Person_pointing_toward_copy_space_202608231228.jpeg',
    'Person_thinking_with_hand_on_202608231229.jpeg'
  ])
};

export const STUDIO_HOST_NAMES = Object.keys(STUDIO_HOSTS);

// ---------------------------------------------------------------------------
// REFERENCE ARCHETYPES — curated high-CTR templates (all verified on disk).
// ---------------------------------------------------------------------------
export const REFERENCE_ARCHETYPES: ReferenceArchetype[] = [
  { id: 'tut-1', name: 'Tutorial Archetype (Best CTR)', category: 'Tutorials', url: '/reference-thumbnails/tutorial-1-best-archetype.png' },
  { id: 'tut-3', name: 'Tutorial Modern Slate', category: 'Tutorials', url: '/reference-thumbnails/tutorial-3.png' },
  { id: 'tut-4', name: 'Tutorial Punchy Grid', category: 'Tutorials', url: '/reference-thumbnails/tutorial-4.png' },
  { id: 'tut-5', name: 'Tutorial Floating Dashboard', category: 'Tutorials', url: '/reference-thumbnails/tutorial-5.png' },
  { id: 'tut-6', name: 'Tutorial Step-by-Step 6', category: 'Tutorials', url: '/reference-thumbnails/tutorial-6.jpeg' },
  { id: 'tut-7', name: 'Tutorial Step-by-Step 7', category: 'Tutorials', url: '/reference-thumbnails/tutorial-7.jpeg' },
  { id: 'tut-8', name: 'Tutorial Clean Minimal 8', category: 'Tutorials', url: '/reference-thumbnails/tutorial-8.png' },
  { id: 'tut-9', name: 'Tutorial Highlight 9', category: 'Tutorials', url: '/reference-thumbnails/tutorial-9.png' },
  { id: 'tut-10', name: 'Tutorial Dark Focus 10', category: 'Tutorials', url: '/reference-thumbnails/tutorial-10.jpeg' },
  { id: 'tut-11', name: 'Tutorial Master 11', category: 'Tutorials', url: '/reference-thumbnails/tutorial-11.jpeg' },
  { id: 'tut-12', name: 'Tutorial Simple 12', category: 'Tutorials', url: '/reference-thumbnails/tutorial-12-simple.jpeg' },
  { id: 'tut-13', name: 'Tutorial Pro 13', category: 'Tutorials', url: '/reference-thumbnails/tutorial-13.jpeg' },
  { id: 'walk-1', name: 'Walkthrough Detailed 1', category: 'Tutorials', url: '/reference-thumbnails/walktrough-1.jpeg' },
  { id: 'walk-2', name: 'Walkthrough Detailed 2', category: 'Tutorials', url: '/reference-thumbnails/walktrough-2.jpeg' },
  { id: 'gfin-1', name: 'Google Finance Excel', category: 'Tutorials', url: '/reference-thumbnails/google-finance-excel.jpg' },
  { id: 'norm-1', name: 'Normal Tutorial Style', category: 'Tutorials', url: '/reference-thumbnails/normal-tutorial-style.jpeg' },
  { id: 'tipps-1', name: 'Tips & Tricks Lifehacks', category: 'Tutorials', url: '/reference-thumbnails/tipps-tricks-lifehacks-1.jpeg' },
  { id: 'cool-1', name: 'Cool Feature Highlight', category: 'Tutorials', url: '/reference-thumbnails/cool-feature-1.jpeg' },
  { id: 'bad-1', name: 'Software Fix & Troubleshoot', category: 'Tutorials', url: '/reference-thumbnails/bad-software-walktrough-for-hard.jpeg' },

  { id: 'cmp-bat', name: 'Admin Comparison Battle', category: 'Comparisons', url: '/reference-thumbnails/admin-comparison-battle-style.jpeg' },
  { id: 'cmp-2-1', name: 'Comparison Split 2-1', category: 'Comparisons', url: '/reference-thumbnails/admin-comparison-2-1.jpeg' },
  { id: 'cmp-ph', name: 'Comparison 3 Phones', category: 'Comparisons', url: '/reference-thumbnails/comparison-1-3-phones.jpeg' },
  { id: 'cmp-cln', name: 'Comparison Really Clean', category: 'Comparisons', url: '/reference-thumbnails/comparison-2-really-clean.jpeg' },
  { id: 'cmp-alt', name: 'Comparison Alternatives', category: 'Comparisons', url: '/reference-thumbnails/comparison-3-alternatives.jpeg' },
  { id: 'comb-1', name: 'Combination Connection', category: 'Comparisons', url: '/reference-thumbnails/combination-connection-1.jpeg' },

  { id: 'adm-dram', name: 'Admin Dramatic Bold', category: 'Modern Tech', url: '/reference-thumbnails/admin-dramatic-bold-style.jpeg' },
  { id: 'adm-edu', name: 'Admin Educational Friendly', category: 'Modern Tech', url: '/reference-thumbnails/admin-educational-friendly-style.jpeg' },
  { id: 'adm-nrg', name: 'Admin Energetic Tech', category: 'Modern Tech', url: '/reference-thumbnails/admin-energetic-tech-style.jpeg' },
  { id: 'adm-prod', name: 'Admin Modern Productivity', category: 'Modern Tech', url: '/reference-thumbnails/admin-modern-productivity-style.jpeg' },
  { id: 'adm-warn', name: 'Admin Striking Warning', category: 'Modern Tech', url: '/reference-thumbnails/admin-striking-warning-style.jpg' },
  { id: 'cas-tech', name: 'Casual Tech Style', category: 'Modern Tech', url: '/reference-thumbnails/casual-tech-style.jpeg' },
  { id: 'news-1', name: 'Breaking News & Updates', category: 'Modern Tech', url: '/reference-thumbnails/news-1.jpeg' },
  { id: 'nano-gen', name: 'Nano Banana AI Plate', category: 'Modern Tech', url: '/background/nano_banana_key1.png' },

  { id: 'des-1', name: 'Design Minimal 1', category: 'Design & Mobile', url: '/reference-thumbnails/design-1.png' },
  { id: 'des-2', name: 'Design Card 2', category: 'Design & Mobile', url: '/reference-thumbnails/design-2.png' },
  { id: 'des-3', name: 'Design Gradient 3', category: 'Design & Mobile', url: '/reference-thumbnails/design-3.png' },
  { id: 'des-4', name: 'Design Modern 4', category: 'Design & Mobile', url: '/reference-thumbnails/design-4.png' },
  { id: 'des-5', name: 'Design Sleek 5', category: 'Design & Mobile', url: '/reference-thumbnails/design-5.png' },
  { id: 'ph-1', name: 'Phone Screen 1', category: 'Design & Mobile', url: '/reference-thumbnails/phone-1.png' },
  { id: 'ph-2', name: 'Phone Screen 2', category: 'Design & Mobile', url: '/reference-thumbnails/phone-2.png' },
  { id: 'ph-3', name: 'Phone Screen 3', category: 'Design & Mobile', url: '/reference-thumbnails/phone-3.jpeg' },
  { id: 'lay-auto', name: 'Layout Automated Grid', category: 'Design & Mobile', url: '/reference-thumbnails/layout-automated.png' },
  { id: 'lay-edit', name: 'Layout Editorial High-CTR', category: 'Design & Mobile', url: '/reference-thumbnails/layout-editorial.png' },

  { id: 'arch-1', name: 'Classic Archetype 1', category: 'Classics', url: '/reference-thumbnails/Archetype.png' },
  { id: 'arch-2', name: 'Classic Archetype 2', category: 'Classics', url: '/reference-thumbnails/archetype2.jpg' },
  { id: 'arch-3', name: 'Classic Archetype 3', category: 'Classics', url: '/reference-thumbnails/archetype3.jpeg' },
  { id: 'arch-4', name: 'Classic Archetype 4', category: 'Classics', url: '/reference-thumbnails/archetype4.jpeg' },
  { id: 'arch-5', name: 'Classic Archetype 5', category: 'Classics', url: '/reference-thumbnails/archetype5.jpeg' },
  { id: 'arch-6', name: 'Classic Archetype 6', category: 'Classics', url: '/reference-thumbnails/archetype6.jpeg' },
  { id: 'arch-7', name: 'Classic Archetype 7', category: 'Classics', url: '/reference-thumbnails/archetype7.jpeg' },
  { id: 'hum-1', name: 'Humor & Expressive Face', category: 'Classics', url: '/reference-thumbnails/humor-1.jpg' },
  { id: 'fh-1', name: 'Forehead Reaction Style', category: 'Classics', url: '/reference-thumbnails/forehead-funny.jpeg' }
];

export const ARCHETYPE_CATEGORIES: ArchetypeCategory[] = [
  'Tutorials', 'Comparisons', 'Modern Tech', 'Design & Mobile', 'Classics'
];

/** Default reference archetype URL used to seed the AI generator. */
export const DEFAULT_REFERENCE_URL = REFERENCE_ARCHETYPES[0].url;

# 🎭 Tutorial Studio — Host Character & Thumbnail Prompt Pack

**Purpose:** Reference-image prompts for **Nano Banana 2** (Gemini image model) to generate one on-camera host per channel/language, each with a set of pose + expression variations. These images become the `character_images` rows that the thumbnail engine cycles through (deterministic pose/expression cycling — see `apps/worker-orchestrator/src/utils/thumbnail/character.ts`).

> **Do NOT generate the final thumbnails from these.** These prompts produce the **host cut-outs** (the person only). The thumbnail engine then composites the chosen host image onto an archetype background + headline. Generate the host once as a clean cut-out; the engine reuses it across hundreds of thumbnails.

---

## ✅ STATUS (2026-08-23): generated, cut out & wired into the manual studio

The hosts below have been generated (Nano Banana 2, green screen), **background-removed locally** (rembg AI matting + edge-despill; no external service), sorted by pose, and added to the **manual Thumbnail Studio** persona panel (`apps/hub-web` composer), grouped by country. **The guys are identified by their country — no personal names** (per owner). Name mapping (personal name → country label used everywhere now):

| Country label | (was) | Channel | Cut-outs |
|---|---|---|---|
| **German** | Max | 🇩🇪 de | 12 |
| **American** | Jake | 🇺🇸 en | 8 |
| **French** | Théo | 🇫🇷 fr | 9 |
| **Italian** | Marco | 🇮🇹 it | 9 |
| **Dutch** | Daan | 🇳🇱 nl | 7 |
| **Swedish** | Eric | 🇸🇪 sv | 8 |

Files: `apps/hub-web/public/<lang-folder>/<country>-<pose>.png` (e.g. `/germanese/german-pointing.png`). Pose slugs = `pointing · thumbs-up · surprised · explaining · finger-up · thinking · stop-palm · celebrate · hero`. The same PNGs (named by pose/expression) are ready to seed the AUTO engine's `character_images` rows when that backend is turned on. The sections below keep the personal names only as the original generation brief.

---

## How to use this pack (workflow)

1. **Generate the MASTER identity image** for a host (the first prompt in each section). Pick the best result — this is the canonical face.
2. **Generate each VARIATION** with the master image **attached as a reference** (Nano Banana 2 → "add reference image" → set to *keep character / face consistency*). This is what keeps the same person across all 8 poses.
3. Export each as a **transparent PNG** (or clean chroma background — see recipe). Upper-body, high-res.
4. File them so each maps to one `character_images` row: `pose`, `expression`, `image_path`, `is_active=true`, bound to the channel's `characters` row.
5. The engine cycles them automatically — variant 0/1/2 of a batch step through consecutive images, regenerate guarantees a different pose. No two thumbnails in a batch collide.

**Host = the voice made visible.** All narration voices are male, so the hosts are male by default to keep face-and-voice coherent per channel. Say the word and I'll swap any channel to female or a mixed roster — the prompts below are drop-in editable.

---

## 🎨 BASE RENDER RECIPE (applies to every prompt below — paste as a suffix)

```
Ultra-sharp modern YouTube-tutorial thumbnail cut-out of a single person, upper
body (waist-up), facing camera. Bright even studio key light with a soft rim
light for pop, subtle catchlights in the eyes, crisp focus, high dynamic range,
slightly punchy contrast and saturation. Clean solid neutral background (flat
#00b140 chroma green OR transparent) — subject only, no props unless stated, no
scenery. Leave generous empty copy space on the {LEFT/RIGHT} third for headline
text. Photoreal, flattering, friendly, professional-creator aesthetic. 16:9
composition, subject weighted to one side. 4K, extremely detailed skin and hair.
```

**Negative / avoid (append or set as negative prompt):**
```
no text, no logos, no watermark, no captions, no UI screenshots, no busy
background, no extra people, no distorted hands, no extra fingers, no blurry
face, no low-res, no harsh shadows, no cluttered wardrobe, not looking away.
```

**Consistency directive (for every VARIATION, not the master):**
```
Keep the SAME person as the attached reference: identical face, bone structure,
hairstyle, skin tone, and eye color. Only the pose, expression, and hand gesture
change. Same wardrobe and accent color.
```

---

## 🔁 The 8 standard pose × expression variations (same set for every host)

These 8 are the tutorial-thumbnail canon — high click-through, instantly readable at small size. Every host gets the same 8 so the cycle behaves identically across channels.

| # | `pose` | `expression` | Gesture & read |
|---|--------|--------------|----------------|
| 1 | `pointing-side` | `excited` | Pointing toward the copy space, big open grin — "look here" |
| 2 | `thumbs-up` | `confident` | One thumbs-up, reassuring smile — "you've got this" |
| 3 | `open-hands-surprised` | `amazed` | Both hands raised, wide eyes, mouth open — "mind blown" |
| 4 | `explaining-palm` | `friendly` | One open palm mid-explanation, warm engaged look |
| 5 | `finger-up-tip` | `knowing` | Index finger raised, one brow up, slight smirk — "pro tip" |
| 6 | `hand-on-chin` | `curious` | Hand on chin, thoughtful, eyes slightly narrowed — "hmm" |
| 7 | `both-thumbs-celebrate` | `delighted` | Two thumbs up / small fist-pump, laughing — "success!" |
| 8 | `stop-palm` | `serious` | Palm out toward camera, focused brow — "don't do this" |

Copy-space side alternates automatically per thumbnail; generate a couple of each host mirrored (facing left vs right) if you want maximum layout flexibility.

---

# The Hosts

> Format per channel: **MASTER identity prompt** (generate first) → **8 variation prompts** (generate with master as reference). Append the Base Render Recipe + Negative to each. Wardrobe carries the **channel accent color** so the host visually belongs to the channel and matches the color-coded video treatment.

---

## 🇩🇪 German Tutorials (`de`) — Host: **Max** · accent **Signal Blue #2563EB**

**Character (DB `characters.name` = "Max", `description`):** Precise, reassuring German tech tutor, early 30s. Approachable "senior colleague who explains it once and it clicks."

**MASTER identity prompt:**
```
Photoreal portrait of Max, a friendly German software tutor, early 30s, short
dark-blond hair neatly styled, light stubble, bright blue-grey eyes, fair skin,
fit build. Wearing a modern navy quarter-zip pullover with a subtle signal-blue
(#2563EB) accent zip, clean and minimal. Warm confident closed-mouth smile,
looking straight at camera. [+ BASE RENDER RECIPE + NEGATIVE]
```

**Variations (attach Max master as reference + consistency directive):**
1. `pointing-side` / `excited` — Max pointing toward the right copy space with an open enthusiastic grin, other hand relaxed. [+recipe]
2. `thumbs-up` / `confident` — Max giving a single clear thumbs-up, reassuring smile, chin slightly up. [+recipe]
3. `open-hands-surprised` / `amazed` — Max with both hands raised to shoulder height, eyebrows up, mouth open in a delighted "wow". [+recipe]
4. `explaining-palm` / `friendly` — Max mid-explanation, one open palm turned up, warm engaged expression. [+recipe]
5. `finger-up-tip` / `knowing` — Max raising his index finger, one eyebrow up, subtle smirk — the "pro tip" look. [+recipe]
6. `hand-on-chin` / `curious` — Max with hand on chin, thoughtful and slightly puzzled, eyes to the side. [+recipe]
7. `both-thumbs-celebrate` / `delighted` — Max with two thumbs up, laughing, eyes bright — celebrating a win. [+recipe]
8. `stop-palm` / `serious` — Max holding one palm out toward camera, focused serious brow — "avoid this mistake". [+recipe]

---

## 🇺🇸 USA Tutorials (`en`) — Host: **Jake** · accent **Bold Red #DC2626**

**Character:** High-energy American creator-tutor, mid 30s. Fast, upbeat, "let's just get it done" charisma.

**MASTER identity prompt:**
```
Photoreal portrait of Jake, an upbeat American software tutor, mid 30s, short
tidy brown hair, clean-shaven or very light stubble, warm brown eyes, medium
skin tone, big natural smile with straight white teeth. Wearing a modern
red (#DC2626) crew-neck henley under a charcoal casual jacket, energetic
creator vibe. Looking straight at camera, animated and confident.
[+ BASE RENDER RECIPE + NEGATIVE]
```

**Variations (attach Jake master as reference + consistency directive):**
1. `pointing-side` / `excited` — Jake pointing energetically toward the copy space, wide grin, leaning slightly in. [+recipe]
2. `thumbs-up` / `confident` — Jake with a strong thumbs-up, big smile, direct eye contact. [+recipe]
3. `open-hands-surprised` / `amazed` — Jake with both hands up, jaw dropped in an excited "no way!". [+recipe]
4. `explaining-palm` / `friendly` — Jake gesturing with an open palm, mid-sentence, warm and clear. [+recipe]
5. `finger-up-tip` / `knowing` — Jake with index finger up, playful smirk, one brow raised. [+recipe]
6. `hand-on-chin` / `curious` — Jake with hand on chin, mock-thinking, eyes up-left. [+recipe]
7. `both-thumbs-celebrate` / `delighted` — Jake double thumbs-up with a laugh, celebrating. [+recipe]
8. `stop-palm` / `serious` — Jake palm-out to camera, serious focused look — "stop, don't do this". [+recipe]

---

## 🇫🇷 French Tutorials (`fr`) — Host: **Théo** · accent **Royal Indigo #4F46E5**

**Character:** Stylish, calm French tech tutor, early 30s. Effortless "this is simpler than you think" confidence.

**MASTER identity prompt:**
```
Photoreal portrait of Théo, a stylish French software tutor, early 30s, dark
brown hair swept back, well-groomed short beard, dark expressive eyes, light
olive skin. Wearing a fitted indigo (#4F46E5) button-up shirt, sleeves slightly
rolled, minimalist and sharp. Relaxed charismatic half-smile, looking straight
at camera. [+ BASE RENDER RECIPE + NEGATIVE]
```

**Variations (attach Théo master as reference + consistency directive):**
1. `pointing-side` / `excited` — Théo pointing toward the copy space with a bright confident smile. [+recipe]
2. `thumbs-up` / `confident` — Théo with a smooth thumbs-up, assured half-smile. [+recipe]
3. `open-hands-surprised` / `amazed` — Théo both hands raised, eyebrows up, pleasantly surprised. [+recipe]
4. `explaining-palm` / `friendly` — Théo with an open palm mid-explanation, engaging and calm. [+recipe]
5. `finger-up-tip` / `knowing` — Théo index finger up, knowing smirk, one brow raised. [+recipe]
6. `hand-on-chin` / `curious` — Théo hand on chin, thoughtful and refined, eyes to the side. [+recipe]
7. `both-thumbs-celebrate` / `delighted` — Théo two thumbs up with a warm laugh. [+recipe]
8. `stop-palm` / `serious` — Théo palm out to camera, focused serious expression. [+recipe]

---

## 🇮🇹 Italian Tutorials (`it`) — Host: **Marco** · accent **Emerald #059669**

**Character:** Expressive, warm Italian tutor, 30s. Animated hands, big personality, makes dry software feel fun.

**MASTER identity prompt:**
```
Photoreal portrait of Marco, an expressive Italian software tutor, 30s, dark
curly hair, neat short beard, warm dark eyes, olive skin, lively friendly face.
Wearing a modern emerald-green (#059669) polo or fine knit, smart-casual.
Big genuine smile, engaging and animated, looking straight at camera.
[+ BASE RENDER RECIPE + NEGATIVE]
```

**Variations (attach Marco master as reference + consistency directive):**
1. `pointing-side` / `excited` — Marco pointing toward the copy space with an animated open-mouthed grin. [+recipe]
2. `thumbs-up` / `confident` — Marco enthusiastic thumbs-up, warm broad smile. [+recipe]
3. `open-hands-surprised` / `amazed` — Marco both hands up, very expressive "mamma mia!" wow face. [+recipe]
4. `explaining-palm` / `friendly` — Marco gesturing with an open palm, lively mid-explanation. [+recipe]
5. `finger-up-tip` / `knowing` — Marco index finger up, playful knowing look, brow raised. [+recipe]
6. `hand-on-chin` / `curious` — Marco hand on chin, curious and amused, eyes up. [+recipe]
7. `both-thumbs-celebrate` / `delighted` — Marco two thumbs up, laughing warmly, celebrating. [+recipe]
8. `stop-palm` / `serious` — Marco palm out to camera, mock-serious focused brow. [+recipe]

---

## 🇳🇱 Dutch Tutorials (`nl`) — Host: **Daan** · accent **Amsterdam Orange #EA580C**

**Character:** Upbeat, direct Dutch tutor, late 20s. Clear, no-nonsense, cheerful "here's exactly how" energy.

**MASTER identity prompt:**
```
Photoreal portrait of Daan, a cheerful Dutch software tutor, late 20s, light
brown tousled hair, clean-shaven, blue eyes, fair skin, tall friendly build.
Wearing a modern orange (#EA580C) accented casual sweatshirt or zip-hoodie over
a plain tee, relaxed and modern. Open honest smile, looking straight at camera.
[+ BASE RENDER RECIPE + NEGATIVE]
```

**Variations (attach Daan master as reference + consistency directive):**
1. `pointing-side` / `excited` — Daan pointing toward the copy space, cheerful open grin. [+recipe]
2. `thumbs-up` / `confident` — Daan clear thumbs-up, friendly direct smile. [+recipe]
3. `open-hands-surprised` / `amazed` — Daan both hands up, bright surprised "wow" face. [+recipe]
4. `explaining-palm` / `friendly` — Daan open palm mid-explanation, clear and upbeat. [+recipe]
5. `finger-up-tip` / `knowing` — Daan index finger up, cheeky knowing look, brow raised. [+recipe]
6. `hand-on-chin` / `curious` — Daan hand on chin, thoughtful, eyes up-left. [+recipe]
7. `both-thumbs-celebrate` / `delighted` — Daan two thumbs up, laughing, celebrating a win. [+recipe]
8. `stop-palm` / `serious` — Daan palm out to camera, focused serious expression. [+recipe]

---

## 🇸🇪 Swedish Tutorials (`sv`) — Host: **Erik** · accent **Nordic Teal #0D9488** (warm-yellow rim optional)

**Character:** Calm, precise Scandinavian tutor, early 30s. Minimal, clear, quietly confident.

**MASTER identity prompt:**
```
Photoreal portrait of Erik, a calm Swedish software tutor, early 30s, light
blond hair short and neat, clean-shaven or very light stubble, pale blue eyes,
fair skin. Wearing a modern teal (#0D9488) accented merino sweater or clean
zip-top, minimalist Scandinavian style. Calm friendly closed-mouth smile,
looking straight at camera, optional warm-yellow rim light. [+ BASE RENDER RECIPE + NEGATIVE]
```

**Variations (attach Erik master as reference + consistency directive):**
1. `pointing-side` / `excited` — Erik pointing toward the copy space, bright but composed smile. [+recipe]
2. `thumbs-up` / `confident` — Erik calm clear thumbs-up, quietly confident. [+recipe]
3. `open-hands-surprised` / `amazed` — Erik both hands up, eyebrows raised, understated surprise. [+recipe]
4. `explaining-palm` / `friendly` — Erik open palm mid-explanation, clear and measured. [+recipe]
5. `finger-up-tip` / `knowing` — Erik index finger up, subtle knowing look, one brow raised. [+recipe]
6. `hand-on-chin` / `curious` — Erik hand on chin, thoughtful and calm, eyes to the side. [+recipe]
7. `both-thumbs-celebrate` / `delighted` — Erik two thumbs up with a genuine laugh. [+recipe]
8. `stop-palm` / `serious` — Erik palm out to camera, focused serious brow. [+recipe]

---

## Quick reference — seed mapping

Each host → one `characters` row; each variation → one `character_images` row:

| Channel | `characters.name` | Accent | # images |
|---------|-------------------|--------|----------|
| de | Max   | #2563EB Signal Blue | 8 |
| en | Jake  | #DC2626 Bold Red | 8 |
| fr | Théo  | #4F46E5 Royal Indigo | 8 |
| it | Marco | #059669 Emerald | 8 |
| nl | Daan  | #EA580C Amsterdam Orange | 8 |
| sv | Erik  | #0D9488 Nordic Teal | 8 |

`character_images` columns to fill per image: `pose`, `expression` (from the table above), `image_path` (the transparent PNG), `is_active=true`, linked to the channel's character. Once populated + the `channel_hosts` binding is migrated/seeded, `resolveChannelHost` will feed these into every tutorial thumbnail automatically.

---

*Generated for the Tutorial Studio thumbnail engine. Hosts are male by default to match the male narration voices; fully swappable on request.*

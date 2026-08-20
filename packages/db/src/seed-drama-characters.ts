import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { dramaCharacters } from "./schema/drama-characters.js";
import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
config({ path: resolve(__dirname, "../../../.env") });

import { loadConfig, getConfig } from "@repo/config";

const PRESET_CHARACTERS = [
  {
    name: "Marcus",
    description:
      "Marcus, a tall broad-shouldered Black man in his mid-30s, dark brown skin, close-cropped fade with sharp line-up, strong jawline, thick eyebrows, deep-set dark brown eyes, full lips, muscular build with wide chest, construction worker aesthetic — often wearing a fitted Henley or work jacket, steel-toe boots, canvas work pants. Carries himself with quiet confidence. Hands are large with visible knuckles, slight calluses. Height approximately 6'2\".",
  },
  {
    name: "DeShawn",
    description:
      "DeShawn, a poised Black businessman in his late 30s, medium-dark brown skin with a warm undertone, neatly trimmed close beard with crisp edges, medium build, sharp cheekbones, almond-shaped dark eyes, well-groomed eyebrows. Always impeccably dressed — tailored navy or charcoal suit, crisp white or light blue dress shirt, silk tie, polished Oxford shoes. Wears a subtle watch on his left wrist. Posture is commanding, expression often calculating. Height approximately 6'0\".",
  },
  {
    name: "Aaliyah",
    description:
      "Aaliyah, an elegant Black woman in her early 30s, medium brown skin with golden undertones, long natural curls or box braids falling past her shoulders, full lips with a warm smile, high cheekbones, wide expressive dark eyes with long lashes, slender build with graceful posture. Often wearing fitted wrap dresses, blazers over silk tops, or tailored coordinates in jewel tones — emerald, burgundy, cobalt. Gold hoop earrings, delicate necklace. Nails always done. Height approximately 5'7\".",
  },
  {
    name: "James",
    description:
      "James, a tall White businessman in his late 40s, silver-streaked dark hair combed back neatly, square jaw with light stubble, pale complexion with subtle weathering, piercing blue-grey eyes, broad shoulders, lean but not thin build. Wardrobe is understated power — charcoal or navy three-piece suits, crisp white shirts, cufflinks, luxury leather shoes. Expression is measured and controlled. Silver hair at temples. Height approximately 6'1\".",
  },
  {
    name: "Xavier",
    description:
      "Xavier, a creative Black man in his mid-30s, dark skin, long well-maintained dreadlocks pulled back loosely or falling past his shoulders with subtle gold thread woven in, full beard, expressive dark eyes, strong nose, medium build with an artist's ease. Wears layered artistic clothing — linen shirts, leather jackets, chunky rings, statement sneakers or boots. Often has paint or charcoal faint on his hands. Warm expressive face, frequent genuine smile. Height approximately 5'11\".",
  },
  {
    name: "Victoria",
    description:
      "Victoria, a professional Latina woman in her late 20s, warm light-olive to medium brown complexion, long straight dark brown hair falling to her mid-back or pulled into a sleek low ponytail, dark almond-shaped eyes with a sharp gaze, high cheekbones, full lips usually with a subtle nude lipstick, slim athletic build. Wardrobe is precise and professional — tailored blazers, structured blouses, fitted trousers, block-heel pumps. Carries herself briskly. Height approximately 5'5\".",
  },
  {
    name: "Raymond",
    description:
      "Raymond, a distinguished Black lawyer in his early 50s, medium-dark complexion, close-cropped silver and black hair, silver at the temples and in his neatly trimmed full beard, strong broad forehead, authoritative dark eyes under heavy brows, stocky powerful build. Always in courtroom-ready attire — charcoal or black suit, white dress shirt, conservative tie, leather briefcase. Reading glasses perched on his nose or in his breast pocket. Projects gravitas. Height approximately 5'10\".",
  },
  {
    name: "Sophia",
    description:
      "Sophia, a White woman in her late 20s, fair skin with a slight flush, shoulder-length blonde hair with subtle waves, bright blue-green eyes that are unusually expressive and easy to read, small nose, full lips, slender build with animated gestures. Wardrobe skews casual-elegant — floral sundresses, fitted jeans with blouses, cardigans, flat sandals or ankle boots. Emotional and reactive — her face telegraphs every feeling. Height approximately 5'4\".",
  },
];

async function seedDramaCharacters() {
  console.log("[seed-drama-characters] Loading config...");
  try {
    loadConfig();
  } catch (e) {
    console.error(e);
    process.exit(1);
  }

  const { DATABASE_URL } = getConfig();
  const sql = postgres(DATABASE_URL);
  const db = drizzle(sql);

  console.log("Seeding drama characters...");

  // Remove existing presets and re-insert so descriptions stay current
  await db.delete(dramaCharacters).where(eq(dramaCharacters.is_preset, true));

  await db.insert(dramaCharacters).values(
    PRESET_CHARACTERS.map((c) => ({
      name: c.name,
      description: c.description,
      is_preset: true,
    })),
  );

  for (const c of PRESET_CHARACTERS) console.log(`  ✓ ${c.name}`);
  console.log(`Done. Seeded ${PRESET_CHARACTERS.length} preset characters.`);
  await sql.end();
  process.exit(0);
}

seedDramaCharacters().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});

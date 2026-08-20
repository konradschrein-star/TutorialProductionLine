/**
 * Product brand hints for thumbnail briefs.
 *
 * The owner's complaint, verbatim: "The logos are way too small and from afar I
 * really can't see what the tutorial is about, what software the tutorial is
 * about, or what problem it solves. ... On the stuff where the topic is very
 * easy, like that it is about, for example, a Google Meets walkthrough, then I
 * should clearly have the thumbnail be branded like Google Meets."
 *
 * WHY A MAP AND NOT A DATABASE
 * ----------------------------
 * The only thing the model genuinely needs from us is (a) permission to make
 * the logo big and (b) which colour should lead the frame. It already knows
 * what these logos look like. So this is a SMALL, high-confidence hint table —
 * roughly the products a software tutorial channel actually covers — and every
 * miss falls through to an honest instruction: use the product's OWN logo and
 * its OWN colours, do not invent them. That is deliberate: a wrong brand colour
 * is worse than no brand colour, and a 500-row table of half-remembered hex
 * values is exactly how wrong colours get shipped. Nothing here is a hex code
 * for that reason — the phrases name colours the model can already resolve
 * correctly, and the logo reference image (if any) still wins.
 *
 * Add an entry only when you are certain. When in doubt, leave it out: the
 * fallback is correct, just less specific.
 *
 * PURE module: no DB, no network, unit-tested.
 */

/** Canonical hint per product. Keep each phrase SHORT — it costs prompt budget. */
const BRAND_HINTS: ReadonlyArray<{ aliases: string[]; hint: string }> = [
  // ── Google Workspace ──────────────────────────────────────────────────────
  { aliases: ["google docs", "gdocs"], hint: "Google Docs blue" },
  { aliases: ["google sheets", "gsheets"], hint: "Google Sheets green" },
  { aliases: ["google slides"], hint: "Google Slides yellow" },
  { aliases: ["google drive"], hint: "Google Drive blue, green and yellow" },
  { aliases: ["google meet", "google meets"], hint: "Google Meet green" },
  { aliases: ["gmail"], hint: "Gmail red on white" },
  { aliases: ["google calendar"], hint: "Google Calendar blue" },
  { aliases: ["google forms"], hint: "Google Forms purple" },
  // ── Microsoft ─────────────────────────────────────────────────────────────
  { aliases: ["excel", "microsoft excel"], hint: "Excel green" },
  { aliases: ["microsoft word", "ms word"], hint: "Word blue" },
  { aliases: ["powerpoint"], hint: "PowerPoint red-orange" },
  { aliases: ["outlook"], hint: "Outlook blue" },
  { aliases: ["microsoft teams", "ms teams"], hint: "Teams purple" },
  // ── Productivity / SaaS ───────────────────────────────────────────────────
  { aliases: ["notion"], hint: "Notion black and white" },
  { aliases: ["slack"], hint: "Slack aubergine" },
  { aliases: ["zoom"], hint: "Zoom blue" },
  { aliases: ["trello"], hint: "Trello blue" },
  { aliases: ["airtable"], hint: "Airtable blue and yellow" },
  { aliases: ["zapier"], hint: "Zapier orange" },
  { aliases: ["hubspot"], hint: "HubSpot orange" },
  { aliases: ["salesforce"], hint: "Salesforce blue" },
  { aliases: ["quickbooks"], hint: "QuickBooks green" },
  { aliases: ["shopify"], hint: "Shopify green" },
  { aliases: ["wordpress"], hint: "WordPress dark blue-grey" },
  // ── Creative / dev ────────────────────────────────────────────────────────
  { aliases: ["canva"], hint: "Canva cyan-to-purple" },
  { aliases: ["figma"], hint: "Figma's multicolour marks" },
  { aliases: ["photoshop"], hint: "Photoshop deep blue" },
  { aliases: ["premiere pro", "premiere"], hint: "Premiere Pro violet" },
  { aliases: ["chatgpt", "openai"], hint: "OpenAI black and white" },
  { aliases: ["virtualbox"], hint: "VirtualBox blue" },
];

/**
 * Colours that must not leave the logo. Matched on the hint phrase rather than
 * kept as a per-brand flag so a newly added orange brand inherits the rule
 * automatically — forgetting the flag is how orange came back the first time.
 */
function isLogoOnly(hint: string): boolean {
  return /\borange\b/i.test(hint);
}

function normalise(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * The colour/mark phrase for a product, or null when we are not sure.
 *
 * Matching is deliberately conservative: the alias must appear as a whole
 * phrase inside the normalised subject ("google meet" matches "Google Meet
 * walkthrough"), and the LONGEST alias wins so "google sheets" never loses to
 * a shorter accidental substring.
 */
export function brandHintFor(logoSubject: string | null): string | null {
  if (!logoSubject?.trim()) return null;
  const subject = ` ${normalise(logoSubject)} `;
  let best: { hint: string; length: number } | null = null;
  for (const entry of BRAND_HINTS) {
    for (const alias of entry.aliases) {
      if (!subject.includes(` ${alias} `)) continue;
      if (!best || alias.length > best.length) {
        best = { hint: entry.hint, length: alias.length };
      }
    }
  }
  return best?.hint ?? null;
}

/**
 * The branding directive that goes into the prompt.
 *
 * `prominent` (the archetype's `features_logo`) upgrades the logo from "in the
 * frame, large" to "inside the headline lockup" — that is the Search-Intent
 * layout the owner endorsed, where the mark sits inline with the type.
 *
 * Returns null when no product was supplied; the caller then emits the
 * title-derived fallback instead, which never names a brand we were not given.
 */
export function brandingDirective(
  logoSubject: string | null,
  prominent: boolean,
): string | null {
  const subject = logoSubject?.trim();
  if (!subject) return null;
  const hint = brandHintFor(subject);
  /**
   * ── Accent, not field ─────────────────────────────────────────────────────
   * This clause used to read "Lead the palette with Google Slides yellow." A
   * model leads the palette by flooding the background with it, and it did:
   * "Why the fuck is the background this washed-out AI yellow? We do not want
   * that." The brand colour is still the right colour — the owner asked for a
   * Snapchat tutorial to read yellow and a Facebook one to read blue — but it
   * belongs on the logo, the type and ONE block, over white.
   */
  const colour = !hint
    ? `Take the accent colour from ${subject}'s own real logo — never invent one.`
    : /**
       * Orange is the one colour the owner named twice, in both reviews: "I do
       * not like this orange appearing everywhere. I would rather the yellow
       * and the white." A brand whose real colour IS orange still gets an
       * accurate logo — the colour simply stops at the logo's edge.
       */
      isLogoOnly(hint)
      ? `${hint} appears on the logo ONLY; the type is near-black.`
      : `Use ${hint} on the logo, the type and one accent shape — nowhere else.`;
  const placement = prominent
    ? `inline in the headline lockup`
    : `beside the headline or the host`;
  /**
   * Every clause here is paid for out of a 2000-char prompt budget, so each one
   * earns its place from an observed failure:
   *   "LARGE, a fifth of the frame"  — the logos were too small to read.
   *   "OFFICIAL, accurately drawn"   — models cheerfully invent lookalikes.
   *   "the ONLY logo"                — a QuickBooks tutorial rendered the EXCEL
   *                                    logo, inherited from the reference image
   *                                    the template was cut from. Naming the
   *                                    right brand was never the problem;
   *                                    forbidding the wrong one is.
   *   "ONE mark, not several small"  — "rather one big logo than multiple
   *                                    smaller ones".
   */
  /**
   * ── Never put an adjective in front of the brand name ─────────────────────
   * This line used to read "ONE big, official, accurately drawn QuickBooks
   * logo". The model rendered the words "official quickbooks" INTO the
   * thumbnail, wordmark and all — it read the adjective as part of the mark's
   * name. Anything qualifying the logo now trails it, so the only text the
   * model can lift from this sentence is the product name itself.
   *
   * "exactly one instance" replaced "the ONLY logo": Gusto came back with its
   * icon in the headline lockup AND its wordmark bottom-left, which satisfies
   * "only one logo" on a literal reading — one brand, two placements.
   */
  return (
    `Brand it as ${subject}: exactly ONE ${subject} logo ${placement}, drawn ` +
    `accurately from the real mark, a fifth of the frame wide. No second copy ` +
    `of it anywhere, and no other product's logo. ${colour}`
  );
}

/**
 * Used when no product was supplied. It cannot name a brand (we were not told
 * one), so it tells the model to brand from the topic if — and only if — the
 * topic names a real product. Silence here is how the current thumbnails ended
 * up with no software identity at all.
 */
export const BRANDING_FROM_TOPIC_FALLBACK =
  "If the topic names a specific software product, show that product's logo " +
  "LARGE (a fifth of the frame wide), drawn accurately from the real mark, " +
  "exactly once and with no other product's logo present. Its brand colour " +
  "goes on the logo and one accent shape; the background stays flat white.";

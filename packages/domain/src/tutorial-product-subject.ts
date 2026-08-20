/**
 * Derive the SOFTWARE a tutorial is about, from its title.
 *
 * WHY THIS EXISTS
 * ---------------
 * `logoSubject` is what turns a generic thumbnail into a branded one: it is the
 * only input to `brandingDirective()` (brand-hints.ts), which asks the model for
 * the product's real logo, large, in the product's own colours. Without it the
 * brief falls back to a title-derived composition that never names the product.
 *
 * Measured on production before this shipped: of 112 tutorial thumbnails with a
 * compiled brief, ZERO carried a logoSubject —
 *   select count(*) filter (where brief->'brand'->>'logoSubject' is not null)
 *   from thumbnails where subject_kind = 'tutorial_job';  -- 0 of 112
 * The field reached the queue contract and the brief compiler, and nothing ever
 * populated it, because the two enqueue sites (tutorial splice + stitch) never
 * passed one. This module is what they pass.
 *
 * WHY THE TITLE
 * -------------
 * Tutorial titles are machine-generated from a keyword and are highly regular —
 * "How To <action> In|To|Using <Product>". The product is a real, load-bearing
 * part of the title, so it is the most reliable source available. `keyword_ref`
 * would be better still, but only 3 of 2,466 jobs carry one.
 *
 * HONESTY RULE
 * ------------
 * Returns null rather than guessing. A WRONG product name is worse than none:
 * `brandingDirective` would then instruct the model to stamp the wrong
 * company's logo on the thumbnail. Everything here is therefore conservative,
 * and the caller simply omits `logoSubject` when this returns null — which is
 * exactly the behaviour that exists today, so a miss is never a regression.
 *
 * MEASURED COVERAGE
 * -----------------
 * Scored against all 2,077 distinct COMPLETED tutorial titles in production:
 * 1,864 resolved (89.7%). The 213 unresolved are overwhelmingly segment and
 * scratch titles that name no product at all ("4.3 — Part 1", "12b",
 * "10_Jotform_Intermediate") and SHOULD resolve to null.
 *
 * PURE module: no DB, no network, no I/O. Unit-tested.
 */

/**
 * Products these channels actually publish tutorials about, taken from the
 * production title corpus rather than imagined. Canonical display name first —
 * that string goes into the prompt verbatim, so its casing matters
 * ("Monday.com", not "monday com").
 *
 * This is an IDENTITY table, deliberately separate from BRAND_HINTS in
 * brand-hints.ts, which is a COLOUR table. Naming a product we recognise is
 * safe; asserting its brand colour is not, and brand-hints.ts is explicit that
 * a wrong colour is worse than no colour. A product listed here but absent
 * there still gets the honest directive "take the colour from the product's own
 * real logo" — which is the correct outcome, not a degraded one.
 */
const PRODUCTS: ReadonlyArray<{ name: string; aliases: string[] }> = [
  // ── Google Workspace ──────────────────────────────────────────────────────
  { name: "Google Docs", aliases: ["google docs", "gdocs"] },
  { name: "Google Sheets", aliases: ["google sheets", "gsheets", "google sheet"] },
  { name: "Google Slides", aliases: ["google slides"] },
  { name: "Google Drive", aliases: ["google drive"] },
  { name: "Google Meet", aliases: ["google meet", "google meets"] },
  { name: "Google Calendar", aliases: ["google calendar"] },
  { name: "Google Forms", aliases: ["google forms"] },
  { name: "Gmail", aliases: ["gmail"] },
  { name: "AppSheet", aliases: ["appsheet"] },
  // ── Microsoft ─────────────────────────────────────────────────────────────
  { name: "Excel", aliases: ["excel", "microsoft excel", "excel online"] },
  { name: "Microsoft Word", aliases: ["microsoft word", "ms word"] },
  { name: "PowerPoint", aliases: ["powerpoint"] },
  { name: "Outlook", aliases: ["outlook"] },
  { name: "Microsoft Teams", aliases: ["microsoft teams", "ms teams"] },
  // ── Notes / docs / wikis ──────────────────────────────────────────────────
  { name: "Obsidian", aliases: ["obsidian"] },
  { name: "Notion", aliases: ["notion"] },
  { name: "Coda", aliases: ["coda"] },
  // ── Project & work management ─────────────────────────────────────────────
  { name: "ClickUp", aliases: ["clickup"] },
  { name: "Monday.com", aliases: ["monday com", "monday.com"] },
  { name: "Trello", aliases: ["trello"] },
  { name: "Asana", aliases: ["asana"] },
  { name: "Wrike", aliases: ["wrike"] },
  { name: "Smartsheet", aliases: ["smartsheet"] },
  { name: "Airtable", aliases: ["airtable"] },
  { name: "Softr", aliases: ["softr"] },
  { name: "Glide", aliases: ["glide"] },
  // ── Automation ────────────────────────────────────────────────────────────
  { name: "Zapier", aliases: ["zapier"] },
  { name: "Make", aliases: ["make com", "make.com", "integromat"] },
  { name: "n8n", aliases: ["n8n"] },
  // ── Email / marketing / CRM ───────────────────────────────────────────────
  { name: "MailerLite", aliases: ["mailerlite"] },
  { name: "Brevo", aliases: ["brevo", "sendinblue"] },
  { name: "GetResponse", aliases: ["getresponse"] },
  { name: "ActiveCampaign", aliases: ["activecampaign"] },
  { name: "Constant Contact", aliases: ["constant contact"] },
  { name: "Mailchimp", aliases: ["mailchimp"] },
  { name: "HubSpot", aliases: ["hubspot"] },
  { name: "Salesforce", aliases: ["salesforce"] },
  // ── Forms & scheduling ────────────────────────────────────────────────────
  { name: "Jotform", aliases: ["jotform"] },
  { name: "Typeform", aliases: ["typeform"] },
  { name: "Calendly", aliases: ["calendly"] },
  // ── HR / payroll / finance ────────────────────────────────────────────────
  { name: "BambooHR", aliases: ["bamboohr"] },
  { name: "Gusto", aliases: ["gusto"] },
  { name: "Deel", aliases: ["deel"] },
  { name: "Expensify", aliases: ["expensify"] },
  { name: "QuickBooks", aliases: ["quickbooks"] },
  { name: "Sage Accounting", aliases: ["sage accounting", "sage"] },
  { name: "ZipBooks", aliases: ["zipbooks"] },
  { name: "Xero", aliases: ["xero"] },
  // ── Commerce / web ────────────────────────────────────────────────────────
  { name: "Shopify", aliases: ["shopify"] },
  { name: "WordPress", aliases: ["wordpress"] },
  // ── Creative / dev / misc ─────────────────────────────────────────────────
  { name: "Canva", aliases: ["canva"] },
  { name: "Figma", aliases: ["figma"] },
  { name: "Photoshop", aliases: ["photoshop"] },
  { name: "Premiere Pro", aliases: ["premiere pro"] },
  { name: "ChatGPT", aliases: ["chatgpt"] },
  { name: "Slack", aliases: ["slack"] },
  { name: "Zoom", aliases: ["zoom"] },
  { name: "VirtualBox", aliases: ["virtualbox"] },
  { name: "VLC", aliases: ["vlc"] },
];

/**
 * Prepositions that introduce the product in this title grammar:
 * "... In Obsidian", "... To Salesforce", "... Using Zapier".
 */
const PREPOSITIONS = new Set([
  "in",
  "to",
  "using",
  "with",
  "from",
  "on",
  "for",
  "into",
  "via",
]);

const ARTICLES = new Set(["a", "an", "the"]);

/**
 * Words that are never a product, used to trim the tail of a positional match
 * ("... in a GetResponse Email" -> "GetResponse") and to reject a tail made of
 * nothing but filler.
 */
const NON_PRODUCT_WORDS = new Set([
  "a",
  "an",
  "the",
  "your",
  "my",
  "it",
  "this",
  "that",
  "them",
  "you",
  "email",
  "emails",
  "account",
  "accounts",
  "file",
  "files",
  "page",
  "pages",
  "data",
  "free",
  "beginner",
  "beginners",
  "tutorial",
  "tutorials",
  "guide",
  "step",
  "steps",
  "minute",
  "minutes",
  "second",
  "seconds",
  "new",
  "old",
  "one",
  "two",
  "use",
  "user",
  "users",
  "support",
  "customer",
  "editor",
  "settings",
  "part",
]);

function normalise(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripWord(word: string): string {
  return word.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * The LAST recognised product named in the title.
 *
 * Last, not first, because this title grammar puts the tutorial's actual
 * subject at the end: "How To Send New Leads To HubSpot Using Zapier" is a
 * Zapier tutorial, and "How To Export Salesforce Reports To Google Sheets" is a
 * Google Sheets one. Taking the first match brands both with the wrong product.
 *
 * Aliases match only as whole phrases, and at equal position the longest alias
 * wins so "google sheets" never loses to a bare "sheets".
 */
function lastKnownProduct(title: string): string | null {
  const haystack = ` ${normalise(title)} `;
  let best: { index: number; length: number; name: string } | null = null;

  for (const product of PRODUCTS) {
    for (const alias of product.aliases) {
      const index = haystack.lastIndexOf(` ${alias} `);
      if (index === -1) continue;
      if (
        best === null ||
        index > best.index ||
        (index === best.index && alias.length > best.length)
      ) {
        best = { index, length: alias.length, name: product.name };
      }
    }
  }

  return best?.name ?? null;
}

/**
 * Fall back to the title's grammar for products we do not have listed: take
 * whatever follows the LAST preposition.
 *
 * Guarded hard, because this is the half that can invent nonsense — at most
 * three words, no filler-only tails, and nothing containing punctuation a
 * product name would not have. Anything that fails a guard returns null.
 */
function productByPosition(title: string): string | null {
  // Drop a trailing " - Tutorial for Beginners" / " — Part 1" style suffix.
  const head = title.split(/\s+[-–—]\s+/)[0] ?? title;
  const words = head.trim().split(/\s+/).filter(Boolean);

  let cut = -1;
  for (let i = words.length - 1; i >= 0; i--) {
    const word = words[i];
    if (word !== undefined && PREPOSITIONS.has(stripWord(word))) {
      cut = i;
      break;
    }
  }
  if (cut === -1) return null;

  let tail = words.slice(cut + 1);
  while (tail.length > 0 && ARTICLES.has(stripWord(tail[0] ?? ""))) {
    tail = tail.slice(1);
  }
  while (
    tail.length > 0 &&
    NON_PRODUCT_WORDS.has(stripWord(tail[tail.length - 1] ?? ""))
  ) {
    tail = tail.slice(0, -1);
  }

  if (tail.length === 0 || tail.length > 3) return null;
  if (tail.every((w) => NON_PRODUCT_WORDS.has(stripWord(w)))) return null;
  if (tail.some((w) => !/^[A-Za-z0-9][A-Za-z0-9.&+'-]*$/.test(w))) return null;

  return tail.join(" ");
}

/**
 * The product a tutorial is about, or null when we cannot tell.
 *
 * Pass the result to the thumbnail queue as `logoSubject`; omit the field
 * entirely when it is null.
 */
export function deriveLogoSubject(
  title: string | null | undefined,
): string | null {
  if (typeof title !== "string" || title.trim() === "") return null;
  return lastKnownProduct(title) ?? productByPosition(title);
}

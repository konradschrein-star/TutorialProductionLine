import { notFound } from "next/navigation";
import { hasPermission, isVisitorRole } from "@/lib/auth/rbac";
import { getSession } from "../_lib/v2-auth";
import { db } from "@/lib/db";
import {
  listTutorialJobsByUser,
  listPromptPresets,
  getTutorialSettings,
} from "@repo/db";
import { TUTORIAL_PROVIDERS } from "@repo/contracts";
import {
  getTutorialTotals,
  getTutorialLeaderboard,
  getVAStats,
  getVADailyLeaderboard,
  getVADailyTimeseries,
} from "@/lib/repositories/tutorial-repository";
import { listChannels } from "@/lib/repositories/channel-repository";
import { getTutorialProviderAvailability } from "@/lib/tutorial/provider-availability";
import { ProductionClient } from "./page-client";

export default async function ProductionPage() {
  const session = await getSession();
  // Two audiences now share this route. `view:production` is the tutorial
  // producer (all tabs). `manage:thumbnails` is the uploader VA, who gets the
  // Thumbnails tab and nothing else — see canProduce below and page-client's
  // tab filter. Everything the production tabs call still checks
  // view:production server-side, so the split is enforced twice.
  const canProduce = hasPermission(session, "view:production");
  const canFixThumbnails = hasPermission(session, "manage:thumbnails");
  if (!canProduce && !canFixThumbnails) notFound();

  const canManage = hasPermission(session, "manage:tutorial-settings");

  const [
    jobs,
    presets,
    settings,
    totals,
    leaderboard,
    vaStats,
    dailyLeaderboard,
    vaTimeseries,
    channels,
    providerAvailability,
  ] = await Promise.all([
    listTutorialJobsByUser(db, session.userId, 100),
    listPromptPresets(db),
    getTutorialSettings(db),
    getTutorialTotals(),
    getTutorialLeaderboard(),
    getVAStats(),
    getVADailyLeaderboard(),
    getVADailyTimeseries(),
    listChannels(),
    getTutorialProviderAvailability(),
  ]);

  const myCompleted =
    leaderboard.find((r) => r.userId === session.userId)?.completed ?? 0;

  /**
   * SERVER-RENDERED PROPS ARE A DISCLOSURE SURFACE TOO.
   *
   * The API allowlist in middleware stops the demo role calling the endpoints,
   * but everything below is fetched HERE, on the server, and serialised into
   * the page's own HTML. None of it goes through an API route, so none of it
   * was covered. Measured on the live page before this: the visitor's
   * /tutorial-studio HTML contained "Earl" 26 times, "Deion" 26, "Vaughn" 26,
   * plus Konrad, Ian, and all three real channel names — the VA roster, their
   * individual output, and the channels, straight out of the leaderboard and
   * channel props.
   *
   * So the demo gets pseudonyms and a single fictional channel. Team output is
   * blanked rather than faked: an invented leaderboard is a claim about
   * production volume made to someone deciding whether to buy, and the tab it
   * feeds is not the point of the demo anyway.
   */
  const isDemo = isVisitorRole(session.role);
  const demoChannels = [{ id: "demo-channel", name: "Demo Channel" }];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div>
        <h1
          style={{
            fontSize: 20,
            fontWeight: 800,
            color: "var(--v2-text-1)",
            margin: "0 0 6px 0",
          }}
        >
          Tutorial Studio
        </h1>
        <p style={{ fontSize: 13, color: "var(--v2-text-2)", margin: 0 }}>
          {canProduce
            ? "Create, record, and produce tutorial videos"
            : "Fix and choose thumbnails for finished videos"}
        </p>
      </div>

      <ProductionClient
        initialJobs={jobs}
        // The prompt presets ARE the product's script engineering — the
        // instructions that turn a topic into a narrated tutorial, tuned over
        // months. Shipping them to a prospect hands over the part that is hard
        // to copy. One neutral placeholder keeps the Create form coherent.
        presets={
          isDemo
            ? presets.slice(0, 1).map((p) => ({
                ...p,
                name: "Standard Tutorial",
                prompt_text:
                  "Prompt templates are configured per customer and are not shown in the demo.",
              }))
            : presets
        }
        // The settings singleton carries default_script_provider,
        // default_tts_provider and default_tts_voice — the last three strings
        // naming the stack, sitting in a row nobody thinks of as sensitive.
        settings={
          isDemo
            ? {
                ...settings,
                default_script_provider: "demo-llm",
                default_script_model: null,
                default_tts_provider: "demo-tts",
                default_tts_voice: "demo-voice",
              }
            : settings
        }
        // TUTORIAL_PROVIDERS is a static list, so it reaches the HTML without
        // any query running — which is why it survived the first pass of this
        // fix. It names every AI vendor behind the product (the script engine,
        // the voice engine, the fallbacks) and their model tiers. That is the
        // supply chain: the answer to "what would I have to sign up for to
        // rebuild this myself". The demo gets generic labels.
        providers={
          isDemo
            ? {
                llm: [
                  { id: "demo-llm", label: "Script engine", isDefault: true },
                ],
                tts: [
                  { id: "demo-tts", label: "Voice engine", isDefault: true },
                ],
              }
            : TUTORIAL_PROVIDERS
        }
        // Which engines have a resolvable credential. This replaces a
        // `keyMasks={[]}` that was passed literally empty, so the Create form
        // decided "needs API key" from data nobody ever wrote — labelling
        // ElevenLabs and AI33 unusable while their keys sat in the worker's
        // environment, and never clearing the label for anything.
        // Which AI vendors we hold credentials for, i.e. the supply chain. A
        // buyer does not need it and a competitor would like it.
        providerAvailability={
          isDemo ? { llm: {}, tts: {} } : providerAvailability
        }
        canManage={canManage}
        totals={isDemo ? { total: 25, week: 17 } : totals}
        leaderboard={isDemo ? [] : leaderboard}
        myCompleted={isDemo ? 17 : myCompleted}
        userId={session.userId}
        vaStats={isDemo ? [] : vaStats}
        dailyLeaderboard={isDemo ? [] : dailyLeaderboard}
        vaTimeseries={isDemo ? [] : vaTimeseries}
        // Only channels that actually receive tutorials (migration 0059).
        // listChannels() returns all 7 rows because the channels admin page
        // needs them, but offering a VA "Content Forge Main"
        // (youtube_channel_id 'UCxxxxxxxxxxxxxxxx'), an unconnected
        // "Ecom Notebook", a drama channel and "Test Channel" alongside the
        // three real ones is how the wrong answer gets picked.
        channels={
          isDemo
            ? demoChannels
            : channels
                .filter((c) => c.accepts_tutorials)
                .map((c) => ({ id: c.id, name: c.name }))
        }
        // Rankings get their own opt-in flag (migration 0063). Same reasoning
        // as above, different question: a tier-list channel is not necessarily
        // a tutorial channel.
        rankingChannels={
          isDemo
            ? demoChannels
            : channels
                .filter((c) => c.accepts_rankings)
                .map((c) => ({ id: c.id, name: c.name }))
        }
        canProduce={canProduce}
        canFixThumbnails={canFixThumbnails}
        isDemo={isDemo}
      />
    </div>
  );
}

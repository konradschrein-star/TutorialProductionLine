import { notFound } from "next/navigation";
import { hasPermission } from "@/lib/auth/rbac";
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
  // Producer VAs may edit their own workflow defaults (voice, speed, hotkey,
  // prompts) even without the broad admin settings grant.
  const canEditWorkflow =
    canManage || hasPermission(session, "edit:tutorial-workflow");

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
        presets={presets}
        settings={settings}
        providers={TUTORIAL_PROVIDERS}
        providerAvailability={providerAvailability}
        canManage={canManage}
        canEditWorkflow={canEditWorkflow}
        totals={totals}
        leaderboard={leaderboard}
        myCompleted={myCompleted}
        userId={session.userId}
        vaStats={vaStats}
        dailyLeaderboard={dailyLeaderboard}
        vaTimeseries={vaTimeseries}
        // Only PRIMARY channels may originate tutorials (migration 0064). The
        // language counterparts are translation-only and must not appear in the
        // Create picker. `language` rides along so Create can bind the job's
        // language to the channel and stop a VA from mismatching them.
        channels={channels
          .filter((c) => c.is_primary)
          .map((c) => ({ id: c.id, name: c.name, language: c.language }))}
        // Rankings get their own opt-in flag (migration 0063).
        rankingChannels={channels
          .filter((c) => c.accepts_rankings)
          .map((c) => ({ id: c.id, name: c.name }))}
        canProduce={canProduce}
        canFixThumbnails={canFixThumbnails}
      />
    </div>
  );
}

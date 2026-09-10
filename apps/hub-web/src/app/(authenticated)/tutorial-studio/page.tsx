import { notFound } from "next/navigation";
import { hasPermission } from "@/lib/auth/rbac";
import { getSession } from "../_lib/v2-auth";
import { db, users } from "@/lib/db";
import { eq } from "drizzle-orm";
import { mayProduceOnChannel } from "@/lib/tutorial/channel-access";
import {
  listTutorialJobsByUser,
  listTutorialJobs,
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
  // Producers can inspect their own delivery; this does not grant publication.
  const canViewDelivery = hasPermission(session, "upload:youtube-video") ||
    (hasPermission(session, "view:production") && hasPermission(session, "create:tutorial-job"));
  if (!canProduce && !canFixThumbnails && !canViewDelivery) notFound();

  const canManage = hasPermission(session, "manage:tutorial-settings");
  // Producer VAs may edit their own workflow defaults (voice, speed, hotkey,
  // prompts) even without the broad admin settings grant.
  const canEditWorkflow = canManage;
  const [currentUser] = await db.select().from(users).where(eq(users.id, session.userId)).limit(1);

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
    session.role === "ADMIN"
      ? listTutorialJobs(db, 100)
      : listTutorialJobsByUser(db, session.userId, 100),
    listPromptPresets(db),
    getTutorialSettings(db),
    getTutorialTotals(canManage ? undefined : session.userId),
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

      <ProductionClient
        initialJobs={jobs}
        presets={presets}
        settings={settings}
        providers={TUTORIAL_PROVIDERS}
        providerAvailability={providerAvailability}
        canManage={canManage}
        canEditWorkflow={canEditWorkflow}
        totals={totals}
        leaderboard={canManage ? leaderboard : leaderboard.filter((row) => row.userId === session.userId)}
        myCompleted={myCompleted}
        userId={session.userId}
        vaStats={canManage ? vaStats : vaStats.filter((row) => row.userId === session.userId)}
        dailyLeaderboard={canManage ? dailyLeaderboard : dailyLeaderboard.filter((row) => row.userId === session.userId)}
        vaTimeseries={canManage ? vaTimeseries : vaTimeseries.filter((row) => row.userId === session.userId)}
        // Only PRIMARY channels may originate tutorials (migration 0064). The
        // language counterparts are translation-only and must not appear in the
        // Create picker. `language` rides along so Create can bind the job's
        // language to the channel and stop a VA from mismatching them.
        channels={channels
          .filter((c) => currentUser && mayProduceOnChannel(currentUser, c))
          .map((c) => ({ id: c.id, name: c.name, language: c.language }))}
        // Rankings get their own opt-in flag (migration 0063).
        rankingChannels={channels
          .filter((c) => c.accepts_rankings)
          .map((c) => ({ id: c.id, name: c.name }))}
        canProduce={canProduce}
        canCreateTutorials={hasPermission(session, "create:tutorial-job")}
        canFixThumbnails={canFixThumbnails}
        canViewDelivery={canViewDelivery}
      />
    </div>
  );
}

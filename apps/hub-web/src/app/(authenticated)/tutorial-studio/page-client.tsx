"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";

import { ProductionDashboard } from "./_components/dashboard";
import { MyWork } from "./_components/my-work";
import { ActivityRecords } from "./_components/activity-records";
import { LegacyArchive } from "./_components/legacy-archive";
import { LocalizePanel } from "./_components/localize-panel";
import { Review } from "./_components/review";
import { ProductionCreate } from "./_components/create";
import { ProductionStudio } from "./_components/studio";
import { ProductionSettings } from "./_components/settings";
import { ProductionKeywords } from "./_components/keywords";

import { AllTutorials } from "./_components/all-tutorials";
import { UploadsTable } from "./_components/uploads";
import { ContentCalendar } from "./_components/content-calendar";
// Mounted at the page root, OUTSIDE the tab switch below: recording uploads run
// in a module-level manager and must stay visible while the VA leaves the
// Studio tab to start the next job.
import { RecordingUploadQueue } from "./_components/upload-queue";
import type { TutorialJob } from "@repo/db";
import type { TutorialPromptPreset } from "@repo/db";
import type { TutorialSettingsRow } from "@repo/db";

const TABS = [
  { id: "dashboard", label: "My work" },
  { id: "library", label: "All tutorials" },
  { id: "activity", label: "Team activity" },
  // Keywords feed creation, so keep them adjacent in workflow order.
  { id: "keywords", label: "Software & topics" },
  { id: "create", label: "Prepare scripts" },
  { id: "studio", label: "Record" },
  // Thumbnail approval happens before localization/rendering.
  { id: "thumbnails", label: "Thumbnails" },
  { id: "review", label: "Final review" },
  { id: "localize", label: "Languages" },
  // Each ready, approved language can be delivered independently.
  { id: "uploads", label: "Delivery" },
  { id: "calendar", label: "Content calendar" },
  { id: "settings", label: "My & workflow settings" },
] as const;



type TabId = (typeof TABS)[number]["id"];

const TERMINAL = new Set([
  "COMPLETED",
  "FAILED_SCRIPT",
  "FAILED_AUDIO",
  "FAILED_SPLICE",
  "CANCELLED",
]);

/** Identity of a detail-fetch attempt: the job, plus whether its script exists
 *  yet. A job whose script lands later gets one more attempt; one that simply
 *  has no steps typed in does not get another, ever. */
const detailKey = (j: {
  id: string;
  script_done_at?: Date | string | null;
}): string => `${j.id}:${j.script_done_at ? 1 : 0}`;

interface LeaderboardEntry {
  userId: string | null;
  name: string | null;
  completed: number;
}

interface VAStats {
  userId: string | null;
  name: string | null;
  count_7d: number;
  count_28d: number;
  count_90d: number;
  count_lifetime: number;
  minutes_7d: number;
  minutes_28d: number;
  minutes_90d: number;
  minutes_lifetime: number;
}

interface VADailyEntry {
  userId: string | null;
  name: string | null;
  count_today: number;
  minutes_today: number;
}

interface VADailyPoint {
  userId: string | null;
  name: string | null;
  day: string;
  count: number;
  minutes: number;
}

interface ProductionClientProps {
  initialJobs: TutorialJob[];
  presets: TutorialPromptPreset[];
  settings: TutorialSettingsRow;
  providers: { llm: any[]; tts: any[] };
  /** Provider id → true when a credential for it resolves. See page.tsx. */
  providerAvailability: {
    llm: Record<string, boolean>;
    tts: Record<string, boolean>;
  };
  canManage: boolean;
  /** Shared workflow defaults are Admin-only; per-job controls remain separate. */
  canEditWorkflow: boolean;
  totals: {
    total: number;
    week: number;
    translations: number;
    translationsWeek: number;
  };
  leaderboard: LeaderboardEntry[];
  myCompleted: number;
  userId: string;
  vaStats: VAStats[];
  dailyLeaderboard: VADailyEntry[];
  vaTimeseries: VADailyPoint[];
  channels: Array<{ id: string; name: string; language: string }>;
  /** Channels flagged accepts_rankings — the RANKING tab's picker. */
  rankingChannels: Array<{ id: string; name: string }>;
  /** view:production — the tutorial producer sees every tab. */
  canProduce: boolean;
  canCreateTutorials: boolean;
  /** manage:thumbnails — the uploader VA sees the Thumbnails tab only. */
  canFixThumbnails: boolean;
  canViewDelivery: boolean;
}

export function ProductionClient({
  initialJobs,
  presets,
  settings,
  providers,
  providerAvailability,
  canManage,
  canEditWorkflow,
  totals,
  leaderboard,
  myCompleted,
  userId,
  vaStats,
  dailyLeaderboard,
  vaTimeseries,
  channels,
  rankingChannels,
  canProduce,
  canCreateTutorials,
  canFixThumbnails,
  canViewDelivery,
}: ProductionClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Two independent grants: production tabs need view:production, the
  // Thumbnails tab needs manage:thumbnails. A TUTORIAL_VA has the first and
  // not the second, an UPLOADER_VA the second and not the first, ADMIN both —
  // so filter per tab rather than branching on a single role.
  /**
   * The read-only demo sees the two tabs that show the product working and
   * nothing else.
   *
   * It holds view:production, so canProduce is true and without this it got
   * the full set — landing on CREATE, a form whose submit 403s, and offering
   * Settings (pipeline configuration), Keywords (calls the keyword-tool embed,
   * which is refused) and the Video Stitcher. A prospect's first screen would
   * have been a form that does not work, next to tabs that error.
   *
   * Dashboard shows throughput, Studio shows the queue and a finished video.
   * That is the demo.
   */
  const visibleTabs = useMemo(
    () =>
      TABS.filter((candidate) => {
        if (canProduce && !canCreateTutorials) return candidate.id === "dashboard" || candidate.id === "library";
        if (candidate.id === "activity") return canManage;
        if (candidate.id === "uploads") return canViewDelivery;
        if (candidate.id === "settings") return canProduce && (canManage || canEditWorkflow);
        return candidate.id === "thumbnails" ? canFixThumbnails || canProduce : canProduce;
      }),
    [canFixThumbnails, canProduce, canCreateTutorials, canManage, canEditWorkflow, canViewDelivery],
  );
  // Default landing tab per role. A ?tab=<id> deep-link (e.g. the Keywords
  // sidebar item -> /tutorial-studio?tab=keywords) overrides it, but ONLY when
  // that tab is actually visible to this user — otherwise an UPLOADER_VA
  // following a Keywords link would land on a tab they cannot use. Read once at
  // mount via the lazy initializer; tab switches thereafter stay local state.
  const defaultTab: TabId = canProduce ? "dashboard" : canViewDelivery ? "uploads" : "thumbnails";
  const [tab, setTab] = useState<TabId>(() => {
    const requested = searchParams.get("tab");
    return requested && visibleTabs.some((t) => t.id === requested)
      ? (requested as TabId)
      : defaultTab;
  });

  // Next keeps the same page component mounted when a sidebar link only
  // changes ?tab=. Mirror the URL after every such navigation; otherwise the
  // Delivery & Uploads and Keywords links look clickable but leave the old tab
  // on screen until a full reload.
  useEffect(() => {
    const requested = searchParams.get("tab");
    if (requested && visibleTabs.some((candidate) => candidate.id === requested)) {
      setTab(requested as TabId);
    } else if (!requested && !visibleTabs.some((candidate) => candidate.id === tab)) {
      setTab(defaultTab);
    }
  }, [searchParams, tab, visibleTabs]);

  // There is one thumbnail surface: /thumbnails. The former in-page fixer was
  // a second, competing Thumbnail section with different capabilities.
  useEffect(() => {
    if (!canProduce && canFixThumbnails && !canViewDelivery) router.replace("/thumbnails");
  }, [canProduce, canFixThumbnails, canViewDelivery, router]);
  useEffect(() => {
    if (tab === "thumbnails") router.replace("/thumbnails");
  }, [tab, router]);
  const [jobs, setJobs] = useState<TutorialJob[]>(initialJobs);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  /**
   * Status transitions we have already toasted (`${id}:${status}`), so a job
   * finishing/failing announces itself exactly once — never again on later
   * polls, and never twice if the state updater is invoked twice.
   */
  const notifiedTransitions = useRef<Set<string>>(new Set());
  /**
   * Detail fetches already attempted, so a field that is legitimately EMPTY
   * does not re-request the same job on every 5s tick forever.
   *
   * A VA can create a job without typing any steps, and plenty of jobs have no
   * script yet. Without this guard the backfill below would re-fetch up to five
   * such jobs every poll — trading the fat payload this change removes for a
   * steady drip of requests that never terminates.
   *
   * Keyed on id + whether the script has landed, so a job legitimately
   * re-qualifies once its script finishes.
   */
  const detailTried = useRef<Set<string>>(new Set());

  // Poll the summary payload, not the full list. The full list carries
  // script_text for all 100 jobs — a 1.37 MB JSON body — and only the selected
  // job's script is ever rendered. Re-downloading and parsing ~1 MB of other
  // people's scripts every 5s stalls the main thread on the page the VA plays
  // the voiceover and records on. See the note in api/production/jobs/route.ts.
  const refresh = useCallback(async () => {
    if (!canProduce) return;
    try {
      const res = await fetch("/api/production/jobs?summary=1");
      if (!res.ok) return;
      const data = (await res.json()) as { jobs: TutorialJob[] };

      // Summary rows have the heavy fields stripped, so carry over whatever we
      // already hold (the SSR payload had them in full). steps_input is
      // stripped for the same reason as script_text — it is the same size and
      // is likewise only ever rendered for the SELECTED job — so it has to be
      // carried over the same way, or the "Steps" panel in Review Script would
      // blank out five seconds after the page loads.
      let needsDetail: string[] = [];
      // Status changes to announce once this poll settles. A job that finishes,
      // fails, or becomes ready to record must tell the VA — otherwise it just
      // silently leaves (or changes section in) the worklist and looks lost.
      const announce: Array<{ kind: "done" | "failed" | "ready"; title: string }> =
        [];
      setJobs((prev) => {
        const prevById = new Map(prev.map((j) => [j.id, j]));
        const merged = data.jobs.map((j) => {
          const known = prevById.get(j.id);
          if (known && known.status !== j.status) {
            const key = `${j.id}:${j.status}`;
            if (!notifiedTransitions.current.has(key)) {
              const title = j.title || "Your video";
              if (j.status === "COMPLETED") {
                notifiedTransitions.current.add(key);
                announce.push({ kind: "done", title });
              } else if (String(j.status).startsWith("FAILED")) {
                notifiedTransitions.current.add(key);
                announce.push({ kind: "failed", title });
              } else if (
                j.status === "READY_TO_RECORD" &&
                known.status !== "READY_TO_RECORD"
              ) {
                notifiedTransitions.current.add(key);
                announce.push({ kind: "ready", title });
              }
            }
          }
          if (!known) return j;
          return {
            ...j,
            script_text: known.script_text || j.script_text,
            steps_input: known.steps_input || j.steps_input,
          };
        });
        // A job created or finished while this page was open has no local copy
        // of either field. Fetch those individually rather than re-fetching
        // all 100.
        needsDetail = merged
          .filter((j) => (j.script_done_at && !j.script_text) || !j.steps_input)
          .filter((j) => !detailTried.current.has(detailKey(j)))
          .map((j) => j.id)
          .slice(0, 5);
        return merged;
      });

      // Announce transitions (outside the updater). Completed & ready are
      // reassuring successes; a failure is loud and long-lived so the VA sees
      // it and knows the video is in "Your Jobs" flagged red, not lost.
      for (const a of announce) {
        if (a.kind === "done") {
          toast.success(`“${a.title}” finished — find it in Finished Videos.`);
        } else if (a.kind === "ready") {
          toast.success(`“${a.title}” is ready to record.`);
        } else {
          toast.error(
            `“${a.title}” failed while processing. It's flagged in Your Jobs — open it to see why and retry. It was not lost.`,
            { duration: 12000 },
          );
        }
      }

      for (const id of needsDetail) {
        const row = data.jobs.find((j) => j.id === id);
        if (row) detailTried.current.add(detailKey(row));
        const one = await fetch(`/api/production/jobs/${id}`);
        if (!one.ok) continue;
        const { job } = (await one.json()) as { job: TutorialJob };
        if (!job) continue;
        setJobs((prev) =>
          prev.map((j) =>
            j.id === job.id
              ? {
                  ...j,
                  script_text: job.script_text || j.script_text,
                  steps_input: job.steps_input || j.steps_input,
                }
              : j,
          ),
        );
      }
    } catch {
      // ignore network errors
    }
  }, [canProduce]);

  /**
   * Read the list once on mount, always — even when every job we were handed is
   * terminal.
   *
   * THE BUG THIS FIXES: the owner created a job and Studio did not show it. The
   * job was created correctly (READY_TO_RECORD, and first in the response of
   * /api/production/jobs?summary=1). Nothing ever asked for it. Polling below
   * only ARMS when `jobs` already contains a non-terminal job, and every job in
   * the SSR payload was CANCELLED — so `hasActive` was false, the interval was
   * never created, and no fetch was ever made after the page loaded. Next's
   * client router cache then served that same stale RSC payload when the owner
   * navigated away and back, so the tab kept showing the old list indefinitely.
   *
   * A terminal list is exactly the state that needs a fresh read, not the one
   * state that skips it. This is one `?summary=1` request, which is why that
   * parameter exists (see api/production/jobs/route.ts) — the full list is a
   * 1.37 MB body and must never be what polling downloads.
   */
  useEffect(() => {
    void refresh();
  }, [refresh]);

  /**
   * And again on entering a tab that renders the list. Tab switches are local
   * state, not navigation, so nothing else re-reads — a VA who queues a job in
   * Create and clicks Studio a second later would otherwise see the list as it
   * was when the page loaded.
   */
  useEffect(() => {
    if (tab === "studio" || tab === "dashboard") void refresh();
  }, [tab, refresh]);

  useEffect(() => {
    const hasActive = jobs.some((j) => !TERMINAL.has(j.status));
    if (hasActive && !timer.current) {
      timer.current = setInterval(refresh, 5000);
    } else if (!hasActive && timer.current) {
      clearInterval(timer.current);
      timer.current = null;
    }
    return () => {
      if (timer.current) {
        clearInterval(timer.current);
        timer.current = null;
      }
    };
  }, [jobs, refresh]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div className="studio-page-heading">
        <div>
          <h1>{visibleTabs.find(item => item.id === tab)?.label ?? "Tutorial Studio"}</h1>
          <p>{tab === "dashboard" ? "Pick up your next task. Production keeps moving in the background." :
            tab === "library" ? "Every tutorial, from first script to published languages." :
            tab === "review" ? "Check the English original, inspect language readiness, then approve." :
            tab === "localize" ? "Track each language independently. Retry only what needs attention." :
            tab === "studio" ? "Record one tutorial while the next is being prepared." :
            tab === "create" ? "Work through your software batch without switching context." :
            tab === "keywords" ? "Choose a focused batch of tutorials for your channel." :
            tab === "uploads" ? "Approved files, scheduled slots, and upload confirmations." :
            tab === "calendar" ? "Channel capacity, publication reservations, and delivery evidence." :
            tab === "activity" ? "Recorded production milestones across your team." :
            "Configure your production workflow."}</p>
        </div>
      </div>

      {/* Tab content */}
      {tab === "dashboard" && (
        canCreateTutorials ? <MyWork jobs={jobs} /> : <AllTutorials title="Read-only tutorials" />
      )}
      {tab === "activity" && canManage && (
        <div>

        <ProductionDashboard
          jobs={jobs}
          totals={totals}
          leaderboard={leaderboard}
          myCompleted={myCompleted}
          userId={userId}
          vaStats={vaStats}
          dailyLeaderboard={dailyLeaderboard}
          vaTimeseries={vaTimeseries}
        />
        </div>
      )}
      {tab === "create" && (
        <ProductionCreate
          presets={presets}
          providers={providers}
          providerAvailability={providerAvailability}
          settings={settings}
          canManage={canManage}
          channels={channels}
          /* Stay on Create. The owner: "it would make sense to be led to the
             top of the create section again since what the VA's will do is
             generate multiple tutorials one after another." Throwing them into
             Studio after every job cost them a click back and lost their place
             in the claimed-keyword queue. Create scrolls itself to the top; the
             refresh keeps the Studio badge count honest from here. */
          onCreated={() => {
            void refresh();
          }}
        />
      )}
      {tab === "studio" && (
        <ProductionStudio
          userId={userId}
          jobs={jobs}
          settings={settings}
          onChange={refresh}
        />
      )}
      {tab === "uploads" && <UploadsTable />}
      {tab === "calendar" && <ContentCalendar />}
      {tab === "library" && canProduce && <AllTutorials title="" />}
      {tab === "activity" && canManage && <ActivityRecords />}
      {tab === "library" && canProduce && <LegacyArchive />}
      {tab === "review" && <Review />}
      {tab === "localize" && <LocalizePanel />}
      {tab === "keywords" && <ProductionKeywords channels={channels} />}
      <RecordingUploadQueue />
      {tab === "settings" && (
      <>
        <ProductionSettings
          presets={presets}
          settings={settings}
          canManage={canManage}
          canEditWorkflow={canEditWorkflow}
        />
        </>
      )}
    </div>
  );
}

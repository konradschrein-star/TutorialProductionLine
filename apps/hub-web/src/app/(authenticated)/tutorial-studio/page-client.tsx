"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { V2Button } from "../_components";
import { ProductionDashboard } from "./_components/dashboard";
import { LocalizePanel } from "./_components/localize-panel";
import { Review } from "./_components/review";
import { ProductionCreate } from "./_components/create";
import { ProductionStudio } from "./_components/studio";
import { ProductionSettings } from "./_components/settings";
import { ProductionKeywords } from "./_components/keywords";
import { ProductionThumbnails } from "./_components/thumbnails";
import { ProductionRanking } from "./_components/ranking";
import { TtsHealthBadge } from "./_components/tts-health-badge";
// Mounted at the page root, OUTSIDE the tab switch below: recording uploads run
// in a module-level manager and must stay visible while the VA leaves the
// Studio tab to start the next job.
import { RecordingUploadQueue } from "./_components/upload-queue";
import type { TutorialJob } from "@repo/db";
import type { TutorialPromptPreset } from "@repo/db";
import type { TutorialSettingsRow } from "@repo/db";

const TABS = [
  { id: "dashboard", label: "Dashboard" },
  { id: "create", label: "Create" },
  { id: "studio", label: "Studio" },
  // RANKING lane. Tier-list videos are a separate content format with their
  // own worker pipeline, but the VA who runs them is this VA, so the entry
  // point belongs here rather than in a second tool they would have to learn.
  { id: "ranking", label: "Ranking" },
  // End-of-day review. Deliberately AFTER the production tabs: it is the last
  // thing a VA does, and it is a look back at what they finished rather than
  // another queue to work through.
  { id: "review", label: "Review" },
  { id: "localize", label: "Localize" },
  { id: "thumbnails", label: "Thumbnails" },
  { id: "keywords", label: "Keywords" },
  { id: "settings", label: "Settings" },
] as const;

/** Tabs an uploader VA (manage:thumbnails, no view:production) may see. */
const THUMBNAIL_ONLY_TABS = new Set<TabId>(["thumbnails"]);

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
  totals: { total: number; week: number };
  leaderboard: LeaderboardEntry[];
  myCompleted: number;
  userId: string;
  vaStats: VAStats[];
  dailyLeaderboard: VADailyEntry[];
  vaTimeseries: VADailyPoint[];
  channels: Array<{ id: string; name: string }>;
  /** Channels flagged accepts_rankings — the RANKING tab's picker. */
  rankingChannels: Array<{ id: string; name: string }>;
  /** view:production — the tutorial producer sees every tab. */
  canProduce: boolean;
  /** manage:thumbnails — the uploader VA sees the Thumbnails tab only. */
  canFixThumbnails: boolean;
}

export function ProductionClient({
  initialJobs,
  presets,
  settings,
  providers,
  providerAvailability,
  canManage,
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
  canFixThumbnails,
}: ProductionClientProps) {
  const router = useRouter();
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
  const visibleTabs = TABS.filter((t) =>
    THUMBNAIL_ONLY_TABS.has(t.id) ? canFixThumbnails : canProduce,
  );
  const [tab, setTab] = useState<TabId>(
    canProduce ? "create" : "thumbnails",
  );
  const [jobs, setJobs] = useState<TutorialJob[]>(initialJobs);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
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
      setJobs((prev) => {
        const prevById = new Map(prev.map((j) => [j.id, j]));
        const merged = data.jobs.map((j) => {
          const known = prevById.get(j.id);
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
  }, []);

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

  const readyCount = jobs.filter((j) => j.status === "READY_TO_RECORD").length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Tab bar */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {visibleTabs.map((t) => (
          <V2Button
            key={t.id}
            variant={tab === t.id ? "accent" : "outline"}
            onClick={() => setTab(t.id)}
          >
            {t.label}
            {t.id === "studio" && readyCount > 0 && (
              <span
                style={{
                  background: "var(--v2-accent)",
                  color: "#fff",
                  borderRadius: 9999,
                  fontSize: 9,
                  padding: "1px 5px",
                  fontWeight: 700,
                  marginLeft: 4,
                }}
              >
                {readyCount}
              </span>
            )}
          </V2Button>
        ))}
        {/* Video Stitcher lives in its own route (it has its own server-loaded
            jobs/presets), but belongs to the Tutorial Studio — so it sits in
            the same card row as the tabs. */}
        {canProduce && (
          <V2Button
            variant="outline"
            onClick={() => router.push("/tutorial-studio/video-stitcher")}
          >
            <span
              className="material-symbols-outlined"
              style={{ fontSize: 15 }}
            >
              video_library
            </span>
            Video Stitcher
            <span
              className="material-symbols-outlined"
              style={{ fontSize: 13, opacity: 0.5 }}
            >
              arrow_outward
            </span>
          </V2Button>
        )}
        {canProduce && <TtsHealthBadge />}
      </div>

      {/* Tab content */}
      {tab === "dashboard" && (
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
          jobs={jobs}
          settings={settings}
          onChange={refresh}
        />
      )}
      {tab === "ranking" && <ProductionRanking channels={rankingChannels} />}
      {tab === "review" && <Review />}
      {tab === "localize" && <LocalizePanel />}
      {tab === "thumbnails" && canFixThumbnails && <ProductionThumbnails />}
      {tab === "keywords" && <ProductionKeywords />}
      <RecordingUploadQueue />
      {tab === "settings" && (
        <ProductionSettings
          presets={presets}
          settings={settings}
          canManage={canManage}
        />
      )}
    </div>
  );
}

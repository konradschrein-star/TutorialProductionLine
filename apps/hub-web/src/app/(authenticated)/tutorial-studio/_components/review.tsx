"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useSearchParams } from "next/navigation";
import { reviewBlockingReasons } from "@/lib/tutorial/review-readiness";
import { reviewQueueUrl, reviewLocaleQueueUrl, selectReviewJob } from "@/lib/tutorial/review-deep-link";
import {
  adjacentReviewId,
  localeProgress,
  reviewShortcut,
} from "@/lib/tutorial/review-workflow";
import { languageName } from "@/lib/tutorial/languages";
import { LanguageFlag } from "@/components/language-flag";
import s from "./review-workspace.module.css";
import type { reviewQaEvidence } from "@/lib/tutorial/review-qa";

interface ReviewJob {
  id: string;
  title: string;
  channelName: string | null;
  channelId: string | null;
  completedAt: string | null;
  durationSeconds: number | null;
  reviewStatus: "approved" | "disapproved" | "rework_requested" | null;
  reviewedAt: string | null;
  qaStatus: string | null;
  qaSummary: string | null;
  qaEvidence?: ReturnType<typeof reviewQaEvidence>;
  thumbnailId: string | null;
  hasThumbnail: boolean;
  inDrive: boolean;
  hasDescription: boolean;
  hasTags: boolean;
  playable: boolean;
  localAvailable?: boolean;
  restoreEligible?: boolean;
  availabilityReason?: string;
  mine: boolean;
  thumbnailVariants: Array<{
    id: string;
    language: string;
    title: string;
    thumbnailId: string | null;
    thumbnailApproved?: boolean;
  }>;
}
interface ReviewResponse {
  nextCursor?: { beforeAt: string; beforeId: string } | null;
  hours: number;
  scope: "mine" | "all";
  canSeeEveryone: boolean;
  producedCount: number;
  approvedCount: number;
  disapprovedCount: number;
  jobs: ReviewJob[];
}
interface LocaleSource {
  id: string;
  targetLanguages?: string[];
  translations: Array<{ id?: string; language: string | null; status: string }>;
}

export function Review() {
  const searchParams = useSearchParams();
  const requestedJobId = searchParams.get("jobId");
  const hasRequestedJob = requestedJobId !== null;
  const [data, setData] = useState<ReviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [hours, setHours] = useState(0);
  const [cursor, setCursor] = useState<{ beforeAt: string; beforeId: string } | null>(null);
  const [scopeAll, setScopeAll] = useState(false);
  const [search, setSearch] = useState("");
  const [showReviewed, setShowReviewed] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(requestedJobId);
  useEffect(() => {
    if (requestedJobId !== null) setSelectedId(requestedJobId);
  }, [requestedJobId]);
  const [reworkId, setReworkId] = useState<string | null>(null);
  const [reworkReason, setReworkReason] = useState("");
  const [shortcuts, setShortcuts] = useState(false);
  const [localeSources, setLocaleSources] = useState<LocaleSource[] | null>(
    null,
  );
  const [localeError, setLocaleError] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const reworkRef = useRef<HTMLTextAreaElement>(null);
  const inFlight = useRef(false);
  const requestVersion = useRef(0);
  const localeRequestVersion = useRef(0);
  const load = useCallback(async () => {
    const version = ++requestVersion.current;
    try {
      const response = await fetch(
        `${reviewQueueUrl(hours, scopeAll, requestedJobId)}${showReviewed ? "&reviewed=1" : ""}${cursor ? `&${new URLSearchParams(cursor)}` : ""}`,
      );
      if (!response.ok) {
        const problem = await response.json().catch(() => null);
        throw new Error(problem?.error ?? `Could not load ${requestedJobId !== null ? "the linked tutorial" : "review queue"} (HTTP ${response.status}). Try again.`);
      }
      const result = (await response.json()) as ReviewResponse;
      if (version === requestVersion.current) {
        setData(result);
        setError(null);
      }
    } catch (err) {
      if (version === requestVersion.current) {
        setData(null);
        setError(
          err instanceof Error ? err.message : "Could not load review queue.",
        );
      }
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }, [hours, scopeAll, requestedJobId, showReviewed, cursor]);
  useEffect(() => { setCursor(null); }, [hours, scopeAll, requestedJobId, showReviewed]);
  useEffect(() => {
    setLoading(true);
    void load();
    return () => {
      requestVersion.current++;
    };
  }, [load]);
  const visibleJobs = useMemo(
    () =>
      (data?.jobs ?? []).filter(
        (job) =>
          job.id === requestedJobId || ((showReviewed || job.reviewStatus === null) &&
          `${job.title} ${job.channelName ?? ""}`
            .toLowerCase()
            .includes(search.trim().toLowerCase())),
      ),
    [data, search, showReviewed, requestedJobId],
  );
  const job = selectReviewJob(visibleJobs, selectedId, requestedJobId);
  const index = job ? visibleJobs.findIndex((item) => item.id === job.id) : -1;
  const loadLocales = useCallback(async () => {
    if (!job) return;
    const version = ++localeRequestVersion.current;
    try {
      const response = await fetch(
        reviewLocaleQueueUrl(job.id, data?.scope),
      );
      if (!response.ok) throw new Error();
      const result = (await response.json()) as { sources: LocaleSource[] };
      if (version !== localeRequestVersion.current) return;
      setLocaleSources(result.sources);
      setLocaleError(false);
    } catch {
      if (version === localeRequestVersion.current) setLocaleError(true);
    }
  }, [data?.scope, job?.id]);
  useEffect(() => {
    setLocaleSources(null);
    setLocaleError(false);
    void loadLocales();
    const timer = window.setInterval(() => void loadLocales(), 15000);
    return () => {
      clearInterval(timer);
      localeRequestVersion.current++;
    };
  }, [loadLocales]);
  useEffect(() => {
    if (job) setSelectedId(job.id);
  }, [job?.id]);
  useEffect(() => {
    if (reworkId) reworkRef.current?.focus();
  }, [reworkId]);
  const navigate = useCallback(
    (direction: -1 | 1) => {
      if (inFlight.current || reworkId) return;
      setSelectedId(
        adjacentReviewId(
          visibleJobs.map((item) => item.id),
          job?.id ?? null,
          direction,
        ),
      );
    },
    [visibleJobs, job?.id, reworkId],
  );
  const act = useCallback(
    async (
      target: ReviewJob,
      action: "approve" | "disapprove",
      reason?: string,
    ) => {
      if (inFlight.current || loading || error) return;
      if (
        action === "disapprove" &&
        target.reviewStatus &&
        target.reviewStatus !== "approved"
      )
        return;
      if (action === "approve") {
        if (target.reviewStatus !== null) return;
        const blockers = reviewBlockingReasons(target);
        if (blockers.length) {
          toast.warning(blockers.join(" "));
          return;
        }
      }
      if (action === "disapprove" && reason === undefined) {
        videoRef.current?.pause();
        setReworkId(target.id);
        setReworkReason("");
        return;
      }
      inFlight.current = true;
      setBusyId(target.id);
      try {
        const response = await fetch(
          `/api/production/tutorial-review/${target.id}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action, reason }),
          },
        );
        const body = (await response.json()) as {
          error?: string;
          reasons?: string[];
          plan?: {
            reserved: unknown[];
            outstanding: Array<{ reason: string }>;
          };
        };
        if (!response.ok)
          throw new Error(
            [
              body.error ?? `HTTP ${response.status}`,
              ...(body.reasons ?? []),
            ].join(" "),
          );
        toast.success(
          action === "approve"
            ? `Approved · ${body.plan?.reserved.length ?? 0} publication slots reserved in Studio`
            : `Returned "${target.title}" to recording`,
        );
        if (body.plan?.outstanding.length)
          toast.warning(
            `Some languages need attention: ${[...new Set(body.plan.outstanding.map((item) => item.reason))].join(" ")}`,
          );
        // Only advance on server confirmation. Server revision/byte/thumbnail
        // checks and independent language publication decisions remain authoritative.
        const remaining = visibleJobs.filter(
          (item) => item.id !== target.id && item.reviewStatus === null,
        );
        setSelectedId(
          remaining.find((item) => visibleJobs.indexOf(item) > index)?.id ??
            remaining[0]?.id ??
            null,
        );
        setData((current) =>
          current
            ? {
                ...current,
                jobs: current.jobs.map((item) =>
                  item.id === target.id
                    ? {
                        ...item,
                        reviewStatus:
                          action === "approve"
                            ? "approved"
                            : "rework_requested",
                      }
                    : item,
                ),
              }
            : current,
        );
        setReworkId(null);
        await load();
        void loadLocales();
      } catch (err) {
        toast.error(
          err instanceof Error
            ? err.message
            : "Review was not saved. Try again.",
        );
      } finally {
        inFlight.current = false;
        setBusyId(null);
      }
    },
    [visibleJobs, index, load, loadLocales, loading, error],
  );
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      const action = reviewShortcut(event, {
        enabled: shortcuts,
        busy: Boolean(busyId || loading || error),
        editing: Boolean(
          target?.closest(
            'input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"],[role="combobox"],[role="menu"]',
          ) ||
          (event.key === " " && target?.closest('video')) ||
          (event.key === " " &&
            target?.closest('button,a,summary,[role="button"]')),
        ),
        modalOpen: Boolean(
          reworkId ||
          Array.from(
            document.querySelectorAll(
              'dialog[open],[role="dialog"],[aria-modal="true"],[role="alertdialog"]',
            ),
          ).some((element) => element.getClientRects().length > 0),
        ),
      });
      if (!action || !job) return;
      event.preventDefault();
      if (action === "next") navigate(1);
      else if (action === "previous") navigate(-1);
      else if (action === "approve") void act(job, "approve");
      else if (action === "rework") void act(job, "disapprove");
      else if (videoRef.current) {
        if (videoRef.current.paused)
          void videoRef.current
            .play()
            .catch(() =>
              toast.error("Use the player controls to start playback."),
            );
        else videoRef.current.pause();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [shortcuts, busyId, loading, error, reworkId, job, navigate, act]);
  const blockers = job ? reviewBlockingReasons(job) : [];
  const localeSource = localeSources?.find((source) => source.id === job?.id);
  const locales = job
    ? [
        "en",
        ...new Set([
          ...(localeSource?.targetLanguages ?? []),
          ...job.thumbnailVariants
            .map((variant) => variant.language)
            .filter((language) => language !== "en"),
          ...(localeSource?.translations
            .map((item) => item.language)
            .filter((language): language is string =>
              Boolean(language && language !== "en"),
            ) ?? []),
        ]),
      ]
    : [];
  const disabled = Boolean(busyId || reworkId || loading);
  const producedLanguages =
    1 +
    locales.filter(
      (code) =>
        code !== "en" &&
        localeSource?.translations.filter((item) => item.language === code)
          .length === 1 &&
        localeSource.translations.find((item) => item.language === code)
          ?.status === "COMPLETED",
    ).length;
  return (
    <div className={`${s.workspace} ${s.compactReview}`}>
      <div
        className={s.compactToolbar}
        aria-label="Review filters and controls"
      >
        <label className={s.compactSearch}>
          Find tutorial
          <input
            className={s.field}
            type="search"
            placeholder="Title or channel"
            value={search}
            disabled={disabled}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <label className={s.compactControl}>
          Window
          <select
            className={s.field}
            value={hours}
            disabled={disabled}
            onChange={(event) => setHours(Number(event.target.value))}
          >
            <option value={0}>All time — no cutoff</option>
            <option value={48}>Last 2 days</option>
            <option value={168}>Last week</option>
          </select>
        </label>
        {data?.canSeeEveryone && (
          <label className={s.compactControl}>
            Work shown
            <select
              className={s.field}
              value={scopeAll ? "all" : "mine"}
              disabled={disabled}
              onChange={(event) => setScopeAll(event.target.value === "all")}
            >
              <option value="mine">My tutorials</option>
              <option value="all">All VAs</option>
            </select>
          </label>
        )}
        <span className={s.badge}>
          {data?.jobs.filter((item) => item.reviewStatus === null).length ?? 0}{" "}
          to review
        </span>
        <details className={s.reviewOptions}>
          <summary>View & keys · J / K navigation on</summary>
          <div className={s.optionContents}>
            <label className={s.actions}>
              <input
                type="checkbox"
                checked={showReviewed}
                disabled={disabled}
                onChange={(event) => setShowReviewed(event.target.checked)}
              />{" "}
              Include reviewed tutorials
            </label>
            <label className={s.actions}>
              <input
                type="checkbox"
                checked={shortcuts}
                onChange={(event) => setShortcuts(event.target.checked)}
              />{" "}
              Enable approval, rework and playback shortcuts
            </label>
            <p>
              <kbd>Q</kbd> approve · <kbd>R</kbd> rework · <kbd>J</kbd> next ·{" "}
              <kbd>K</kbd> previous · <kbd>Space</kbd> play / pause
            </p>
            <p className={s.muted}>
              J / K navigation is always available outside text fields and dialogs.
              Approval keys are opt-in. Space keeps the video player’s native controls.
            </p>
          </div>
        </details>
      </div>
      {hasRequestedJob && <p className={s.muted}>Opened from a direct review link; queue time and reviewed filters do not apply. <a href="/tutorial-studio?tab=review">Return to review queue</a></p>}
      {!hasRequestedJob && <div className={s.actions}><span className={s.muted}>Up to 200 matching tutorials per page; older unreviewed work remains available.</span>{cursor && <button className={s.button} disabled={disabled} onClick={() => setCursor(null)}>First page</button>}{data?.nextCursor && <button className={s.button} disabled={disabled} onClick={() => setCursor(data.nextCursor!)}>Older unreviewed tutorials</button>}</div>}
      {error && (
        <div role="alert" className={`${s.notice} ${s.error}`}>
          {error}{" "}
          <button className={s.button} onClick={() => void load()}>
            {hasRequestedJob ? "Retry linked tutorial" : "Retry queue"}
          </button>
        </div>
      )}
      {loading ? (
        <div role="status" className={s.panel}>
          {hasRequestedJob ? "Loading linked tutorial…" : "Loading review queue…"}
        </div>
      ) : !job ? (
        <div className={s.panel}>
          <h3 className={s.sectionTitle}>
            {hasRequestedJob ? "Linked tutorial unavailable" : search ? "No matching tutorials" : "Your review queue is clear"}
          </h3>
          <p className={s.muted}>
            {hasRequestedJob ? "Check the review link and your access. No other tutorial has been selected." : search
              ? "Try a different title or channel."
              : "No unreviewed tutorials on this page. Completed originals remain in review until reviewed; no default time cutoff applies."}
          </p>
        </div>
      ) : (
        <div className={s.layout}>
          <section className={s.focus} aria-label="Selected tutorial review">
            <div className={s.toolbar}>
              <span className={s.muted} aria-live="polite">
                Tutorial {index + 1} of {visibleJobs.length} · English original
              </span>
              <div className={s.actions}>
                <button
                  className={s.button}
                  disabled={disabled || index <= 0}
                  onClick={() => navigate(-1)}
                >
                  Previous <kbd>K</kbd>
                </button>
                <button
                  className={s.button}
                  disabled={disabled || index === visibleJobs.length - 1}
                  onClick={() => navigate(1)}
                >
                  Next <kbd>J</kbd>
                </button>
              </div>
            </div>
            <div>
              <h3 className={s.title}>{job.title}</h3>
              <p className={s.muted}>
                {job.channelName ?? "Channel not assigned"}
                {job.durationSeconds
                  ? ` · ${Math.floor(job.durationSeconds / 60)}:${String(Math.round(job.durationSeconds % 60)).padStart(2, "0")}`
                  : ""}
                {data?.scope === "all" && !job.mine ? " · another VA" : ""}
              </p>
            </div>
            <div className={s.decision}>
              <div className={s.toolbar}>
                <div className={s.actions}>
                  <button
                    className={`${s.button} ${s.danger}`}
                    disabled={
                      Boolean(busyId || reworkId || error) ||
                      Boolean(
                        job.reviewStatus && job.reviewStatus !== "approved",
                      )
                    }
                    onClick={() => void act(job, "disapprove")}
                  >
                    Return to recording <kbd>R</kbd>
                  </button>
                  <button
                    className={`${s.button} ${s.primary}`}
                    disabled={
                      Boolean(busyId || reworkId || error) ||
                      job.reviewStatus !== null ||
                      blockers.length > 0
                    }
                    onClick={() => void act(job, "approve")}
                  >
                    {busyId === job.id
                      ? "Saving…"
                      : job.reviewStatus === "approved"
                        ? "Approved"
                        : "Approve & next"}{" "}
                    <kbd>Q</kbd>
                  </button>
                </div>
              </div>
              {blockers.length > 0 && job.reviewStatus !== "approved" && (
                <div className={s.notice}>
                  <strong>Before approval</strong>
                  <ul>
                    {blockers.map((reason) => (
                      <li key={reason}>{reason}</li>
                    ))}
                  </ul>
                </div>
              )}
              {job.qaStatus === "failed" && job.qaSummary && (
                <p className={`${s.notice} ${s.error}`}>
                  Quality check: {job.qaSummary}
                </p>
              )}
              <div className={s.qaEvidence} aria-label="Recorded automated quality checks">
                {(job.qaEvidence ?? [{ id: "pending", label: "Automated checks", value: "Not measured", status: "unverified", target: null }]).map(check => <span key={check.id} className={s.badge} data-state={check.status}>
                  {check.label}: {check.value}{check.target ? ` · ${check.target}` : ""} · {check.status === "pass" ? "Passed" : check.status === "warn" ? "Warning" : check.status === "fail" ? "Failed" : "Unverified"}
                </span>)}
              </div>
              {reworkId === job.id && (
                <section
                  className={s.notice}
                  aria-label={`Return ${job.title} to recording`}
                >
                  <p>
                    Existing recordings and Drive files are preserved. The
                    replacement needs another review.
                  </p>
                  <label className={s.label} htmlFor={`rework-${job.id}`}>
                    What needs to change?
                    <textarea
                      ref={reworkRef}
                      id={`rework-${job.id}`}
                      className={s.field}
                      value={reworkReason}
                      onChange={(event) => setReworkReason(event.target.value)}
                      maxLength={2000}
                      rows={3}
                    />
                  </label>
                  <div className={s.actions} style={{ marginTop: 12 }}>
                    <button
                      className={`${s.button} ${s.danger}`}
                      disabled={Boolean(busyId) || !reworkReason.trim()}
                      onClick={() =>
                        void act(job, "disapprove", reworkReason.trim())
                      }
                    >
                      Confirm return to recording
                    </button>
                    <button
                      className={s.button}
                      disabled={Boolean(busyId)}
                      onClick={() => setReworkId(null)}
                    >
                      Keep in review
                    </button>
                  </div>
                </section>
              )}
            </div>
            {job.playable ? (
              <video
                key={job.id}
                ref={videoRef}
                aria-label={`English video: ${job.title}`}
                className={s.player}
                src={`/api/production/jobs/${job.id}/download?inline=1`}
                controls
                playsInline
                preload="none"
                poster={
                  job.thumbnailId
                    ? `/api/production/jobs/${job.id}/thumbnail/${job.thumbnailId}`
                    : undefined
                }
                onError={() =>
                  toast.error(
                    "The video could not be opened or verified. Check the media/Drive connection before approving it.",
                  )
                }
              />
            ) : (
              <div className={s.unavailable}>
                <h3>Video unavailable</h3>
                <p>
                  {job.availabilityReason === "drive_not_configured"
                    ? "An Admin must connect Drive to restore this video."
                    : "Restore or replace the video before approving."}
                </p>
                <button className={s.button} onClick={() => void load()}>
                  Check availability again
                </button>
              </div>
            )}
            {job.restoreEligible && !job.localAvailable && (
              <p className={s.muted}>
                This video restores from its verified Drive archive when opened.
              </p>
            )}
            <section className={s.panel} aria-label="Language readiness">
              <div className={s.toolbar}>
                <h3 className={s.sectionTitle}>Language pack</h3>
                <a className={s.link} href="/tutorial-studio?tab=localize">
                  Manage languages
                </a>
              </div>
              <p className={s.muted}>
                A produced video is not an upload confirmation. A held language
                does not mean the others failed.
              </p>
              {!localeError && localeSource && (
                <p>
                  <strong>
                    {producedLanguages} of {locales.length} language videos
                    produced
                  </strong>{" "}
                  ·{" "}
                  {
                    job.thumbnailVariants.filter(
                      (variant) => variant.thumbnailId,
                    ).length
                  }{" "}
                  thumbnails selected
                </p>
              )}
              {localeError && (
                <p role="status">
                  Language progress is unavailable.{" "}
                  <button
                    className={s.button}
                    onClick={() => void loadLocales()}
                  >
                    Retry language status
                  </button>
                </p>
              )}
              <div className={s.languageGrid}>
                {locales.map((code) => {
                  const variant = job.thumbnailVariants.find(
                    (item) => item.language === code,
                  );
                  const translations = localeSource?.translations.filter(
                    (item) => item.language === code,
                  );
                  const translation = translations?.[0];
                  const state =
                    code === "en"
                      ? "Video produced"
                      : localeError || !localeSources
                        ? "Status unavailable"
                        : !localeSource
                          ? "Language status unavailable for this tutorial"
                          : (translations?.length ?? 0) > 1
                            ? "Duplicate versions · Admin reconciliation needed"
                            : localeProgress(translation?.status, variant?.thumbnailApproved === true).label;
                  return (
                    <article className={s.language} key={code}>
                      <strong>
                        <LanguageFlag language={code} />{" "}
                        {code === "en"
                          ? "English · original"
                          : languageName(code)}
                      </strong>
                      <span className={s.badge}>{state}</span>
                      {variant?.thumbnailId ? (
                        <a
                          href={`/thumbnails?jobId=${job.id}&language=${encodeURIComponent(code)}`}
                          aria-label={`Edit ${code === "en" ? "English" : languageName(code)} thumbnail`}
                        >
                          <img
                            className={s.thumbnail}
                            src={`/api/production/jobs/${variant.id}/thumbnail/${variant.thumbnailId}`}
                            alt={`${code === "en" ? "English" : languageName(code)} thumbnail`}
                            loading="lazy"
                          />
                        </a>
                      ) : (
                        <div className={s.notice}>
                          Thumbnail needs attention
                        </div>
                      )}
                      <a
                        className={s.link}
                        href={`/thumbnails?jobId=${job.id}&language=${encodeURIComponent(code)}`}
                      >
                        {variant?.thumbnailId
                          ? "Edit thumbnail"
                          : "Prepare thumbnail"}
                      </a>
                    </article>
                  );
                })}
              </div>
              <details style={{ marginTop: 16 }}>
                <summary>Original metadata & archive</summary>
                <p>
                  {job.hasDescription
                    ? "Description present"
                    : "Description missing"}{" "}
                  · {job.hasTags ? "Tags present" : "Tags missing"} ·{" "}
                  {job.inDrive
                    ? "Drive receipt recorded"
                    : "No Drive receipt recorded"}
                </p>
                <p className={s.muted}>
                  Approval verifies current assets server-side. A receipt alone
                  is not proof of current bytes.
                </p>
              </details>
            </section>
          </section>
          <aside className={s.queue} aria-label="Tutorial review queue">
            <h3 className={s.sectionTitle}>Review queue</h3>
            <p className={s.muted}>Select a tutorial to focus it.</p>
            <ol className={s.queueList}>
              {visibleJobs.map((item, position) => (
                <li key={item.id}>
                  <button
                    className={s.queueItem}
                    aria-current={item.id === job.id}
                    disabled={disabled}
                    onClick={() => setSelectedId(item.id)}
                  >
                    <span>{position + 1}</span>
                    <span>
                      <strong>{item.title}</strong>
                      <br />
                      <span className={s.muted}>
                        {item.channelName ?? "No channel"} ·{" "}
                        {item.reviewStatus === "approved"
                          ? "Approved"
                          : item.reviewStatus
                            ? "Returned for rework"
                            : reviewBlockingReasons(item).length
                              ? "Needs attention"
                              : "Ready to review"}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          </aside>
        </div>
      )}
    </div>
  );
}

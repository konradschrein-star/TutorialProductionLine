"use client";
import { LanguageFlag } from "@/components/language-flag";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ALL_TARGET_LANGUAGES,
} from "@/lib/tutorial/languages";
import { localeProgress } from "@/lib/tutorial/review-workflow";
import { boundedMissingLocales } from "@/lib/tutorial/localization-targets";
import { toast } from "sonner";
import s from "./review-workspace.module.css";

interface TranslationRef {
  id?: string;
  language: string | null;
  status: string;
}
interface SourceRow {
  id: string;
  title: string | null;
  language: string | null;
  createdAt: string | null;
  mine?: boolean;
  canAct?: boolean;
  targetLanguages?: string[];
  translations: TranslationRef[];
}
type Overview = { sources: SourceRow[]; canSeeEveryone?: boolean };
const languageInfo = (code: string) =>
  ALL_TARGET_LANGUAGES.find((language) => language.code === code) ?? {
    code,
    name: code.toUpperCase(),
    native: code.toUpperCase(),
    flag: "",
  };

export function LocalizePanel() {
  const [sources, setSources] = useState<SourceRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [bulkRunning, setBulkRunning] = useState(false);
  const [cutoff, setCutoff] = useState("");
  const [batchLimit, setBatchLimit] = useState(5);
  const [showExtra, setShowExtra] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [attentionOnly, setAttentionOnly] = useState(false);
  const [scopeAll, setScopeAll] = useState(false);
  const [canSeeEveryone, setCanSeeEveryone] = useState(false);
  const inFlight = useRef(new Set<string>());
  const requestVersion = useRef(0);
  const load = useCallback(async () => {
    const version = ++requestVersion.current;
    try {
      const response = await fetch(
        `/api/production/tutorial-translate${scopeAll ? "?scope=all" : ""}`,
      );
      if (!response.ok)
        throw new Error(
          `Language overview could not load (HTTP ${response.status}).`,
        );
      const result = (await response.json()) as Overview;
      if (version === requestVersion.current) {
        setSources(result.sources);
        setCanSeeEveryone(result.canSeeEveryone === true);
        setError(null);
      }
    } catch (err) {
      if (version === requestVersion.current)
        setError(
          err instanceof Error
            ? err.message
            : "Language overview could not load.",
        );
    }
  }, [scopeAll]);
  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 15000);
    return () => {
      clearInterval(timer);
      requestVersion.current++;
    };
  }, [load]);
  const stats = useMemo(() => {
    let done = 0,
      pending = 0,
      attention = 0,
      missing = 0;
    for (const source of sources ?? [])
      for (const language of (source.targetLanguages ?? []).map(languageInfo)) {
        const matches = source.translations.filter(
          (item) => item.language === language.code,
        );
        const state = localeProgress(matches[0]?.status);
        if (
          matches.length > 1 ||
          state.kind === "attention" ||
          state.kind === "waiting"
        )
          attention++;
        else if (state.kind === "done") done++;
        else if (state.kind === "pending") pending++;
        else missing++;
      }
    return {
      done,
      pending,
      attention,
      missing,
      total: (sources ?? []).reduce((count, source) => count + (source.targetLanguages?.length ?? 0), 0),
    };
  }, [sources]);
  const enqueue = useCallback(
    async (
      source: SourceRow,
      languages: string[],
      mode: "automatic" | "manual" = "manual",
    ) => {
      const keys = languages.map((code) => `${source.id}:${code}`);
      if (
        !languages.length ||
        source.canAct === false ||
        keys.some((key) => inFlight.current.has(key))
      )
        return { queued: 0, failed: 0 };
      keys.forEach((key) => inFlight.current.add(key));
      setBusy(new Set(inFlight.current));
      setErrors((current) =>
        Object.fromEntries(
          Object.entries(current).filter(([key]) => !keys.includes(key)),
        ),
      );
      try {
        const response = await fetch(
          "/api/production/tutorial-translate/enqueue",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sourceJobId: source.id, languages, mode }),
          },
        );
        const result = (await response.json()) as {
          error?: string;
          reasons?: string[];
          enqueued?: string[];
        };
        if (!response.ok)
          throw new Error(
            [
              result.error ?? `HTTP ${response.status}`,
              ...(result.reasons ?? []),
            ].join(" "),
          );
        const queued = result.enqueued?.length ?? 0;
        if (mode === "manual")
          toast.success(
            queued
              ? `${languages.map((code) => languageInfo(code).name).join(", ")} queued`
              : "No new work queued. This language may already be in progress.",
          );
        await load();
        return { queued, failed: 0 };
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : "Could not queue this language. Try again.";
        setErrors((current) => ({
          ...current,
          ...Object.fromEntries(keys.map((key) => [key, message])),
        }));
        return { queued: 0, failed: languages.length };
      } finally {
        keys.forEach((key) => inFlight.current.delete(key));
        setBusy(new Set(inFlight.current));
      }
    },
    [load],
  );
  const batchMissing = async () => {
    if (!sources || bulkRunning || inFlight.current.size) return;
    setBulkRunning(true);
    let queued = 0,
      failed = 0;
    try {
      for (const { source, languages } of boundedMissingLocales(sources, cutoff, batchLimit)) {
        for (const language of languages) {
          const result = await enqueue(source, [language], "manual");
          queued += result.queued;
          failed += result.failed;
        }
      }
      if (failed)
        toast.warning(
          `${queued} language versions queued; ${failed} requests need attention. See the affected tutorial below.`,
        );
      else toast.success(`${queued} language versions queued.`);
    } finally {
      setBulkRunning(false);
    }
  };
  const visible = (sources ?? []).filter(
    (source) =>
      (source.title ?? "")
        .toLowerCase()
        .includes(search.trim().toLowerCase()) &&
      (!attentionOnly ||
        source.translations.some((item) =>
          ["attention", "waiting"].includes(localeProgress(item.status).kind),
        ) ||
        Object.keys(errors).some((key) => key.startsWith(source.id + ":"))),
  );
  return (
    <div className={s.workspace}>
      {canSeeEveryone && (
        <label className={s.label}>
          Work shown
          <select
            className={s.field}
            value={scopeAll ? "all" : "mine"}
            disabled={bulkRunning || busy.size > 0}
            onChange={(event) => {
              setSources(null);
              setScopeAll(event.target.value === "all");
            }}
          >
            <option value="mine">My tutorials</option>
            <option value="all">All VAs</option>
          </select>
        </label>
      )}
      <div className={s.actions} aria-label="Standard language progress">
        <span className={s.badge}>{stats.done} videos produced</span>
        <span className={s.badge}>{stats.pending} in progress</span>
        <span className={s.badge}>{stats.attention} need attention</span>
        <span className={s.badge}>{stats.missing} not started</span>
      </div>
      <div className={s.toolbar}>
        <label className={s.label} style={{ flex: "1 1 280px" }}>
          Find an English tutorial
          <input
            className={s.field}
            type="search"
            placeholder="Search tutorial titles"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <label className={s.actions}>
          <input
            type="checkbox"
            checked={attentionOnly}
            onChange={(event) => setAttentionOnly(event.target.checked)}
          />{" "}
          Needs attention only
        </label>
        <button className={s.button} onClick={() => void load()}>
          Refresh statuses
        </button>
      </div>
      <details className={s.panel}>
        <summary>Backfill missing versions — bounded explicit run</summary>
        <p>
          Only destinations explicitly enabled by your Admin are eligible. This run uses the latest 60 loaded tutorials, not an unbounded historical scan.
        </p>
        <div className={s.actions}>
          <label className={s.label}>Completed on or before (UTC)<input className={s.field} type="date" value={cutoff} disabled={bulkRunning} onChange={e => setCutoff(e.target.value)} /></label>
          <label className={s.label}>Maximum new versions<input className={s.field} type="number" min={1} max={20} value={batchLimit} disabled={bulkRunning} onChange={e => setBatchLimit(Number(e.target.value))} /></label>
        </div>
        <p className={s.muted}>
          Thumbnail approval and an assigned language channel are required.
          Batch actions do not retry failed versions or change existing ones.
        </p>
        <button
          className={s.button}
          disabled={
            bulkRunning || busy.size > 0 || !boundedMissingLocales(sources ?? [], cutoff, batchLimit).length || Boolean(error)
          }
          onClick={() => void batchMissing()}
        >
          {bulkRunning
            ? "Submitting one language at a time…"
            : `Queue up to ${batchLimit} missing versions`}
        </button>
      </details>
      {error && (
        <div className={`${s.notice} ${s.error}`} role="alert">
          {error}{" "}
          <button className={s.button} onClick={() => void load()}>
            Try loading again
          </button>
        </div>
      )}
      {!sources && !error && (
        <div role="status" className={s.panel}>
          Loading language versions…
        </div>
      )}
      {sources && !visible.length && (
        <div className={s.panel}>
          <h3 className={s.sectionTitle}>
            {sources.length
              ? "No tutorials match these filters"
              : "No completed English tutorials yet"}
          </h3>
          <p className={s.muted}>
            {sources.length
              ? "Clear your search or show all statuses."
              : "Complete an English original, then approve its language thumbnails to begin localization."}
          </p>
        </div>
      )}
      {visible.map((source) => {
        const extra = showExtra.has(source.id);
        // Existing nonstandard work is never hidden just because extras are collapsed.
        const languages = [...new Set([
          ...(source.targetLanguages ?? []),
          ...source.translations.map((item) => item.language).filter((language): language is string => Boolean(language && language !== "en")),
        ])].map(languageInfo);
        return (
          <section
            className={s.panel}
            key={source.id}
            aria-label={`Languages for ${source.title ?? "Untitled tutorial"}`}
          >
            <div className={s.toolbar}>
              <div>
                <h3 className={s.sectionTitle}>
                  {source.title ?? "Untitled tutorial"}
                </h3>
                <p className={s.muted}>
                  English original
                  {source.createdAt
                    ? ` · completed ${new Date(source.createdAt).toLocaleDateString()}`
                    : ""}
                  {source.mine === false ? " · another VA" : ""}
                </p>
              </div>
              <a className={s.link} href={`/thumbnails?jobId=${source.id}`}>
                Open thumbnail pack
              </a>
            </div>
            {source.canAct === false && (
              <p className={s.muted}>
                Read-only overview. The assigned producer or an Admin manages
                these versions.
              </p>
            )}
            <div className={s.actions} style={{ marginTop: 8, flexWrap: "wrap" }}>
              {languages.map(language => { const matches = source.translations.filter(item => item.language === language.code); const state = localeProgress(matches[0]?.status); return <a key={language.code} className={s.localeFlag} data-state={matches.length > 1 ? "attention" : state.kind} href={`/thumbnails?jobId=${source.id}&language=${encodeURIComponent(language.code)}`} aria-label={`${language.name}: ${state.label}. Edit only this thumbnail.`} title={`${language.name}: ${state.label}`}><LanguageFlag language={language.code} /> {language.code.toUpperCase()}<span aria-hidden="true" className={s.localeDot} /></a>; })}
              {!languages.length && <span className={s.muted}>No translation destinations configured for this channel.</span>}
            </div>
            {extra && <div className={s.localeRows}>
              {languages.map((language) => {
                const matches = source.translations.filter(
                  (item) => item.language === language.code,
                );
                const translation = matches[0],
                  state = localeProgress(translation?.status);
                const key = `${source.id}:${language.code}`,
                  working = busy.has(key),
                  problem = errors[key];
                const canQueue =
                  Boolean(state.action) &&
                  matches.length <= 1 &&
                  source.canAct !== false &&
                  Boolean(source.targetLanguages?.includes(language.code)) &&
                  !bulkRunning &&
                  !working &&
                  !error;
                return (
                  <article className={s.localeRow} key={language.code} data-state={state.kind}>
                    <div>
                      <strong><LanguageFlag language={language.code} fallback={language.flag} /> {language.name}</strong>
                      <div className={s.muted}>
                        {language.native}
                        {source.targetLanguages?.includes(language.code) ? " · enabled destination" : " · destination disabled"}
                      </div>
                    </div>
                    <span className={s.badge} data-state={state.kind} title={state.kind === "done" ? "Production finished; review and delivery are tracked separately." : undefined}>
                      {working
                        ? "Submitting…"
                        : matches.length > 1
                          ? "Duplicate versions · Admin reconciliation needed"
                          : state.label}
                    </span>
                    {problem && (
                      <p
                        id={`locale-error-${key}`}
                        className={`${s.notice} ${s.error}`}
                        role="alert"
                      >
                        {problem}
                      </p>
                    )}
                    <div className={s.actions}>
                      {state.action && (
                        <button
                          className={s.button}
                          aria-describedby={
                            problem ? `locale-error-${key}` : undefined
                          }
                          disabled={!canQueue}
                          onClick={() => void enqueue(source, [language.code])}
                        >
                          {working
                            ? "Submitting…"
                            : state.action === "retry"
                              ? `Generate missing ${language.name}`
                              : `Generate missing ${language.name}`}
                        </button>
                      )}
                      <a
                        className={s.link}
                        href={`/thumbnails?jobId=${source.id}&language=${encodeURIComponent(language.code)}`}
                      >
                        {state.kind === "waiting" || state.kind === "missing"
                          ? "Prepare thumbnail"
                          : "Edit thumbnail"}
                      </a>
                    </div>
                  </article>
                );
              })}
            </div>}
            {!extra && Object.entries(errors).filter(([key]) => key.startsWith(`${source.id}:`)).map(([key, message]) => <p key={key} role="alert" className={s.error}>{key.split(":").at(-1)?.toUpperCase()}: {message}</p>)}
            <button
              className={s.button}
              style={{ marginTop: 16 }}
              aria-expanded={extra}
              onClick={() =>
                setShowExtra((current) => {
                  const next = new Set(current);
                  if (next.has(source.id)) next.delete(source.id);
                  else next.add(source.id);
                  return next;
                })
              }
            >
              {extra
                ? "Hide language actions"
                : "Language actions & details"}
            </button>
          </section>
        );
      })}
    </div>
  );
}

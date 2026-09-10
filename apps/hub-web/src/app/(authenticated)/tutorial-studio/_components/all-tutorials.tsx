"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  LIBRARY_STAGES,
  libraryDuration,
  libraryStageTone,
  type LibraryData,
  type LibraryRecord,
} from "@/lib/tutorial/tutorial-library";
import styles from "./all-tutorials.module.css";
type Cursor = LibraryData["nextCursor"];
type Locales = {
  rows: LibraryRecord[];
  nextCursor: Cursor;
  loading: boolean;
  error: string;
};
const label = (value: string) => value.toLowerCase().replaceAll("_", " ");
function MobileRecord({ record, onChannel, onProducer }: { record: LibraryRecord; onChannel: (id: string) => void; onProducer?: (id: string) => void }) {
  return (
    <details className={styles.mobileDetails}>
      <summary>Details &amp; links</summary>
      <div>
        {record.channelId ? <button type="button" className={styles.filterLink} onClick={() => onChannel(record.channelId!)} aria-label={`Filter channel ${record.channel}`}>{record.channel ?? "Channel"}</button> : "Needs routing"} ·{" "}
        {onProducer && record.producerId ? <button type="button" className={styles.filterLink} onClick={() => onProducer(record.producerId!)} aria-label={`Filter producer ${record.producer}`}>{record.producer ?? "Producer"}</button> : record.producer ?? "Unknown producer"}
      </div>
      <div>
        Voice: {record.voice || "Not selected"} ·{" "}
        {record.provider || "Unknown provider"}
      </div>
      <div>
        {libraryDuration(record.duration)}{" "}
        {record.durationKind ?? ""}
      </div>
      {!record.thumbnailId && record.canCompose && <a className={styles.link} href={`/thumbnails?jobId=${record.sourceId ?? record.id}&language=${encodeURIComponent(record.language ?? "en")}`}>Create thumbnail</a>}
      {record.hasVideo && (
        <div>
          <a
            className={styles.link}
            href={`/api/production/jobs/${record.id}/download?inline=1`}
            target="_blank"
            rel="noreferrer"
          >
            Open video
          </a>
        </div>
      )}
      {record.youtubeUrl && (
        <>
          <div>
            <a
              className={styles.link}
              href={record.youtubeUrl}
              target="_blank"
              rel="noreferrer"
            >
              YouTube
            </a>{" "}
            ·{" "}
            <a
              className={styles.link}
              href={record.youtubeStudioUrl!}
              target="_blank"
              rel="noreferrer"
            >
              YouTube Studio
            </a>
          </div>
          <div>
            {record.youtubeVerified
              ? "✓ Upload verified"
              : "Reported link · unverified"}
          </div>
        </>
      )}
    </details>
  );
}
function Thumbnail({ record }: { record: LibraryRecord }) {
  const [failed, setFailed] = useState(false);
  return record.thumbnailId && !failed ? (
    <img
      className={styles.thumb}
      src={`/api/thumbnails/image/${record.thumbnailId}`}
      alt={`${record.language ?? "Original"} thumbnail`}
      width={64}
      height={36}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  ) : record.canCompose ? (
    <a className={`${styles.thumb} ${styles.placeholder} ${styles.link}`} href={`/thumbnails?jobId=${record.sourceId ?? record.id}&language=${encodeURIComponent(record.language ?? "en")}`} aria-label={`Create ${record.language ?? "English"} thumbnail for ${record.title}`}>Add image</a>
  ) : (
    <span className={`${styles.thumb} ${styles.placeholder}`}>No image</span>
  );
}
/** Searchable originals library; locales and subsequent pages load on demand. */
export function AllTutorials({ title = "All tutorials" }: { title?: string }) {
  const [q, setQ] = useState("");
  const [stage, setStage] = useState("");
  const [channelId, setChannel] = useState("");
  const [producerId, setProducer] = useState("");
  const [sort, setSort] = useState("newest");
  const [data, setData] = useState<LibraryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [moreLoading, setMoreLoading] = useState(false);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [locales, setLocales] = useState<Record<string, Locales>>({});
  const viewport = useRef<HTMLDivElement>(null);
  const generation = useRef(0);
  const requests = useRef<Set<AbortController>>(new Set());
  const params = useMemo(
    () =>
      new URLSearchParams({
        q,
        stage,
        sort,
        ...(channelId ? { channelId } : {}),
        ...(producerId ? { producerId } : {}),
      }).toString(),
    [q, stage, sort, channelId, producerId],
  );
  useEffect(() => {
    const current = ++generation.current;
    for (const request of requests.current) request.abort();
    requests.current.clear();
    const controller = new AbortController();
    requests.current.add(controller);
    setLoading(true);
    setMoreLoading(false);
    setError("");
    setExpanded(new Set());
    setLocales({});
    setData((previous) =>
      previous ? { ...previous, rows: [], total: 0, nextCursor: null } : null,
    );
    const timer = setTimeout(() => {
      void fetch(`/api/production/tutorial-library?${params}`, {
        signal: controller.signal,
      })
        .then(async (response) => {
          const result = await response.json();
          if (!response.ok)
            throw Error(result.error || "Could not load tutorials");
          if (generation.current === current) {
            setData(result);
            viewport.current?.scrollTo({ top: 0 });
          }
        })
        .catch((cause) => {
          if (!controller.signal.aborted)
            setError(
              cause instanceof Error
                ? cause.message
                : "Could not load tutorials",
            );
        })
        .finally(() => {
          requests.current.delete(controller);
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [params, refresh]);
  useEffect(
    () => () => {
      for (const request of requests.current) request.abort();
    },
    [],
  );
  async function loadMore() {
    if (!data?.nextCursor || loading || moreLoading) return;
    setMoreLoading(true);
    setError("");
    const current = generation.current;
    const controller = new AbortController();
    requests.current.add(controller);
    try {
      const response = await fetch(
        `/api/production/tutorial-library?${params}&${new URLSearchParams(data.nextCursor)}`,
        { signal: controller.signal },
      );
      const result: LibraryData = await response.json();
      if (!response.ok)
        throw Error("Could not load the next page. Retry below.");
      if (current !== generation.current) return;
      setData((previous) => ({
        ...result,
        rows:
          previous && previous.rows.length < 250
            ? [
                ...previous.rows,
                ...result.rows.filter(
                  (row) => !previous.rows.some((old) => old.id === row.id),
                ),
              ]
            : result.rows,
      }));
      if (data.rows.length >= 250) {
        setExpanded(new Set());
        setLocales({});
        viewport.current?.scrollTo({ top: 0 });
      }
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(
          cause instanceof Error
            ? cause.message
            : "Could not load more tutorials",
        );
    } finally {
      requests.current.delete(controller);
      if (current === generation.current) setMoreLoading(false);
    }
  }
  const loadLocales = useCallback(async (id: string, cursor: Cursor = null) => {
    const current = generation.current;
    const controller = new AbortController();
    requests.current.add(controller);
    setLocales((previous) => ({
      ...previous,
      [id]: {
        rows: previous[id]?.rows ?? [],
        nextCursor: cursor,
        loading: true,
        error: "",
      },
    }));
    try {
      const response = await fetch(
        `/api/production/tutorial-library?${new URLSearchParams({ parentId: id, ...cursor })}`,
        { signal: controller.signal },
      );
      const result = await response.json();
      if (!response.ok)
        throw Error(result.error || "Could not load language versions");
      if (current !== generation.current) return;
      setLocales((previous) => ({
        ...previous,
        [id]: {
          rows: cursor
            ? [...(previous[id]?.rows ?? []), ...result.rows]
            : result.rows,
          nextCursor: result.nextCursor,
          loading: false,
          error: "",
        },
      }));
    } catch (cause) {
      if (!controller.signal.aborted && current === generation.current)
        setLocales((previous) => ({
          ...previous,
          [id]: {
            rows: previous[id]?.rows ?? [],
            nextCursor: cursor,
            loading: false,
            error:
              cause instanceof Error
                ? cause.message
                : "Could not load language versions",
          },
        }));
    } finally {
      requests.current.delete(controller);
    }
  }, []);
  function toggle(record: LibraryRecord) {
    setExpanded((previous) => {
      const next = new Set(previous);
      next.has(record.id) ? next.delete(record.id) : next.add(record.id);
      return next;
    });
    if (!expanded.has(record.id) && !locales[record.id])
      void loadLocales(record.id);
  }
  type Row =
    | { kind: "record"; record: LibraryRecord; child: boolean }
    | { kind: "locales"; parent: LibraryRecord; state: Locales | undefined };
  const rows = useMemo<Row[]>(
    () =>
      data?.rows.flatMap((record) => {
        const result: Row[] = [{ kind: "record", record, child: false }];
        if (expanded.has(record.id)) {
          const state = locales[record.id];
          result.push(
            ...(state?.rows ?? []).map((child) => ({
              kind: "record" as const,
              record: child,
              child: true,
            })),
          );
          if (
            !state ||
            state.loading ||
            state.error ||
            state.nextCursor ||
            !state.rows.length
          )
            result.push({ kind: "locales", parent: record, state });
        }
        return result;
      }) ?? [],
    [data, expanded, locales],
  );
  const virtual = useVirtualizer({
    count: loading ? 0 : rows.length,
    getScrollElement: () => viewport.current,
    estimateSize: () => 96,
    overscan: 6,
    getItemKey: (index) => {
      const row = rows[index]!;
      return row.kind === "record" ? row.record.id : `locales:${row.parent.id}`;
    },
  });
  const filtered = Boolean(q || stage || channelId || producerId);
  return (
    <section className={styles.library} aria-label="All tutorials library">
      {title && <div className={styles.heading}><h2>{title}</h2></div>}
      <div className={styles.filters}>
        <label className={`${styles.field} ${styles.search}`}>
          Search tutorials
          <input
            className={styles.control}
            type="search"
            value={q}
            onChange={(event) => setQ(event.target.value)}
            placeholder="Title, keyword, channel or producer"
            maxLength={200}
          />
        </label>
        <label className={styles.field}>
          Channel
          <select
            className={styles.control}
            value={channelId}
            onChange={(event) => setChannel(event.target.value)}
          >
            <option value="">All channels</option>
            {data?.channels.map((channel) => (
              <option key={channel.id} value={channel.id}>
                {channel.name}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          Original stage
          <select
            className={styles.control}
            value={stage}
            onChange={(event) => setStage(event.target.value)}
          >
            <option value="">All stages</option>
            {LIBRARY_STAGES.map((value) => (
              <option key={value} value={value}>
                {label(value)}
              </option>
            ))}
          </select>
        </label>
        {data?.canFilterProducer && (
          <label className={styles.field}>
            Producer
            <select
              className={styles.control}
              value={producerId}
              onChange={(event) => setProducer(event.target.value)}
            >
              <option value="">All producers</option>
              {data.producers.map((producer) => (
                <option key={producer.id} value={producer.id}>
                  {producer.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className={styles.field}>
          Order
          <select
            className={styles.control}
            value={sort}
            onChange={(event) => setSort(event.target.value)}
          >
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
          </select>
        </label>
      </div>
      <div className={styles.summary}>
        <span className={styles.muted} role="status" aria-live="polite">
          {loading
            ? "Searching tutorials…"
            : `${data?.total.toLocaleString() ?? 0} originals · ${data?.scope ?? "Authorized work"}`}
        </span>
        <button
          className={styles.button}
          type="button"
          disabled={loading}
          onClick={() => setRefresh((value) => value + 1)}
        >
          Refresh library
        </button>
        {filtered && (
          <button
            className={styles.button}
            type="button"
            onClick={() => {
              setQ("");
              setStage("");
              setChannel("");
              setProducer("");
            }}
          >
            Clear filters
          </button>
        )}
      </div>
      {error && (
        <div role="alert" className={`${styles.message} ${styles.error}`}>
          {error}{" "}
          <button
            className={styles.button}
            type="button"
            onClick={() =>
              data?.nextCursor
                ? void loadMore()
                : setRefresh((value) => value + 1)
            }
          >
            Retry
          </button>
        </div>
      )}
      <div
        ref={viewport}
        className={styles.viewport}
        tabIndex={0}
        aria-label="Scrollable tutorial records"
        aria-busy={loading}
      >
        <table
          className={styles.table}
          aria-label="Tutorials and language versions"
          aria-rowcount={-1}
        >
          <thead className={styles.thead}>
            <tr className={styles.row}>
              <th>
                <span className={styles.muted} aria-label="Expand versions">
                  ↳
                </span>
              </th>
              <th className={styles.preview}>Preview</th>
              <th aria-sort={sort === "newest" ? "descending" : "ascending"}>
                Tutorial / created
              </th>
              <th>Stage</th>
              <th className={styles.channel}>Channel / producer</th>
              <th className={styles.voice}>Voice / provider</th>
              <th className={styles.duration}>Length</th>
              <th className={styles.actionsCell}>Open</th>
            </tr>
          </thead>
          <tbody
            style={{
              height: virtual.getTotalSize(),
              position: "relative",
              display: "grid",
            }}
          >
            {virtual.getVirtualItems().map((item) => {
              const row = rows[item.index]!;
              return (
                <tr
                  key={item.key}
                  ref={virtual.measureElement}
                  data-index={item.index}
                  className={`${styles.row} ${styles.item} ${row.kind === "record" && row.child ? styles.locale : ""}`}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    transform: `translateY(${item.start}px)`,
                  }}
                >
                  {row.kind === "locales" ? (
                    <td className={styles.wideMessage} colSpan={8}>
                      {row.state?.error ? (
                        <span role="alert">
                          {row.state.error}{" "}
                          <button
                            className={styles.button}
                            onClick={() =>
                              void loadLocales(
                                row.parent.id,
                                row.state?.nextCursor ?? null,
                              )
                            }
                          >
                            Retry languages
                          </button>
                        </span>
                      ) : row.state?.loading || !row.state ? (
                        <span role="status">Loading language versions…</span>
                      ) : row.state.nextCursor ? (
                        <button
                          className={styles.button}
                          onClick={() =>
                            void loadLocales(
                              row.parent.id,
                              row.state!.nextCursor,
                            )
                          }
                        >
                          Load more language versions
                        </button>
                      ) : (
                        <span className={styles.muted}>
                          No runtime language versions yet. Archived legacy
                          translations remain in migration history.
                        </span>
                      )}
                    </td>
                  ) : (
                    <>
                      <td>
                        {row.child ? (
                          <span
                            aria-label="Language version"
                            className={styles.muted}
                          >
                            ↳
                          </span>
                        ) : (
                          <button
                            className={styles.toggle}
                            type="button"
                            aria-expanded={expanded.has(row.record.id)}
                            aria-label={`${expanded.has(row.record.id) ? "Collapse" : "Expand"} language versions for ${row.record.title}`}
                            onClick={() => toggle(row.record)}
                          >
                            <svg
                              width="16"
                              height="16"
                              viewBox="0 0 16 16"
                              aria-hidden="true"
                              style={{
                                transform: expanded.has(row.record.id)
                                  ? "rotate(90deg)"
                                  : undefined,
                              }}
                            >
                              <path
                                d="m6 3 5 5-5 5"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="1.5"
                              />
                            </svg>
                          </button>
                        )}
                      </td>
                      <td className={styles.preview}>
                        <Thumbnail record={row.record} />
                      </td>
                      <td>
                        <a
                          className={`${styles.title} ${styles.link}`}
                          href={`/tutorial-studio?tab=studio&jobId=${row.record.sourceId ?? row.record.id}`}
                        >
                          {row.record.title}
                        </a>
                        <div className={styles.muted}>
                          {row.record.language?.toUpperCase() ??
                            "Language unknown"}
                          {!row.child
                            ? ` · ${row.record.localeCount} versions`
                            : " · Translation"}{" "}
                          ·{" "}
                          {new Date(row.record.createdAt).toLocaleDateString()}
                        </div>
                        <div className={styles.muted}>
                          {["rework_requested", "disapproved"].includes(row.record.review ?? "")
                            ? "Changes requested"
                            : row.record.review === "approved"
                              ? "Review approved (delivery tracked separately)"
                              : row.record.status === "COMPLETED" ? "Awaiting review" : null}
                        </div>
                        <MobileRecord record={row.record} onChannel={setChannel} onProducer={data?.canFilterProducer ? setProducer : undefined} />
                      </td>
                      <td>
                        <span className={styles.status} data-tone={libraryStageTone(row.record.status)}>
                          {label(row.record.status)}
                        </span>
                      </td>
                      <td className={styles.channel}>
                        <div>{row.record.channelId ? <button type="button" className={styles.filterLink} onClick={() => setChannel(row.record.channelId!)} aria-label={`Filter tutorials by channel ${row.record.channel}`}>{row.record.channel ?? "Channel"}</button> : "Needs routing"}</div>
                        <div className={styles.muted}>
                          {data?.canFilterProducer && row.record.producerId ? <button type="button" className={styles.filterLink} onClick={() => setProducer(row.record.producerId!)} aria-label={`Filter tutorials by producer ${row.record.producer}`}>{row.record.producer ?? "Producer"}</button> : row.record.producer ?? "Unknown producer"}
                        </div>
                      </td>
                      <td className={styles.voice}>
                        <div style={{ overflowWrap: "anywhere" }}>
                          {row.record.voice || "Not selected"}
                        </div>
                        <div className={styles.muted}>
                          {row.record.provider || "Unknown provider"}
                        </div>
                      </td>
                      <td className={`${styles.duration} ${styles.number}`}>
                        {libraryDuration(row.record.duration)}
                        <div className={styles.muted}>
                          {row.record.durationKind ?? ""}
                        </div>
                      </td>
                      <td className={styles.actionsCell}>
                        <div className={styles.actions}>
                          {row.record.hasVideo && (
                            <a
                              className={styles.link}
                              href={`/api/production/jobs/${row.record.id}/download?inline=1`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              Video
                            </a>
                          )}
                          {row.record.youtubeUrl && (
                            <>
                              <a
                                className={styles.link}
                                href={row.record.youtubeUrl}
                                target="_blank"
                                rel="noreferrer"
                              >
                                YouTube
                              </a>
                              <a
                                className={styles.link}
                                href={row.record.youtubeStudioUrl!}
                                target="_blank"
                                rel="noreferrer"
                              >
                                YT Studio
                              </a>
                              <span className={styles.muted}>
                                {row.record.youtubeVerified
                                  ? "✓ Upload verified"
                                  : "Reported · unverified"}
                              </span>
                            </>
                          )}
                        </div>
                      </td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
        {loading ? (
          <div className={styles.message} role="status">
            Loading your tutorial library…
          </div>
        ) : !data?.rows.length && !error ? (
          <div className={styles.message}>
            No tutorials match these filters. Clear the search or choose another
            stage.
          </div>
        ) : null}
      </div>
      <div className={styles.footer}>
        {data?.nextCursor && (
          <button
            className={styles.button}
            disabled={loading || moreLoading}
            type="button"
            onClick={() => void loadMore()}
          >
            {moreLoading
              ? "Loading…"
              : data.rows.length >= 250
                ? "Continue to next results"
                : "Load 25 more originals"}
          </button>
        )}
        <span className={styles.muted}>
          {data?.rows.length ?? 0} originals loaded. Language versions load only
          when expanded. Historical unmapped work stays in migration history.
        </span>
      </div>
    </section>
  );
}

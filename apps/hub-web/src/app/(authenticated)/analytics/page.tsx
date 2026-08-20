import { redirect } from "next/navigation";
import { getSession } from "../_lib/v2-auth";
import { GlassCard } from "../_components/glass-card";
import { hasPermission } from "@/lib/auth/rbac";

/**
 * Analytics — under construction.
 *
 * The previous version of this page rendered KPI tiles, a velocity chart, a
 * bottleneck chart, an error breakdown and a format comparison table. The
 * queries behind them are real (see `lib/repositories/analytics-repository.ts`)
 * but the surface was read-only, uninterpretable at current production volume,
 * and gave a false impression that analytics were "done". It has been replaced
 * with an honest placeholder until there is enough production history — and a
 * clear decision on what to measure — to build something worth looking at.
 *
 * Nothing was deleted: `analytics-repository.ts` and the chart components in
 * `components/analytics/` are intact and ready to be re-wired.
 *
 * `/analytics/render` IS real and stays live — it reports actual render worker
 * timings from the jobs table. It is linked below.
 */

const PLANNED = [
  {
    icon: "speed",
    title: "Throughput & lead time",
    body: "Jobs finished per day per format, and how long creation → published actually takes.",
  },
  {
    icon: "warning",
    title: "Failure intelligence",
    body: "Which stage breaks, which provider caused it, and whether a fallback was silently used.",
  },
  {
    icon: "trending_up",
    title: "Channel performance",
    body: "Views, retention and CTR per published video — needs the distribution engine first.",
  },
  {
    icon: "payments",
    title: "Cost per video",
    body: "TTS, image, video and render spend attributed back to each job.",
  },
];

export default async function AnalyticsPage() {
  const session = await getSession();

  if (!hasPermission(session, "view:analytics")) {
    redirect("/dashboard");
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {/* Header */}
      <div>
        <h1
          style={{
            fontSize: 20,
            fontWeight: 800,
            color: "#e5e2e1",
            margin: 0,
            marginBottom: 4,
          }}
        >
          Analytics
        </h1>
        <p style={{ fontSize: 12, color: "#cdc3d7", margin: 0 }}>
          Production and channel performance reporting
        </p>
      </div>

      {/* Under construction banner */}
      <GlassCard
        style={{
          padding: 40,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          textAlign: "center",
          gap: 14,
          border: "1px solid rgba(var(--v2-accent-rgb), 0.25)",
          background:
            "linear-gradient(180deg, rgba(var(--v2-accent-rgb), 0.06), rgba(255,255,255,0.03))",
        }}
      >
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: 14,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(var(--v2-accent-rgb), 0.12)",
            border: "1px solid rgba(var(--v2-accent-rgb), 0.25)",
          }}
        >
          <span
            className="material-symbols-outlined"
            style={{ fontSize: 28, color: "var(--v2-accent)" }}
          >
            construction
          </span>
        </div>

        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.18em",
            color: "var(--v2-accent)",
          }}
        >
          Being worked on
        </span>

        <h2
          style={{
            fontSize: 22,
            fontWeight: 800,
            color: "#e5e2e1",
            margin: 0,
            maxWidth: 560,
          }}
        >
          Analytics is under construction
        </h2>

        <p
          style={{
            fontSize: 13,
            color: "#cdc3d7",
            margin: 0,
            maxWidth: 560,
            lineHeight: 1.6,
          }}
        >
          The old dashboard here showed numbers that could not be acted on and
          were not meaningful at current production volume. Rather than leave a
          convincing-looking mock-up in place, it has been taken down. This page
          will come back once there is real production history to measure and a
          distribution engine to measure it against.
        </p>

        <a
          href="/analytics/render"
          style={{
            marginTop: 6,
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            padding: "10px 18px",
            borderRadius: 10,
            fontSize: 11,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.1em",
            textDecoration: "none",
            color: "var(--v2-accent)",
            background: "rgba(var(--v2-accent-rgb), 0.10)",
            border: "1px solid rgba(var(--v2-accent-rgb), 0.25)",
          }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
            memory
          </span>
          Render metrics (live)
        </a>
        <span style={{ fontSize: 10, color: "rgba(205,195,215,0.45)" }}>
          Render performance reports real worker timings and is still working.
        </span>
      </GlassCard>

      {/* What is planned — stated plainly so the page is honest, not empty */}
      <div>
        <h3
          style={{
            fontSize: 10,
            fontWeight: 700,
            color: "#cdc3d7",
            textTransform: "uppercase",
            letterSpacing: "0.12em",
            margin: "0 0 12px 0",
          }}
        >
          Planned
        </h3>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
            gap: 16,
          }}
        >
          {PLANNED.map((item) => (
            <GlassCard
              key={item.title}
              style={{
                padding: 18,
                display: "flex",
                flexDirection: "column",
                gap: 8,
                opacity: 0.75,
              }}
            >
              <span
                className="material-symbols-outlined"
                style={{ fontSize: 20, color: "var(--v2-accent)" }}
              >
                {item.icon}
              </span>
              <h4
                style={{
                  fontSize: 13,
                  fontWeight: 700,
                  color: "#e5e2e1",
                  margin: 0,
                }}
              >
                {item.title}
              </h4>
              <p
                style={{
                  fontSize: 11,
                  color: "#cdc3d7",
                  margin: 0,
                  lineHeight: 1.55,
                }}
              >
                {item.body}
              </p>
            </GlassCard>
          ))}
        </div>
      </div>
    </div>
  );
}

import { redirect } from "next/navigation";
import { getSession } from "../_lib/v2-auth";
import { GlassCard } from "../_components/glass-card";
import { getHubConfig } from "@/lib/config";
import { AI33TasksClient, type AI33TaskItem } from "./ai33-tasks-client";

const AI33_BASE_URL = "https://api.ai33.pro";

type AI33ServiceStatus = "good" | "degraded" | "overloaded";

const STATUS_DOT: Record<AI33ServiceStatus, string> = {
  good: "#23decb",
  degraded: "#f97316",
  overloaded: "#ffb4ab",
};

async function fetchHealth(apiKey: string) {
  const res = await fetch(`${AI33_BASE_URL}/v1/health-check`, {
    headers: { "Content-Type": "application/json", "xi-api-key": apiKey },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Health check failed: ${res.status}`);
  const data = (await res.json()) as {
    success: boolean;
    data: { elevenlabs: AI33ServiceStatus; minimax: AI33ServiceStatus };
  };
  return data.data;
}

async function fetchCredits(apiKey: string) {
  const res = await fetch(`${AI33_BASE_URL}/v1/credits`, {
    headers: { "Content-Type": "application/json", "xi-api-key": apiKey },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Credits failed: ${res.status}`);
  const data = (await res.json()) as { success: boolean; credits: number };
  return data.credits;
}

async function fetchTasks(apiKey: string): Promise<AI33TaskItem[]> {
  const res = await fetch(`${AI33_BASE_URL}/v1/tasks?page=1&limit=50`, {
    headers: { "Content-Type": "application/json", "xi-api-key": apiKey },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`List tasks failed: ${res.status}`);
  const data = (await res.json()) as {
    success: boolean;
    data: AI33TaskItem[];
    total: number;
  };
  return data.data;
}

export default async function AI33Page() {
  const session = await getSession();
  if (!session) redirect("/login");

  const config = getHubConfig();
  const apiKey = config.AI33_API_KEY;

  const [healthResult, creditsResult, tasksResult] = await Promise.allSettled([
    fetchHealth(apiKey),
    fetchCredits(apiKey),
    fetchTasks(apiKey),
  ]);

  const health =
    healthResult.status === "fulfilled" ? healthResult.value : null;
  const credits =
    creditsResult.status === "fulfilled" ? creditsResult.value : null;
  const tasks = tasksResult.status === "fulfilled" ? tasksResult.value : [];
  const fetchError =
    healthResult.status === "rejected" ? String(healthResult.reason) : null;

  const doingCount = tasks.filter((t) => t.status === "doing").length;
  const errorCount = tasks.filter((t) => t.status === "error").length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
        }}
      >
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
            AI33 Management
          </h1>
          <p style={{ fontSize: 12, color: "#cdc3d7", margin: 0 }}>
            Provider health, credit balance, and task lifecycle
          </p>
        </div>
        <div style={{ display: "flex", gap: 12 }}>
          {doingCount > 0 && (
            <div
              style={{
                padding: "6px 14px",
                background: "rgba(var(--v2-accent-rgb), 0.1)",
                border: "1px solid rgba(var(--v2-accent-rgb), 0.25)",
                borderRadius: 20,
              }}
            >
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  color: "var(--v2-accent)",
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                }}
              >
                {doingCount} Running
              </span>
            </div>
          )}
          {errorCount > 0 && (
            <div
              style={{
                padding: "6px 14px",
                background: "rgba(255,180,171,0.1)",
                border: "1px solid rgba(255,180,171,0.3)",
                borderRadius: 20,
              }}
            >
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  color: "#ffb4ab",
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                }}
              >
                {errorCount} Errors
              </span>
            </div>
          )}
        </div>
      </div>

      {/* API unreachable banner */}
      {fetchError && (
        <GlassCard
          style={{
            padding: "16px 24px",
            border: "1px solid rgba(255,180,171,0.25)",
            background: "rgba(255,180,171,0.04)",
          }}
        >
          <p style={{ fontSize: 12, color: "#ffb4ab", margin: 0 }}>
            Could not reach AI33 API: {fetchError}
          </p>
        </GlassCard>
      )}

      {/* Health + Credits row */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr",
          gap: 16,
        }}
      >
        {/* Minimax health */}
        <GlassCard
          style={{
            padding: 20,
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              color: "#cdc3d7",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
            }}
          >
            Minimax (TTS)
          </span>
          {health ? (
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: "50%",
                  background: STATUS_DOT[health.minimax],
                  boxShadow: `0 0 8px ${STATUS_DOT[health.minimax]}88`,
                  flexShrink: 0,
                }}
              />
              <span
                style={{
                  fontSize: 18,
                  fontWeight: 900,
                  color: STATUS_DOT[health.minimax],
                  textTransform: "capitalize",
                }}
              >
                {health.minimax}
              </span>
            </div>
          ) : (
            <span style={{ fontSize: 14, color: "rgba(205,195,215,0.4)" }}>
              —
            </span>
          )}
        </GlassCard>

        {/* ElevenLabs health */}
        <GlassCard
          style={{
            padding: 20,
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              color: "#cdc3d7",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
            }}
          >
            ElevenLabs
          </span>
          {health ? (
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: "50%",
                  background: STATUS_DOT[health.elevenlabs],
                  boxShadow: `0 0 8px ${STATUS_DOT[health.elevenlabs]}88`,
                  flexShrink: 0,
                }}
              />
              <span
                style={{
                  fontSize: 18,
                  fontWeight: 900,
                  color: STATUS_DOT[health.elevenlabs],
                  textTransform: "capitalize",
                }}
              >
                {health.elevenlabs}
              </span>
            </div>
          ) : (
            <span style={{ fontSize: 14, color: "rgba(205,195,215,0.4)" }}>
              —
            </span>
          )}
        </GlassCard>

        {/* Credits */}
        <GlassCard
          style={{
            padding: 20,
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              color: "#cdc3d7",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
            }}
          >
            Credits
          </span>
          {credits !== null ? (
            <span
              style={{
                fontSize: 28,
                fontWeight: 900,
                color: credits < 100 ? "#ffb4ab" : "#e5e2e1",
              }}
            >
              {credits.toLocaleString()}
            </span>
          ) : (
            <span style={{ fontSize: 14, color: "rgba(205,195,215,0.4)" }}>
              —
            </span>
          )}
        </GlassCard>
      </div>

      {/* Task list */}
      <GlassCard style={{ overflow: "hidden" }}>
        <div
          style={{
            padding: "16px 24px",
            borderBottom: "1px solid rgba(var(--v2-accent-rgb), 0.1)",
            background: "#131313",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div>
            <h3
              style={{
                fontSize: 12,
                fontWeight: 700,
                color: "#e5e2e1",
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                margin: 0,
              }}
            >
              Recent Tasks
            </h3>
            <p
              style={{
                fontSize: 10,
                color: "rgba(205,195,215,0.4)",
                marginTop: 4,
                marginBottom: 0,
              }}
            >
              Last 50 tasks · select and delete to reclaim credits
            </p>
          </div>
          <span style={{ fontSize: 10, color: "rgba(205,195,215,0.4)" }}>
            {tasks.length} tasks
          </span>
        </div>
        <AI33TasksClient initialTasks={tasks} />
      </GlassCard>
    </div>
  );
}

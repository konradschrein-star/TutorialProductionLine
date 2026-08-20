"use client";

import { useState } from "react";

export interface AI33TaskItem {
  id: string;
  created_at: string;
  status: "doing" | "done" | "error";
  error_message: string | null;
  credit_cost: number;
  type: string;
  progress: number;
}

const STATUS_COLOR: Record<string, string> = {
  done: "#23decb",
  doing: "var(--v2-accent)",
  error: "#ffb4ab",
};

export function AI33TasksClient({
  initialTasks,
}: {
  initialTasks: AI33TaskItem[];
}) {
  const [tasks, setTasks] = useState<AI33TaskItem[]>(initialTasks);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(
    null,
  );

  function toggleAll() {
    if (selected.size === tasks.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(tasks.map((t) => t.id)));
    }
  }

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleDelete() {
    if (selected.size === 0 || deleting) return;
    setDeleting(true);
    setMessage(null);
    try {
      const res = await fetch("/api/ai33/tasks", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task_ids: Array.from(selected) }),
      });
      const data = (await res.json()) as {
        refund_credits?: number;
        error?: string;
      };
      if (!res.ok) {
        setMessage({
          text: `Error: ${data.error ?? "Unknown error"}`,
          ok: false,
        });
      } else {
        const count = selected.size;
        setTasks((prev) => prev.filter((t) => !selected.has(t.id)));
        setSelected(new Set());
        setMessage({
          text: `Deleted ${count} task(s) · Refund: ${data.refund_credits ?? 0} credits`,
          ok: true,
        });
      }
    } catch (err) {
      setMessage({
        text: `Error: ${err instanceof Error ? err.message : String(err)}`,
        ok: false,
      });
    } finally {
      setDeleting(false);
    }
  }

  if (tasks.length === 0) {
    return (
      <div
        style={{
          padding: "32px 24px",
          textAlign: "center",
          color: "rgba(205,195,215,0.4)",
          fontSize: 12,
        }}
      >
        No tasks found — all clear.
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      {/* Toolbar */}
      <div
        style={{
          padding: "12px 24px",
          display: "flex",
          alignItems: "center",
          gap: 16,
          borderBottom: "1px solid rgba(var(--v2-accent-rgb), 0.08)",
        }}
      >
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            cursor: "pointer",
          }}
        >
          <input
            type="checkbox"
            checked={selected.size === tasks.length && tasks.length > 0}
            onChange={toggleAll}
            style={{ accentColor: "var(--v2-accent)" }}
          />
          <span style={{ fontSize: 11, color: "#cdc3d7" }}>
            {selected.size === 0 ? "Select all" : `${selected.size} selected`}
          </span>
        </label>

        <button
          onClick={handleDelete}
          disabled={selected.size === 0 || deleting}
          style={{
            padding: "6px 14px",
            background:
              selected.size === 0
                ? "rgba(255,180,171,0.04)"
                : "rgba(255,180,171,0.1)",
            border: "1px solid rgba(255,180,171,0.25)",
            borderRadius: 6,
            color: selected.size === 0 ? "rgba(255,180,171,0.3)" : "#ffb4ab",
            fontSize: 11,
            fontWeight: 700,
            cursor: selected.size === 0 || deleting ? "not-allowed" : "pointer",
            textTransform: "uppercase",
            letterSpacing: "0.06em",
          }}
        >
          {deleting
            ? "Deleting…"
            : `Delete${selected.size > 0 ? ` ${selected.size}` : ""} selected`}
        </button>

        {message && (
          <span
            style={{
              fontSize: 11,
              color: message.ok ? "#23decb" : "#ffb4ab",
            }}
          >
            {message.text}
          </span>
        )}
      </div>

      {/* Task rows */}
      {tasks.map((task, i) => (
        <label
          key={task.id}
          style={{
            padding: "14px 24px",
            display: "flex",
            alignItems: "center",
            gap: 16,
            borderBottom:
              i < tasks.length - 1 ? "1px solid rgba(75,68,85,0.12)" : "none",
            cursor: "pointer",
            background: selected.has(task.id)
              ? "rgba(var(--v2-accent-rgb), 0.04)"
              : "transparent",
          }}
        >
          <input
            type="checkbox"
            checked={selected.has(task.id)}
            onChange={() => toggleOne(task.id)}
            style={{ accentColor: "var(--v2-accent)", flexShrink: 0 }}
          />

          {/* Status badge */}
          <span
            style={{
              fontSize: 9,
              fontWeight: 700,
              color: STATUS_COLOR[task.status] ?? "#cdc3d7",
              background: `${STATUS_COLOR[task.status] ?? "#cdc3d7"}18`,
              border: `1px solid ${STATUS_COLOR[task.status] ?? "#cdc3d7"}40`,
              padding: "3px 8px",
              borderRadius: 4,
              textTransform: "uppercase",
              letterSpacing: "0.04em",
              flexShrink: 0,
            }}
          >
            {task.status}
          </span>

          {/* Type */}
          <span
            style={{
              fontSize: 10,
              color: "#cdc3d7",
              width: 80,
              flexShrink: 0,
            }}
          >
            {task.type}
          </span>

          {/* ID */}
          <span
            style={{
              fontSize: 10,
              color: "rgba(205,195,215,0.5)",
              fontFamily: "monospace",
              flexShrink: 0,
            }}
          >
            {task.id.slice(0, 12)}…
          </span>

          {/* Progress bar (only when doing) */}
          {task.status === "doing" && (
            <div
              style={{
                flex: 1,
                height: 3,
                background: "#0e0e0e",
                borderRadius: 9999,
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  height: "100%",
                  width: `${task.progress}%`,
                  background: "var(--v2-accent)",
                  borderRadius: 9999,
                }}
              />
            </div>
          )}

          {/* Error message */}
          {task.status === "error" && task.error_message && (
            <span
              style={{
                flex: 1,
                fontSize: 10,
                color: "rgba(255,180,171,0.7)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {task.error_message}
            </span>
          )}

          {task.status === "done" && <div style={{ flex: 1 }} />}

          {/* Credits + date */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "flex-end",
              gap: 2,
              flexShrink: 0,
            }}
          >
            {task.credit_cost > 0 && (
              <span style={{ fontSize: 9, color: "rgba(205,195,215,0.4)" }}>
                {task.credit_cost} cr
              </span>
            )}
            <span
              style={{
                fontSize: 9,
                color: "rgba(205,195,215,0.3)",
                fontFamily: "monospace",
              }}
            >
              {new Date(task.created_at)
                .toISOString()
                .replace("T", " ")
                .slice(0, 16)}
            </span>
          </div>
        </label>
      ))}
    </div>
  );
}

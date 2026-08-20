"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { getNextVAReviewJob } from "@/app/actions/jobs";

/**
 * "Start next" for the B-Roll Selection Studio worklist.
 *
 * Asks the server for the oldest job nobody else has claimed, claims it for
 * this VA, and opens the studio. Two VAs pressing this at the same moment get
 * two different jobs.
 */
export function StartNextButton({ disabled }: { disabled?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function start() {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const { jobId } = await getNextVAReviewJob();
      if (jobId) {
        router.push(`/jobs/${jobId}/va-review`);
        return;
      }
      setMessage(
        "Nothing free right now — every job in this queue is taken or the queue is empty.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      {message && (
        <span style={{ fontSize: 11, color: "#ffb15c" }}>{message}</span>
      )}
      <button
        onClick={start}
        disabled={busy || disabled}
        className="v2-btn-accent"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          opacity: busy || disabled ? 0.5 : 1,
          cursor: busy || disabled ? "not-allowed" : "pointer",
        }}
      >
        <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
          {busy ? "progress_activity" : "play_arrow"}
        </span>
        {busy ? "Finding a job…" : "Start next"}
      </button>
    </div>
  );
}

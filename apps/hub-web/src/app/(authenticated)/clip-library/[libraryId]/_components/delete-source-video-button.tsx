"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Props {
  libraryId: string;
  videoId: string;
}

export function DeleteSourceVideoButton({ libraryId, videoId }: Props) {
  const [deleting, setDeleting] = useState(false);
  const router = useRouter();

  async function handleClick() {
    if (
      !confirm(
        "Delete this source video and all its clips? This cannot be undone.",
      )
    )
      return;
    setDeleting(true);
    try {
      const res = await fetch(
        `/api/clip-library/${libraryId}/source-videos/${videoId}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        alert(d.error ?? `Delete failed (HTTP ${res.status})`);
        return;
      }
      router.refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <button
      onClick={() => void handleClick()}
      disabled={deleting}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "5px 10px",
        borderRadius: 6,
        fontSize: 11,
        fontWeight: 600,
        background: "rgba(255,80,80,0.08)",
        color: "#ff5050",
        border: "1px solid rgba(255,80,80,0.2)",
        textTransform: "uppercase",
        letterSpacing: "0.04em",
        cursor: deleting ? "not-allowed" : "pointer",
        opacity: deleting ? 0.5 : 1,
      }}
    >
      <span className="material-symbols-outlined" style={{ fontSize: 13 }}>
        {deleting ? "hourglass_empty" : "delete"}
      </span>
      {deleting ? "Deleting…" : "Delete"}
    </button>
  );
}

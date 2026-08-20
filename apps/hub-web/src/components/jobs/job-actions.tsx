"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pause, Play, Trash2, Film, RotateCcw } from "lucide-react";
import Link from "next/link";
import { pauseJob, resumeJob, deleteJob, retryJob } from "@/app/actions/jobs";

/**
 * Job Actions Component
 *
 * Client-side buttons for job actions (pause, resume, delete, timeline editor).
 * Handles loading states and navigation after actions.
 */

interface JobActionsProps {
  jobId: string;
  status: string;
  canPause: boolean;
  canDelete: boolean;
  canRetry: boolean;
  usesRemotionRenderer: boolean;
}

export function JobActions({
  jobId,
  status,
  canPause,
  canDelete,
  canRetry,
  usesRemotionRenderer,
}: JobActionsProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handlePause() {
    setLoading(true);
    const result = await pauseJob(jobId);
    if (result.success) {
      router.refresh();
    } else {
      alert(result.error || "Failed to pause job");
    }
    setLoading(false);
  }

  async function handleResume() {
    setLoading(true);
    const result = await resumeJob(jobId);
    if (result.success) {
      router.refresh();
    } else {
      alert(result.error || "Failed to resume job");
    }
    setLoading(false);
  }

  async function handleRetry() {
    setLoading(true);
    const result = await retryJob(jobId);
    if (result.success) {
      router.refresh();
    } else {
      alert(result.error || "Failed to retry job");
    }
    setLoading(false);
  }

  async function handleDelete() {
    setLoading(true);
    const result = await deleteJob(jobId);
    if (result.success) {
      router.push("/jobs");
    } else {
      alert(result.error || "Failed to delete job");
      setLoading(false);
    }
  }

  return (
    <div className="flex items-center space-x-2">
      {/* Timeline Editor Button - ONLY for Remotion jobs */}
      {usesRemotionRenderer && (
        <Link
          href={`/jobs/${jobId}/timeline`}
          className="flex items-center space-x-2 px-4 py-2 bg-lime-500/10 hover:bg-lime-500/20 text-lime-400 border border-lime-500/25 rounded-lg transition-all"
          title="Advanced timeline editor for Remotion renders - edit scenes, adjust timing, regenerate assets"
        >
          <Film className="w-4 h-4" />
          <span>Timeline Editor</span>
        </Link>
      )}

      {canRetry &&
        status.startsWith("FAILED_") &&
        status !== "FAILED_IRRECOVERABLE" && (
          <button
            onClick={handleRetry}
            disabled={loading}
            className="flex items-center space-x-2 px-4 py-2 bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/25 rounded-lg transition-all disabled:opacity-50"
            title="Retry this failed job"
          >
            <RotateCcw className="w-4 h-4" />
            <span>Retry</span>
          </button>
        )}
      {canPause && status !== "PAUSED" && (
        <button
          onClick={handlePause}
          disabled={loading}
          className="flex items-center space-x-2 px-4 py-2 bg-surface-container hover:bg-surface-bright text-text rounded-lg transition-all disabled:opacity-50"
        >
          <Pause className="w-4 h-4" />
          <span>Pause</span>
        </button>
      )}
      {canPause && status === "PAUSED" && (
        <button
          onClick={handleResume}
          disabled={loading}
          className="flex items-center space-x-2 px-4 py-2 bg-primary hover:bg-primary/90 text-white rounded-lg transition-all disabled:opacity-50"
        >
          <Play className="w-4 h-4" />
          <span>Resume</span>
        </button>
      )}
      {canDelete && (
        <button
          onClick={handleDelete}
          disabled={loading}
          className="flex items-center space-x-2 px-4 py-2 bg-error/10 hover:bg-error/20 text-error rounded-lg transition-all disabled:opacity-50"
        >
          <Trash2 className="w-4 h-4" />
          <span>Delete</span>
        </button>
      )}
    </div>
  );
}

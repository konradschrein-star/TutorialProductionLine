"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import {
  Trash2,
  Pause,
  Eye,
  CheckSquare,
  Square,
  MinusSquare,
  ArrowRight,
  Users,
} from "lucide-react";
import { JobStatusBadge } from "./job-status-badge";
import { bulkDeleteJobs, bulkPauseJobs, deleteJob } from "@/app/actions/jobs";

const VA_QUEUE_STATUSES = [
  "AWAITING_PRODUCTION_VA",
  "AWAITING_IMAGE_QC",
  "AWAITING_QC",
  "AWAITING_UPLOADER",
];

export interface JobRow {
  id: string;
  title: string;
  status: string;
  format: string;
  created_at: string;
  updated_at: string;
  channel_name: string;
  template_name: string;
  error_message: string | null;
}

interface JobsTableProps {
  jobs: JobRow[];
  canDelete: boolean;
  canPause: boolean;
  activeStatusFilter?: string;
}

export function JobsTable({
  jobs,
  canDelete,
  canPause,
  activeStatusFilter,
}: JobsTableProps) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [acting, setActing] = useState(false);

  const allSelected = jobs.length > 0 && selected.size === jobs.length;
  const someSelected = selected.size > 0 && selected.size < jobs.length;

  const toggleAll = useCallback(() => {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(jobs.map((j) => j.id)));
    }
  }, [allSelected, jobs]);

  const toggleOne = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleBulkDelete = useCallback(async () => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    if (
      !confirm(
        `Delete ${ids.length} job${ids.length !== 1 ? "s" : ""}? This cannot be undone.`,
      )
    )
      return;

    setActing(true);
    const result = await bulkDeleteJobs(ids);
    if (result.success) {
      setSelected(new Set());
      router.refresh();
    } else {
      alert(result.error || "Failed to delete jobs");
    }
    setActing(false);
  }, [selected, router]);

  const handleRowDelete = useCallback(
    async (id: string) => {
      setActing(true);
      const result = await deleteJob(id);
      if (result.success) {
        router.refresh();
      } else {
        alert(result.error || "Failed to delete job");
      }
      setActing(false);
    },
    [router],
  );

  const handleBulkPause = useCallback(async () => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;

    setActing(true);
    const result = await bulkPauseJobs(ids);
    if (result.success) {
      setSelected(new Set());
      router.refresh();
    } else {
      alert(result.error || "Failed to pause jobs");
    }
    setActing(false);
  }, [selected, router]);

  const isVaQueue = activeStatusFilter === "__va_queue__";

  return (
    <div className="space-y-3">
      {/* VA Queue tab strip */}
      <div className="flex items-center gap-2 flex-wrap">
        <Link
          href="/jobs"
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
            !activeStatusFilter
              ? "bg-primary text-white"
              : "bg-surface-container text-text-muted hover:bg-surface-bright"
          }`}
        >
          All Jobs
        </Link>
        <Link
          href="/jobs?status=__va_queue__"
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
            isVaQueue
              ? "bg-warning/20 text-warning border border-warning/30"
              : "bg-surface-container text-text-muted hover:bg-surface-bright"
          }`}
        >
          <Users className="w-3 h-3" />
          VA Queue
        </Link>
        {[
          "AWAITING_PRODUCTION_VA",
          "AWAITING_IMAGE_QC",
          "AWAITING_QC",
          "AWAITING_UPLOADER",
        ].map((s) => (
          <Link
            key={s}
            href={`/jobs?status=${s}`}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              activeStatusFilter === s
                ? "bg-primary text-white"
                : "bg-surface-container text-text-muted hover:bg-surface-bright"
            }`}
          >
            {s.replace(/^AWAITING_/, "").replace(/_/g, " ")}
          </Link>
        ))}
      </div>

      <div className="glass rounded-lg border border-surface-bright overflow-hidden">
        {/* Bulk action bar */}
        {selected.size > 0 && (
          <div className="flex items-center gap-3 px-6 py-3 bg-primary/5 border-b border-surface-bright">
            <span className="text-sm text-text font-medium">
              {selected.size} selected
            </span>
            <div className="flex items-center gap-2 ml-auto">
              {canPause && (
                <button
                  onClick={handleBulkPause}
                  disabled={acting}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-surface-container hover:bg-surface-bright text-text rounded-md transition-colors disabled:opacity-50"
                >
                  <Pause className="w-3.5 h-3.5" />
                  Pause
                </button>
              )}
              {canDelete && (
                <button
                  onClick={handleBulkDelete}
                  disabled={acting}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-error/10 hover:bg-error/20 text-error rounded-md transition-colors disabled:opacity-50"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Delete
                </button>
              )}
              <button
                onClick={() => setSelected(new Set())}
                className="text-xs text-text-muted hover:text-text transition-colors ml-2"
              >
                Clear
              </button>
            </div>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-surface-container border-b border-surface-bright">
              <tr>
                <th className="px-4 py-3 w-10">
                  <button
                    onClick={toggleAll}
                    className="text-text-muted hover:text-text transition-colors"
                    aria-label={allSelected ? "Deselect all" : "Select all"}
                  >
                    {allSelected ? (
                      <CheckSquare className="w-4 h-4 text-primary" />
                    ) : someSelected ? (
                      <MinusSquare className="w-4 h-4 text-primary" />
                    ) : (
                      <Square className="w-4 h-4" />
                    )}
                  </button>
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wide">
                  Title
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wide">
                  Status
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wide">
                  Format
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wide">
                  Channel
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wide">
                  Template
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wide">
                  Created
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wide">
                  Updated
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wide">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-bright">
              {jobs.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-6 py-12 text-center">
                    <p className="text-text-muted">No jobs found</p>
                  </td>
                </tr>
              ) : (
                jobs.map((job) => (
                  <tr
                    key={job.id}
                    className={`hover:bg-surface-bright/30 transition-colors ${
                      selected.has(job.id) ? "bg-primary/5" : ""
                    }`}
                  >
                    <td className="px-4 py-3">
                      <button
                        onClick={() => toggleOne(job.id)}
                        className="text-text-muted hover:text-text transition-colors"
                      >
                        {selected.has(job.id) ? (
                          <CheckSquare className="w-4 h-4 text-primary" />
                        ) : (
                          <Square className="w-4 h-4" />
                        )}
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/jobs/${job.id}`}
                        className="text-sm font-medium text-text hover:text-primary transition-colors"
                      >
                        {job.title || "Untitled"}
                      </Link>
                      {job.error_message && (
                        <p className="text-xs text-error mt-0.5 truncate max-w-[200px]">
                          {job.error_message}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <JobStatusBadge status={job.status} />
                    </td>
                    <td className="px-4 py-3 text-sm text-text-muted whitespace-nowrap">
                      {job.format.replace(/_/g, " ")}
                    </td>
                    <td className="px-4 py-3 text-sm text-text">
                      {job.channel_name || "—"}
                    </td>
                    <td className="px-4 py-3 text-sm text-text-muted">
                      {job.template_name || "—"}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-text-muted">
                      {formatDistanceToNow(new Date(job.created_at), {
                        addSuffix: true,
                      })}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-text-muted">
                      {formatDistanceToNow(new Date(job.updated_at), {
                        addSuffix: true,
                      })}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        {job.status === "AWAITING_IMAGE_QC" && (
                          <Link
                            href={`/jobs/${job.id}/image-qc`}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium bg-warning/10 hover:bg-warning/20 text-warning rounded-md transition-colors"
                          >
                            Review
                            <ArrowRight className="w-3 h-3" />
                          </Link>
                        )}
                        {job.status === "AWAITING_QC" && (
                          <Link
                            href={`/jobs/${job.id}#qc`}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium bg-primary/10 hover:bg-primary/20 text-primary rounded-md transition-colors"
                          >
                            Review
                            <ArrowRight className="w-3 h-3" />
                          </Link>
                        )}
                        {job.status === "AWAITING_UPLOADER" && (
                          <Link
                            href={`/jobs/${job.id}`}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium bg-success/10 hover:bg-success/20 text-success rounded-md transition-colors"
                          >
                            Upload
                            <ArrowRight className="w-3 h-3" />
                          </Link>
                        )}
                        <Link
                          href={`/jobs/${job.id}`}
                          className="inline-flex items-center gap-1 text-sm text-primary hover:text-primary/80 transition-colors"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          View
                        </Link>
                        {canDelete && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleRowDelete(job.id);
                            }}
                            disabled={acting}
                            className="inline-flex items-center p-1 text-text-muted hover:text-error transition-colors disabled:opacity-40"
                            title="Delete job"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

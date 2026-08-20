"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useDropzone } from "react-dropzone";
import {
  V2Card,
  V2Button,
  V2Text,
  V2Label,
  V2Heading,
} from "@/app/(authenticated)/_components";
import { Upload, FileVideo, AlertCircle, CheckCircle } from "lucide-react";
import {
  finalizeHeyGenFootageUpload,
  getNextProductionVAJob,
} from "@/app/actions/jobs";

/**
 * HeyGen Upload Dropzone Component
 *
 * Drag-and-drop or click to upload HeyGen-generated video footage.
 * Features:
 * - V2 UI Design System (consistent with QC panels)
 * - Real-time SSE updates for upload progress and status changes
 * - Batch operations: "Next Job" button, queue visibility
 * - Error handling: Copy button, detailed error display
 * - Max file size: 15GB
 * - Accepted formats: MP4, MOV
 * - Uploads via /api/upload (bypasses server action body limit)
 */

interface HeyGenUploadDropzoneProps {
  jobId: string;
  channelId: string;
  disabled?: boolean;
}

interface ProductionVAStats {
  awaitingProductionVACount: number;
  errorCount: number;
}

export function HeyGenUploadDropzone({
  jobId,
  channelId,
  disabled,
}: HeyGenUploadDropzoneProps) {
  const router = useRouter();
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [showErrorDetails, setShowErrorDetails] = useState(false);
  const [copiedError, setCopiedError] = useState(false);
  const [nextJobId, setNextJobId] = useState<string | null>(null);
  const [vaStats, setVaStats] = useState<ProductionVAStats>({
    awaitingProductionVACount: 0,
    errorCount: 0,
  });
  const eventSourceRef = useRef<EventSource | null>(null);

  // Real-time updates via SSE
  useEffect(() => {
    const connectSSE = () => {
      try {
        const es = new EventSource(
          `/api/jobs/production-va-stream?job_id=${jobId}`,
        );
        eventSourceRef.current = es;

        es.addEventListener("job-update", (event) => {
          try {
            const data = JSON.parse(event.data);
            // Refresh page if job status changed
            if (data.status && data.status !== "AWAITING_PRODUCTION_VA") {
              router.refresh();
            }
          } catch (err) {
            console.error("Failed to parse job-update event:", err);
          }
        });

        es.addEventListener("va-stats", (event) => {
          try {
            const stats = JSON.parse(event.data);
            setVaStats(stats);
          } catch (err) {
            console.error("Failed to parse va-stats event:", err);
          }
        });

        es.onerror = () => {
          console.error("SSE connection error, reconnecting...");
          es.close();
          eventSourceRef.current = null;
          setTimeout(connectSSE, 3000);
        };
      } catch (err) {
        console.error("Failed to connect to SSE:", err);
        setTimeout(connectSSE, 3000);
      }
    };

    connectSSE();

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };
  }, [jobId, router]);

  // Load next production VA job on mount
  useEffect(() => {
    const loadNextJob = async () => {
      const result = await getNextProductionVAJob(jobId);
      setNextJobId(result.jobId);
    };
    loadNextJob();
  }, [jobId]);

  const copyErrorToClipboard = async () => {
    if (error) {
      await navigator.clipboard.writeText(error);
      setCopiedError(true);
      setTimeout(() => setCopiedError(false), 2000);
    }
  };

  const onDrop = useCallback(
    async (acceptedFiles: File[]) => {
      if (acceptedFiles.length === 0) {
        return;
      }

      const file = acceptedFiles[0];

      // Validate file type
      if (!file.type.startsWith("video/")) {
        setError("Please upload a video file (MP4 or MOV)");
        return;
      }

      // Validate file size (15GB max)
      const maxSize = 15 * 1024 * 1024 * 1024;
      if (file.size > maxSize) {
        setError("File size exceeds 15GB limit");
        return;
      }

      setUploading(true);
      setProgress(0);
      setError(null);

      try {
        // Upload via /api/upload using XHR for real progress tracking
        const formData = new FormData();
        formData.append("file", file);
        formData.append("channel_id", channelId);

        const uploadResult = await new Promise<{
          key: string;
          size_bytes: number;
        }>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open("POST", "/api/upload");

          xhr.upload.addEventListener("progress", (e) => {
            if (e.lengthComputable) {
              setProgress(Math.round((e.loaded / e.total) * 90));
            }
          });

          xhr.addEventListener("load", () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              try {
                resolve(JSON.parse(xhr.responseText));
              } catch {
                reject(new Error("Invalid response from upload server"));
              }
            } else {
              try {
                const body = JSON.parse(xhr.responseText);
                reject(
                  new Error(body.error ?? `Upload failed (${xhr.status})`),
                );
              } catch {
                reject(new Error(`Upload failed (${xhr.status})`));
              }
            }
          });

          xhr.addEventListener("error", () =>
            reject(new Error("Network error during upload")),
          );
          xhr.send(formData);
        });

        setProgress(95);

        // Finalize: update job status via lightweight server action
        const result = await finalizeHeyGenFootageUpload(
          jobId,
          uploadResult.key,
          uploadResult.size_bytes,
        );

        setProgress(100);

        if (result.success) {
          setSuccess(true);
          setTimeout(() => {
            router.refresh();
          }, 1000);
        } else {
          setError(result.error || "Upload failed");
          setProgress(0);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Upload failed");
        setProgress(0);
      } finally {
        setUploading(false);
      }
    },
    [jobId, channelId, router],
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      "video/mp4": [".mp4"],
      "video/quicktime": [".mov"],
    },
    maxFiles: 1,
    disabled: disabled || uploading || success,
  });

  if (success) {
    return (
      <V2Card>
        <div className="text-center space-y-3">
          <div className="flex justify-center">
            <CheckCircle className="w-12 h-12 text-[var(--v2-accent)]" />
          </div>
          <V2Heading level={3}>Upload Successful</V2Heading>
          <V2Text variant="body" muted>
            Video is being processed and will move to QMS validation shortly.
          </V2Text>
        </div>
      </V2Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header with queue stats and next job button */}
      <div className="flex items-center justify-between">
        <V2Label>HeyGen Video Upload</V2Label>
        <div className="flex items-center gap-3">
          {vaStats.awaitingProductionVACount > 0 && (
            <div className="px-3 py-1.5 rounded-lg bg-[var(--v2-surface-2)] border border-[var(--v2-border-1)]">
              <V2Text variant="caption" muted>
                Queue:{" "}
                <span className="font-semibold text-[var(--v2-text-1)]">
                  {vaStats.awaitingProductionVACount}
                </span>
              </V2Text>
            </div>
          )}
          {nextJobId && (
            <V2Button
              variant="ghost"
              size="sm"
              onClick={() => router.push(`/jobs/${nextJobId}`)}
              disabled={uploading}
              title="Navigate to next production VA job"
            >
              <span className="material-symbols-outlined text-[14px]">
                arrow_forward
              </span>
              Next Job
            </V2Button>
          )}
        </div>
      </div>

      {/* Dropzone */}
      <div
        {...getRootProps()}
        className={`rounded-lg p-8 border-2 border-dashed transition-all cursor-pointer ${
          isDragActive
            ? "border-[var(--v2-accent)] bg-[var(--v2-accent)]/10"
            : "border-[var(--v2-border-1)]"
        } ${disabled || uploading || success ? "opacity-50 cursor-not-allowed" : ""}`}
        style={{
          background: isDragActive
            ? "rgba(var(--v2-accent-rgb), 0.05)"
            : "rgba(255, 255, 255, 0.02)",
          backdropFilter: "blur(20px)",
        }}
      >
        <input {...getInputProps()} />

        <div className="text-center">
          {uploading ? (
            <>
              <Upload className="w-12 h-12 text-[var(--v2-accent)] mx-auto mb-4 animate-pulse" />
              <p className="text-sm font-medium text-[var(--v2-text-1)] mb-2">
                Uploading... {progress}%
              </p>
              <div className="w-full bg-[var(--v2-surface-2)] rounded-full h-2 mb-4">
                <div
                  className="bg-[var(--v2-accent)] h-2 rounded-full transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </>
          ) : (
            <>
              <FileVideo className="w-12 h-12 text-[var(--v2-text-2)] mx-auto mb-4" />
              <p className="text-sm font-medium text-[var(--v2-text-1)] mb-2">
                {isDragActive
                  ? "Drop video here"
                  : "Drag and drop HeyGen footage"}
              </p>
              <p className="text-xs text-[var(--v2-text-2)] mb-4">
                or click to browse
              </p>
              <p className="text-xs text-[var(--v2-text-3)]">
                MP4 or MOV, max 15GB
              </p>
            </>
          )}
        </div>
      </div>

      {/* Error handling with copy button */}
      {error && (
        <div className="space-y-2">
          <div className="flex items-start justify-between p-4 rounded-lg bg-[var(--v2-error-light)] border border-[var(--v2-error)]">
            <div className="flex items-start gap-3 flex-1">
              <span className="material-symbols-outlined text-[var(--v2-error)] flex-shrink-0 mt-0.5">
                warning
              </span>
              <div className="flex-1">
                <V2Label className="text-[var(--v2-error)] mb-1">
                  Upload Error
                </V2Label>
                <V2Text
                  variant="body"
                  className={`text-[var(--v2-text-1)] ${
                    showErrorDetails ? "" : "line-clamp-2"
                  }`}
                >
                  {error}
                </V2Text>
              </div>
            </div>
            <V2Button
              variant="ghost"
              size="sm"
              onClick={copyErrorToClipboard}
              title={copiedError ? "Copied!" : "Copy error message"}
              className="flex-shrink-0 ml-2"
            >
              <span className="material-symbols-outlined text-[14px]">
                {copiedError ? "done" : "content_copy"}
              </span>
            </V2Button>
          </div>
          {error.length > 100 && (
            <button
              onClick={() => setShowErrorDetails(!showErrorDetails)}
              className="text-[12px] text-[var(--v2-accent)] hover:underline font-medium"
            >
              {showErrorDetails ? "Show less" : "Show more"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

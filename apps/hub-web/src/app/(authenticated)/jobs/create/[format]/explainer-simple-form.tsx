"use client";

/**
 * Simple EXPLAINER Job Creation Form
 *
 * Temporary implementation that bypasses the plugin system.
 * Just provides basic topic and script fields for creating explainer jobs.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { NarrationUpload } from "@/components/job-creation/narration-upload";

interface Channel {
  id: string;
  name: string;
}

interface Template {
  id: string;
  name: string;
}

interface ExplainerSimpleJobFormProps {
  channels: Channel[];
  templates: Template[];
}

export function ExplainerSimpleJobForm({
  channels,
  templates,
}: ExplainerSimpleJobFormProps) {
  const router = useRouter();
  const [topic, setTopic] = useState("");
  const [script, setScript] = useState("");
  const [narrationPath, setNarrationPath] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!topic.trim()) {
      setError("Topic is required");
      return;
    }

    setIsSubmitting(true);
    setError("");

    try {
      const response = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          format: "EXPLAINER",
          metadata: {
            topic: topic.trim(),
            script: script.trim() || undefined,
          },
          narration_source_path: narrationPath || undefined,
          channel_id: channels[0]?.id,
          template_id: templates[0]?.id,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || "Failed to create job");
      }

      await response.json();
      router.push("/jobs");
    } catch (err) {
      console.error("Job creation failed:", err);
      setError(err instanceof Error ? err.message : "Failed to create job");
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Topic field */}
      <div>
        <label
          htmlFor="topic"
          className="block text-sm font-medium text-gray-200 mb-2"
        >
          Topic *
        </label>
        <input
          type="text"
          id="topic"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="e.g., How Quantum Computing Works"
          className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#aaff00] focus:border-transparent"
          required
        />
        <p className="mt-1 text-xs text-gray-400">
          What topic should this explainer cover?
        </p>
      </div>

      {/* Custom Narration Upload */}
      <NarrationUpload onUpload={setNarrationPath} disabled={isSubmitting} />

      {/* Script field */}
      <div>
        <label
          htmlFor="script"
          className="block text-sm font-medium text-gray-200 mb-2"
        >
          Script (Optional)
        </label>
        <textarea
          id="script"
          value={script}
          onChange={(e) => setScript(e.target.value)}
          placeholder="Paste your pre-written script here, or leave empty to let AI generate it..."
          rows={12}
          className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#aaff00] focus:border-transparent font-mono text-sm"
        />
        <p className="mt-1 text-xs text-gray-400">
          Leave empty to generate script automatically using AI.
        </p>
      </div>

      {/* Error message */}
      {error && (
        <div className="p-4 bg-red-500/10 border border-red-500/30 rounded text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* Action buttons */}
      <div className="flex justify-end gap-3 pt-4">
        <button
          type="button"
          onClick={() => router.back()}
          className="px-4 py-2 text-sm font-medium text-gray-400 hover:text-gray-200 transition-colors"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={isSubmitting}
          className="px-6 py-2 text-sm font-bold text-black bg-[#aaff00] hover:bg-[#7acc00] rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isSubmitting ? "Creating..." : "Create Job"}
        </button>
      </div>
    </form>
  );
}

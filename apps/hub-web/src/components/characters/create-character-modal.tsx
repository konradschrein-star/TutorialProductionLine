"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { X, ChevronDown, AlertTriangle } from "lucide-react";
import type { Character } from "@/lib/repositories/character-repository";
import type { Archetype } from "@/lib/repositories/archetype-repository";

interface CreateCharacterModalProps {
  archetypes: Archetype[];
  /** Scopes the created character to this channel instead of leaving it universal. */
  channelId?: string;
  onCreated: (character: Character) => void;
  onClose: () => void;
}

export function CreateCharacterModal({
  archetypes,
  channelId,
  onCreated,
  onClose,
}: CreateCharacterModalProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [archetypeId, setArchetypeId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTimeout(() => nameRef.current?.focus(), 50);
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setError(null);

      if (!name.trim()) {
        setError("Name is required.");
        return;
      }
      if (!description.trim()) {
        setError("Description is required.");
        return;
      }

      setSubmitting(true);
      try {
        const body: Record<string, unknown> = {
          name: name.trim(),
          description: description.trim(),
        };
        if (archetypeId) body.archetype_id = archetypeId;
        if (channelId) body.channel_id = channelId;

        const res = await fetch("/api/characters", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const json = await res.json();

        if (!res.ok) {
          setError(json.error ?? "Failed to create character");
          return;
        }

        onCreated(json.character as Character);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to create character",
        );
      } finally {
        setSubmitting(false);
      }
    },
    [name, description, archetypeId, channelId, onCreated],
  );

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-[rgba(0,0,0,0.6)] backdrop-blur-sm z-40"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Modal */}
      <div
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
        role="dialog"
        aria-modal="true"
        aria-label="Create Character"
      >
        <div className="w-full max-w-[500px] bg-[rgba(255,255,255,0.04)] backdrop-blur-[20px] border border-[rgba(170,255,0,0.15)] rounded-xl shadow-2xl flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-[rgba(75,68,85,0.3)]">
            <h2 className="text-lg font-bold text-[#e5e2e1]">New Character</h2>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-[rgba(205,195,215,0.6)] hover:text-[#e5e2e1] hover:bg-[#1c1c1c] transition-colors"
              aria-label="Close"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="px-6 py-5 space-y-5">
            {/* Name */}
            <div className="space-y-1">
              <label className="text-xs font-medium text-[rgba(205,195,215,0.6)]">
                Name <span className="text-[#ef4444]">*</span>
              </label>
              <input
                ref={nameRef}
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder='e.g. "Professor Stick"'
                className="w-full px-3 py-2 text-sm bg-[#151515] border border-[rgba(75,68,85,0.3)] rounded-lg text-[#e5e2e1] placeholder-[rgba(205,195,215,0.5)] focus:outline-none focus:border-[rgba(170,255,0,0.5)]"
              />
            </div>

            {/* Description */}
            <div className="space-y-1">
              <label className="text-xs font-medium text-[rgba(205,195,215,0.6)] flex items-center gap-2">
                Description <span className="text-[#ef4444]">*</span>
                <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-[rgba(170,255,0,0.2)] text-[#aaff00] uppercase tracking-wide">
                  Injected into image prompts
                </span>
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe the character as art direction — appended verbatim to image prompts."
                rows={4}
                className="w-full px-3 py-2 text-sm bg-[#151515] border border-[rgba(75,68,85,0.3)] rounded-lg text-[#e5e2e1] placeholder-[rgba(205,195,215,0.5)] focus:outline-none focus:border-[rgba(170,255,0,0.5)] resize-none"
              />
            </div>

            {/* Archetype */}
            {archetypes.length > 0 && (
              <div className="space-y-1">
                <label className="text-xs font-medium text-[rgba(205,195,215,0.6)]">
                  Archetype
                </label>
                <div className="relative">
                  <select
                    value={archetypeId}
                    onChange={(e) => setArchetypeId(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-[#151515] border border-[rgba(75,68,85,0.3)] rounded-lg text-[#e5e2e1] appearance-none focus:outline-none focus:border-[rgba(170,255,0,0.5)] pr-9"
                  >
                    <option value="">None (universal)</option>
                    {archetypes.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[rgba(205,195,215,0.6)] pointer-events-none" />
                </div>
              </div>
            )}

            {/* Error */}
            {error && (
              <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg border border-[rgba(239,68,68,0.3)] bg-[rgba(239,68,68,0.1)]">
                <AlertTriangle className="w-4 h-4 text-[#ef4444] flex-shrink-0" />
                <p className="text-sm text-[#ef4444]">{error}</p>
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-3 pt-1">
              <button
                type="button"
                onClick={onClose}
                disabled={submitting}
                className="v2-btn flex-1 py-2.5"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="v2-btn-accent flex-1 py-2.5 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {submitting ? "Creating…" : "Create Character"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </>
  );
}

'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Bulk Topics Input Component
 *
 * Client component providing a textarea for pasting multiple topics
 * (one per line) and dispatching them as jobs in bulk.
 */

interface BulkTopicsInputProps {
  templates: Array<{ id: string; name: string; format: string }>;
  channels: Array<{ id: string; name: string }>;
  format: string;
  onSubmit: (data: {
    topics: string[];
    template_id: string;
    channel_id: string;
  }) => Promise<{
    success: boolean;
    queued?: number;
    errors?: Array<{ topic: string; error: string }>;
  }>;
}

export function BulkTopicsInput({
  templates,
  channels,
  format,
  onSubmit,
}: BulkTopicsInputProps) {
  const [text, setText] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [channelId, setChannelId] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{
    queued?: number;
    errors?: Array<{ topic: string; error: string }>;
  } | null>(null);

  const filteredTemplates = templates.filter((t) => t.format === format);

  const topics = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const canSubmit =
    topics.length > 0 && templateId !== '' && channelId !== '' && !loading;

  async function handleSubmit() {
    if (!canSubmit) return;
    setLoading(true);
    setResult(null);

    try {
      const res = await onSubmit({
        topics,
        template_id: templateId,
        channel_id: channelId,
      });

      setResult({ queued: res.queued, errors: res.errors });

      if (res.success && !res.errors?.length) {
        setText('');
      }
    } catch {
      setResult({ errors: [{ topic: '', error: 'Unexpected error occurred' }] });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Section title */}
      <span className="text-wide-caps">Bulk Topics</span>

      {/* Textarea */}
      <textarea
        rows={8}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setResult(null);
        }}
        placeholder="Paste topics, one per line..."
        className="w-full px-3 py-2 rounded-lg bg-surface-container border border-surface-bright text-text placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary resize-y font-mono text-sm"
      />

      {/* Controls row */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Template dropdown */}
        <select
          value={templateId}
          onChange={(e) => setTemplateId(e.target.value)}
          className="w-full px-3 py-2 rounded-lg bg-surface-container border border-surface-bright text-text focus:outline-none focus:ring-2 focus:ring-primary sm:w-auto sm:min-w-[200px]"
        >
          <option value="">Select template...</option>
          {filteredTemplates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>

        {/* Channel dropdown */}
        <select
          value={channelId}
          onChange={(e) => setChannelId(e.target.value)}
          className="w-full px-3 py-2 rounded-lg bg-surface-container border border-surface-bright text-text focus:outline-none focus:ring-2 focus:ring-primary sm:w-auto sm:min-w-[200px]"
        >
          <option value="">Select channel...</option>
          {channels.map((ch) => (
            <option key={ch.id} value={ch.id}>
              {ch.name}
            </option>
          ))}
        </select>

        {/* Submit button */}
        <button
          type="button"
          disabled={!canSubmit}
          onClick={handleSubmit}
          className="px-6 py-2 rounded-lg bg-primary hover:bg-primary/90 text-white transition-colors disabled:opacity-50"
        >
          {loading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <>Queue {topics.length} Job{topics.length !== 1 ? 's' : ''}</>
          )}
        </button>
      </div>

      {/* Results */}
      {result && (
        <div className="space-y-2">
          {result.queued != null && result.queued > 0 && (
            <p className="text-sm text-success font-medium">
              Queued: {result.queued}
            </p>
          )}

          {result.errors && result.errors.length > 0 && (
            <div className="space-y-1">
              {result.errors.map((err, i) => (
                <p key={i} className="text-sm text-error">
                  {err.topic ? (
                    <>
                      <span className="font-medium">{err.topic}:</span>{' '}
                    </>
                  ) : null}
                  {err.error}
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

'use client';

import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Batch Defaults Panel Component
 *
 * Client component providing a collapsible panel where operators
 * can configure default settings for batch job creation.
 */

interface BatchDefaultsPanelProps {
  templates: Array<{ id: string; name: string }>;
  channels: Array<{ id: string; name: string }>;
  defaults: {
    template_id: string;
    channel_id: string;
    aspect_ratio: '16:9' | '9:16';
    priority: 'low' | 'normal' | 'high';
  };
  onChange: (defaults: BatchDefaultsPanelProps['defaults']) => void;
}

const ASPECT_RATIOS = ['16:9', '9:16'] as const;
const PRIORITIES = ['low', 'normal', 'high'] as const;

export function BatchDefaultsPanel({
  templates,
  channels,
  defaults,
  onChange,
}: BatchDefaultsPanelProps) {
  const [open, setOpen] = useState(false);

  function update(patch: Partial<BatchDefaultsPanelProps['defaults']>) {
    onChange({ ...defaults, ...patch });
  }

  return (
    <div className="glass-panel rounded-xl">
      {/* Toggle header */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-3 text-wide-caps hover:bg-surface-bright/30 transition-colors rounded-xl"
      >
        <span>Batch Defaults</span>
        {open ? (
          <ChevronUp className="w-4 h-4 text-text-muted" />
        ) : (
          <ChevronDown className="w-4 h-4 text-text-muted" />
        )}
      </button>

      {/* Collapsible body */}
      {open && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 px-4 pb-4">
          {/* Template */}
          <div className="space-y-1">
            <label className="block text-xs font-medium text-text-muted">
              Template
            </label>
            <select
              value={defaults.template_id}
              onChange={(e) => update({ template_id: e.target.value })}
              className="w-full px-3 py-2 rounded-lg bg-surface-container border border-surface-bright text-text focus:outline-none focus:ring-2 focus:ring-primary text-sm"
            >
              <option value="">Select template...</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>

          {/* Channel */}
          <div className="space-y-1">
            <label className="block text-xs font-medium text-text-muted">
              Channel
            </label>
            <select
              value={defaults.channel_id}
              onChange={(e) => update({ channel_id: e.target.value })}
              className="w-full px-3 py-2 rounded-lg bg-surface-container border border-surface-bright text-text focus:outline-none focus:ring-2 focus:ring-primary text-sm"
            >
              <option value="">Select channel...</option>
              {channels.map((ch) => (
                <option key={ch.id} value={ch.id}>
                  {ch.name}
                </option>
              ))}
            </select>
          </div>

          {/* Aspect Ratio */}
          <div className="space-y-1">
            <label className="block text-xs font-medium text-text-muted">
              Aspect Ratio
            </label>
            <div className="flex gap-2">
              {ASPECT_RATIOS.map((ratio) => (
                <button
                  key={ratio}
                  type="button"
                  onClick={() => update({ aspect_ratio: ratio })}
                  className={cn(
                    'flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                    defaults.aspect_ratio === ratio
                      ? 'bg-primary text-white'
                      : 'bg-surface-container text-text-muted hover:text-text'
                  )}
                >
                  {ratio}
                </button>
              ))}
            </div>
          </div>

          {/* Priority */}
          <div className="space-y-1">
            <label className="block text-xs font-medium text-text-muted">
              Priority
            </label>
            <div className="flex gap-2">
              {PRIORITIES.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => update({ priority: p })}
                  className={cn(
                    'flex-1 px-3 py-2 rounded-lg text-sm font-medium capitalize transition-colors',
                    defaults.priority === p
                      ? 'bg-primary text-white'
                      : 'bg-surface-container text-text-muted hover:text-text'
                  )}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

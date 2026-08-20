'use client';

import { useState } from 'react';
import { ChevronDown, ChevronUp, DollarSign, Zap, Clock, CheckCircle, XCircle } from 'lucide-react';
import { V2Card } from '../../../_components';

/**
 * Model Pricing (as of 2025, per 1k tokens)
 */
const MODEL_PRICING: Record<string, { input_per_1k: number; output_per_1k: number }> = {
  'claude-sonnet-4-6': { input_per_1k: 0.003, output_per_1k: 0.015 },
  'claude-haiku-4-5-20251001': { input_per_1k: 0.00025, output_per_1k: 0.00125 },
  'claude-opus-4-6': { input_per_1k: 0.015, output_per_1k: 0.075 },
};

const DEFAULT_PRICING = { input_per_1k: 0.003, output_per_1k: 0.015 };

function estimateCost(model: string, input_tokens: number, output_tokens: number): number {
  const pricing = MODEL_PRICING[model] ?? DEFAULT_PRICING;
  return (input_tokens / 1000) * pricing.input_per_1k + (output_tokens / 1000) * pricing.output_per_1k;
}

interface GenerationLogEntry {
  stage: string;
  started_at: string;
  completed_at: string;
  duration_ms: number;
  model: string;
  prompt_system?: string;
  prompt_user?: string;
  raw_output?: string;
  success: boolean;
  error?: string;
  input_tokens?: number;
  output_tokens?: number;
}

interface LogsTabProps {
  generationLog: GenerationLogEntry[];
}

export function LogsTab({ generationLog }: LogsTabProps) {
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);

  if (generationLog.length === 0) {
    return (
      <V2Card>
        <div style={{ textAlign: 'center', padding: '40px 20px' }}>
          <p style={{ fontSize: 13, color: 'var(--v2-text-2)' }}>
            No AI generation events logged yet.
          </p>
        </div>
      </V2Card>
    );
  }

  // Calculate total cost
  const totalCost = generationLog.reduce((sum, entry) => {
    if (entry.input_tokens && entry.output_tokens) {
      return sum + estimateCost(entry.model, entry.input_tokens, entry.output_tokens);
    }
    return sum;
  }, 0);

  const totalDurationMs = generationLog.reduce((sum, entry) => sum + entry.duration_ms, 0);
  const successCount = generationLog.filter((e) => e.success).length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Summary Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
        <V2Card>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <DollarSign size={20} style={{ color: 'var(--v2-accent)' }} />
            <div>
              <p style={{ fontSize: 10, color: 'var(--v2-text-3)', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 4px 0' }}>
                Total Cost
              </p>
              <p style={{ fontSize: 16, fontWeight: 700, color: 'var(--v2-text-1)', margin: 0 }}>
                ${totalCost.toFixed(4)}
              </p>
            </div>
          </div>
        </V2Card>

        <V2Card>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Clock size={20} style={{ color: 'var(--v2-success)' }} />
            <div>
              <p style={{ fontSize: 10, color: 'var(--v2-text-3)', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 4px 0' }}>
                Total Duration
              </p>
              <p style={{ fontSize: 16, fontWeight: 700, color: 'var(--v2-text-1)', margin: 0 }}>
                {(totalDurationMs / 1000).toFixed(1)}s
              </p>
            </div>
          </div>
        </V2Card>

        <V2Card>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Zap size={20} style={{ color: 'var(--v2-warning)' }} />
            <div>
              <p style={{ fontSize: 10, color: 'var(--v2-text-3)', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 4px 0' }}>
                Success Rate
              </p>
              <p style={{ fontSize: 16, fontWeight: 700, color: 'var(--v2-text-1)', margin: 0 }}>
                {successCount}/{generationLog.length}
              </p>
            </div>
          </div>
        </V2Card>
      </div>

      {/* Log Entries */}
      <V2Card noPadding>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {generationLog.map((entry, index) => {
            const isExpanded = expandedIndex === index;
            const cost =
              entry.input_tokens && entry.output_tokens
                ? estimateCost(entry.model, entry.input_tokens, entry.output_tokens)
                : null;

            return (
              <div
                key={index}
                style={{
                  borderBottom: index < generationLog.length - 1 ? '1px solid var(--v2-border-1)' : 'none',
                }}
              >
                {/* Header Row */}
                <button
                  onClick={() => setExpandedIndex(isExpanded ? null : index)}
                  style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '16px 20px',
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    textAlign: 'left',
                    transition: 'background 0.15s',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'var(--v2-surface-2)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'transparent';
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1 }}>
                    {entry.success ? (
                      <CheckCircle size={16} style={{ color: 'var(--v2-success)', flexShrink: 0 }} />
                    ) : (
                      <XCircle size={16} style={{ color: 'var(--v2-error)', flexShrink: 0 }} />
                    )}
                    <div style={{ flex: 1 }}>
                      <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--v2-text-1)', margin: '0 0 4px 0' }}>
                        {entry.stage}
                      </p>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 10, color: 'var(--v2-text-3)', fontFamily: 'monospace' }}>
                          {entry.model}
                        </span>
                        <span style={{ fontSize: 10, color: 'var(--v2-text-3)' }}>
                          {(entry.duration_ms / 1000).toFixed(2)}s
                        </span>
                        {cost && (
                          <span style={{ fontSize: 10, color: 'var(--v2-accent)', fontWeight: 600 }}>
                            ${cost.toFixed(4)}
                          </span>
                        )}
                        {entry.input_tokens && entry.output_tokens && (
                          <span style={{ fontSize: 10, color: 'var(--v2-text-3)' }}>
                            {entry.input_tokens.toLocaleString()} → {entry.output_tokens.toLocaleString()} tokens
                          </span>
                        )}
                      </div>
                    </div>
                    {isExpanded ? (
                      <ChevronUp size={16} style={{ color: 'var(--v2-text-3)', flexShrink: 0 }} />
                    ) : (
                      <ChevronDown size={16} style={{ color: 'var(--v2-text-3)', flexShrink: 0 }} />
                    )}
                  </div>
                </button>

                {/* Expanded Details */}
                {isExpanded && (
                  <div style={{ padding: '0 20px 20px 48px', display: 'flex', flexDirection: 'column', gap: 16 }}>
                    {/* Timestamps */}
                    <div>
                      <p style={{ fontSize: 10, color: 'var(--v2-text-3)', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 8px 0' }}>
                        Timestamps
                      </p>
                      <div style={{ fontSize: 11, color: 'var(--v2-text-2)', fontFamily: 'monospace' }}>
                        <p style={{ margin: '0 0 4px 0' }}>Started: {new Date(entry.started_at).toLocaleString()}</p>
                        <p style={{ margin: 0 }}>Completed: {new Date(entry.completed_at).toLocaleString()}</p>
                      </div>
                    </div>

                    {/* System Prompt */}
                    {entry.prompt_system && (
                      <div>
                        <p style={{ fontSize: 10, color: 'var(--v2-text-3)', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 8px 0' }}>
                          System Prompt
                        </p>
                        <pre style={{ fontSize: 11, color: 'var(--v2-text-2)', background: '#0e0e0e', padding: 12, borderRadius: 8, maxHeight: 200, overflowY: 'auto', whiteSpace: 'pre-wrap', margin: 0, fontFamily: 'monospace', lineHeight: 1.5 }}>
                          {entry.prompt_system}
                        </pre>
                      </div>
                    )}

                    {/* User Prompt */}
                    {entry.prompt_user && (
                      <div>
                        <p style={{ fontSize: 10, color: 'var(--v2-text-3)', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 8px 0' }}>
                          User Prompt
                        </p>
                        <pre style={{ fontSize: 11, color: 'var(--v2-text-2)', background: '#0e0e0e', padding: 12, borderRadius: 8, maxHeight: 200, overflowY: 'auto', whiteSpace: 'pre-wrap', margin: 0, fontFamily: 'monospace', lineHeight: 1.5 }}>
                          {entry.prompt_user}
                        </pre>
                      </div>
                    )}

                    {/* Raw Output */}
                    {entry.raw_output && (
                      <div>
                        <p style={{ fontSize: 10, color: 'var(--v2-text-3)', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 8px 0' }}>
                          Raw Output
                        </p>
                        <pre style={{ fontSize: 11, color: 'var(--v2-text-2)', background: '#0e0e0e', padding: 12, borderRadius: 8, maxHeight: 300, overflowY: 'auto', whiteSpace: 'pre-wrap', margin: 0, fontFamily: 'monospace', lineHeight: 1.5 }}>
                          {entry.raw_output.substring(0, 10000)}
                          {entry.raw_output.length > 10000 && '\n\n[... truncated]'}
                        </pre>
                      </div>
                    )}

                    {/* Error */}
                    {entry.error && (
                      <div style={{ padding: 12, background: 'rgba(255,180,171,0.05)', border: '1px solid rgba(255,180,171,0.2)', borderRadius: 8 }}>
                        <p style={{ fontSize: 10, fontWeight: 700, color: '#ffb4ab', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 8px 0' }}>
                          Error
                        </p>
                        <p style={{ fontSize: 11, color: '#ffb4ab', margin: 0, fontFamily: 'monospace' }}>{entry.error}</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </V2Card>
    </div>
  );
}

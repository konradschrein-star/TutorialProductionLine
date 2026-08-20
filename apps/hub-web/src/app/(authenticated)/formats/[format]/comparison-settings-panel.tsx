'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { updateTemplate } from '@/app/actions/templates';

// ─── Types ────────────────────────────────────────────────────────────────────

const ALL_BLOCK_TYPES = [
  'HOOK_SPLIT_SLAM',
  'INTRO_CONTEXT',
  'SPEC_SCROLL',
  'DATA_RADAR_CHART',
  'DATA_BAR_CHART',
  'FEATURE_SPOTLIGHT',
  'PRICE_VALUE_CARD',
  'VERDICT_BUILDUP',
  'VERDICT_PODIUM',
  'AFFILIATE_CTA',
] as const;

const FIXED_BLOCKS = new Set(['HOOK_SPLIT_SLAM', 'VERDICT_BUILDUP', 'VERDICT_PODIUM', 'AFFILIATE_CTA']);

const BLOCK_LABELS: Record<string, string> = {
  HOOK_SPLIT_SLAM: 'Hook Split Slam',
  INTRO_CONTEXT: 'Intro Context',
  SPEC_SCROLL: 'Spec Scroll',
  DATA_RADAR_CHART: 'Data Radar Chart',
  DATA_BAR_CHART: 'Data Bar Chart',
  FEATURE_SPOTLIGHT: 'Feature Spotlight',
  PRICE_VALUE_CARD: 'Price Value Card',
  VERDICT_BUILDUP: 'Verdict Buildup',
  VERDICT_PODIUM: 'Verdict Podium',
  AFFILIATE_CTA: 'Affiliate CTA',
};

const DEFAULT_ACCENT_COLORS = ['#aaff00', '#00ddff', '#ff00aa', '#ffaa00', '#aa00ff'];
const DEFAULT_EMPHASIS_DIMENSIONS = ['Features', 'Performance', 'Price', 'UX', 'Ecosystem', 'Support'];

interface Template {
  id: string;
  name: string;
  description: string | null;
  pipeline_stages: string[];
  prompts: Record<string, any>;
  render_config: Record<string, any>;
  required_assets: string[];
  is_active: boolean;
  format: string;
}

interface ComparisonSettingsPanelProps {
  templates: Template[];
  format: string;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionHeader({ label, icon }: { label: string; icon: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
      <span className="material-symbols-outlined" style={{ fontSize: 16, color: 'var(--v2-accent)' }}>{icon}</span>
      <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(205,195,215,0.5)' }}>
        {label}
      </span>
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      background: 'rgba(255,255,255,0.02)',
      border: '1px solid rgba(255,255,255,0.07)',
      borderRadius: 12,
      padding: 18,
    }}>
      {children}
    </div>
  );
}

function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.4 : 1 }}>
      <div
        onClick={() => !disabled && onChange(!checked)}
        style={{
          width: 32, height: 18, borderRadius: 9,
          background: checked ? 'var(--v2-accent)' : 'rgba(255,255,255,0.08)',
          position: 'relative', transition: 'background 0.2s ease',
          flexShrink: 0,
        }}
      >
        <div style={{
          position: 'absolute', top: 2, left: checked ? 16 : 2,
          width: 14, height: 14, borderRadius: '50%',
          background: checked ? '#000' : 'rgba(205,195,215,0.5)',
          transition: 'left 0.2s ease',
        }} />
      </div>
      <span style={{ fontSize: 12, color: 'rgba(205,195,215,0.7)' }}>{label}</span>
    </label>
  );
}

function RangeRow({ label, value, min, max, step = 1, onChange }: {
  label: string; value: number; min: number; max: number; step?: number; onChange: (v: number) => void;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <span style={{ fontSize: 12, color: 'rgba(205,195,215,0.6)', width: 130, flexShrink: 0 }}>{label}</span>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ flex: 1, accentColor: 'var(--v2-accent)', height: 3 }}
      />
      <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--v2-accent)', width: 36, textAlign: 'right', flexShrink: 0 }}>
        {value}
      </span>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

function TemplateEditor({ template, format }: { template: Template; format: string }) {
  const [isPending, startTransition] = useTransition();

  // ── Render config state ──
  const rc = template.render_config ?? {};
  const rcSettings = (rc.settings as Record<string, any>) ?? {};
  const [fps, setFps] = useState<number>(rcSettings.fps ?? 30);
  const [captionsEnabled, setCaptionsEnabled] = useState<boolean>(rc.captions_enabled ?? false);
  const [voiceId, setVoiceId] = useState<string>(rc.voice_id ?? '');

  // ── Procedural generation state ──
  const metadata = (rc.procedural ?? {}) as Record<string, any>;
  const [accentColors, setAccentColors] = useState<string[]>(
    metadata.accent_palette ?? DEFAULT_ACCENT_COLORS
  );
  const [springStiffnessMin, setSpringStiffnessMin] = useState<number>(metadata.spring_stiffness_min ?? 80);
  const [springStiffnessMax, setSpringStiffnessMax] = useState<number>(metadata.spring_stiffness_max ?? 120);
  const [springDampingMin, setSpringDampingMin] = useState<number>(metadata.spring_damping_min ?? 180);
  const [springDampingMax, setSpringDampingMax] = useState<number>(metadata.spring_damping_max ?? 220);

  // ── Block config state ──
  const blockConfig = (rc.block_config ?? {}) as Record<string, any>;
  const [middleBlockMin, setMiddleBlockMin] = useState<number>(blockConfig.middle_block_min ?? 3);
  const [middleBlockMax, setMiddleBlockMax] = useState<number>(blockConfig.middle_block_max ?? 6);
  const [eligibleBlocks, setEligibleBlocks] = useState<Set<string>>(
    new Set(blockConfig.eligible_middle_blocks ?? ['SPEC_SCROLL', 'DATA_BAR_CHART', 'DATA_RADAR_CHART', 'FEATURE_SPOTLIGHT', 'PRICE_VALUE_CARD', 'INTRO_CONTEXT'])
  );

  // ── Emphasis dimensions state ──
  const [emphasisDimensions, setEmphasisDimensions] = useState<string[]>(
    (rc.emphasis_dimensions as string[]) ?? DEFAULT_EMPHASIS_DIMENSIONS
  );
  const [newDimension, setNewDimension] = useState('');

  // ── Prompt state ──
  const [scriptPrompt, setScriptPrompt] = useState<string>(
    template.prompts?.script ?? ''
  );
  const [sceneAnalysisPrompt, setSceneAnalysisPrompt] = useState<string>(
    template.prompts?.scene_analysis ?? ''
  );

  function toggleBlock(blockType: string) {
    setEligibleBlocks((prev) => {
      const next = new Set(prev);
      if (next.has(blockType)) next.delete(blockType);
      else next.add(blockType);
      return next;
    });
  }

  function toggleAccentColor(color: string) {
    setAccentColors((prev) =>
      prev.includes(color) ? prev.filter((c) => c !== color) : [...prev, color]
    );
  }

  function addDimension() {
    const d = newDimension.trim();
    if (d && !emphasisDimensions.includes(d)) {
      setEmphasisDimensions((prev) => [...prev, d]);
    }
    setNewDimension('');
  }

  function removeDimension(d: string) {
    setEmphasisDimensions((prev) => prev.filter((x) => x !== d));
  }

  function handleSave() {
    startTransition(async () => {
      const updatedRenderConfig = {
        ...rc,
        captions_enabled: captionsEnabled,
        voice_id: voiceId,
        emphasis_dimensions: emphasisDimensions,
        settings: { ...rcSettings, fps },
        procedural: {
          accent_palette: accentColors,
          spring_stiffness_min: springStiffnessMin,
          spring_stiffness_max: springStiffnessMax,
          spring_damping_min: springDampingMin,
          spring_damping_max: springDampingMax,
        },
        block_config: {
          middle_block_min: middleBlockMin,
          middle_block_max: middleBlockMax,
          eligible_middle_blocks: Array.from(eligibleBlocks),
        },
      };

      const result = await updateTemplate(template.id, {
        name: template.name,
        description: template.description,
        format,
        pipeline_stages: template.pipeline_stages,
        prompts: {
          ...template.prompts,
          script: scriptPrompt,
          scene_analysis: sceneAnalysisPrompt,
        },
        render_config: updatedRenderConfig,
        required_assets: template.required_assets,
      });

      if (result.success) {
        toast.success('Template saved');
      } else {
        toast.error('Save failed', { description: result.error });
      }
    });
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* ── Render Config ─────────────────────────────────────── */}
      <Card>
        <SectionHeader label="Render Config" icon="movie" />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <RangeRow label="Frame rate (fps)" value={fps} min={24} max={60} step={6} onChange={setFps} />
          <Toggle label="Captions enabled" checked={captionsEnabled} onChange={setCaptionsEnabled} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'rgba(205,195,215,0.4)' }}>
              Voice ID (ElevenLabs)
            </span>
            <input
              type="text"
              value={voiceId}
              onChange={(e) => setVoiceId(e.target.value)}
              placeholder="e.g. 21m00Tcm4TlvDq8ikWAM"
              style={{
                background: 'rgba(255,255,255,0.03)',
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 7,
                padding: '8px 12px',
                fontSize: 12,
                color: '#e5e2e1',
                outline: 'none',
                fontFamily: 'monospace',
              }}
              onFocus={(e) => { e.currentTarget.style.borderColor = 'rgba(170,255,0,0.3)'; }}
              onBlur={(e) => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'; }}
            />
          </div>
        </div>
      </Card>

      {/* ── Block Composition ─────────────────────────────────── */}
      <Card>
        <SectionHeader label="Block Composition" icon="view_column" />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <RangeRow label="Min middle blocks" value={middleBlockMin} min={1} max={middleBlockMax} onChange={(v) => setMiddleBlockMin(Math.min(v, middleBlockMax))} />
            <RangeRow label="Max middle blocks" value={middleBlockMax} min={middleBlockMin} max={10} onChange={(v) => setMiddleBlockMax(Math.max(v, middleBlockMin))} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'rgba(205,195,215,0.4)' }}>
              Eligible middle blocks
            </span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {ALL_BLOCK_TYPES.map((bt) => {
                const isFixed = FIXED_BLOCKS.has(bt);
                const isOn = isFixed || eligibleBlocks.has(bt);
                return (
                  <button
                    key={bt}
                    type="button"
                    disabled={isFixed}
                    onClick={() => !isFixed && toggleBlock(bt)}
                    style={{
                      padding: '5px 10px',
                      borderRadius: 6,
                      border: isOn ? '1px solid rgba(170,255,0,0.35)' : '1px solid rgba(255,255,255,0.07)',
                      background: isOn ? 'rgba(170,255,0,0.07)' : 'transparent',
                      color: isFixed ? 'rgba(170,255,0,0.4)' : isOn ? 'var(--v2-accent)' : 'rgba(205,195,215,0.4)',
                      fontSize: 11,
                      fontWeight: isOn ? 600 : 400,
                      cursor: isFixed ? 'default' : 'pointer',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    {BLOCK_LABELS[bt] ?? bt}
                    {isFixed && ' *'}
                  </button>
                );
              })}
            </div>
            <span style={{ fontSize: 10, color: 'rgba(205,195,215,0.25)' }}>* Fixed blocks always appear</span>
          </div>
        </div>
      </Card>

      {/* ── Emphasis Dimensions ───────────────────────────────── */}
      <Card>
        <SectionHeader label="Comparison Dimensions" icon="leaderboard" />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <span style={{ fontSize: 11, color: 'rgba(205,195,215,0.45)', lineHeight: 1.4 }}>
            What aspects the AI focuses on when comparing products.
          </span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {emphasisDimensions.map((d) => (
              <div
                key={d}
                style={{
                  display: 'flex', alignItems: 'center', gap: 5,
                  padding: '5px 10px',
                  background: 'rgba(170,255,0,0.06)',
                  border: '1px solid rgba(170,255,0,0.2)',
                  borderRadius: 6,
                }}
              >
                <span style={{ fontSize: 11, color: 'var(--v2-accent)' }}>{d}</span>
                <button
                  type="button"
                  onClick={() => removeDimension(d)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, lineHeight: 1, color: 'rgba(205,195,215,0.4)' }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 12 }}>close</span>
                </button>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type="text"
              value={newDimension}
              onChange={(e) => setNewDimension(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addDimension(); } }}
              placeholder="Add dimension (e.g. Battery Life)"
              style={{
                flex: 1,
                background: 'rgba(255,255,255,0.03)',
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 7,
                padding: '7px 12px',
                fontSize: 12,
                color: '#e5e2e1',
                outline: 'none',
              }}
              onFocus={(e) => { e.currentTarget.style.borderColor = 'rgba(170,255,0,0.3)'; }}
              onBlur={(e) => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'; }}
            />
            <button
              type="button"
              onClick={addDimension}
              style={{
                padding: '7px 12px', borderRadius: 7,
                background: 'rgba(170,255,0,0.08)',
                border: '1px solid rgba(170,255,0,0.2)',
                color: 'var(--v2-accent)', fontSize: 12, cursor: 'pointer',
              }}
            >
              Add
            </button>
          </div>
        </div>
      </Card>

      {/* ── Procedural Variation ──────────────────────────────── */}
      <Card>
        <SectionHeader label="Procedural Variation" icon="casino" />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Accent palette */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'rgba(205,195,215,0.4)' }}>
              Accent color pool
            </span>
            <span style={{ fontSize: 11, color: 'rgba(205,195,215,0.35)' }}>
              One color is picked per video from this pool using the render seed.
            </span>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {DEFAULT_ACCENT_COLORS.map((color) => {
                const active = accentColors.includes(color);
                return (
                  <button
                    key={color}
                    type="button"
                    onClick={() => toggleAccentColor(color)}
                    style={{
                      width: 32, height: 32, borderRadius: 7,
                      background: color,
                      border: active ? `2px solid #fff` : '2px solid rgba(255,255,255,0.1)',
                      cursor: 'pointer',
                      opacity: active ? 1 : 0.3,
                      transition: 'all 0.15s ease',
                      position: 'relative',
                    }}
                  >
                    {active && (
                      <span className="material-symbols-outlined" style={{ fontSize: 14, color: '#000', position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)' }}>
                        check
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
          {/* Spring physics */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'rgba(205,195,215,0.4)' }}>
              Spring physics range
            </span>
            <RangeRow label="Stiffness min" value={springStiffnessMin} min={50} max={springStiffnessMax} onChange={setSpringStiffnessMin} />
            <RangeRow label="Stiffness max" value={springStiffnessMax} min={springStiffnessMin} max={200} onChange={setSpringStiffnessMax} />
            <RangeRow label="Damping min" value={springDampingMin} min={100} max={springDampingMax} onChange={setSpringDampingMin} />
            <RangeRow label="Damping max" value={springDampingMax} min={springDampingMin} max={300} onChange={setSpringDampingMax} />
          </div>
        </div>
      </Card>

      {/* ── AI Prompts ────────────────────────────────────────── */}
      <Card>
        <SectionHeader label="AI Prompts" icon="psychology" />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {[
            { key: 'script', label: 'Script generation prompt', value: scriptPrompt, onChange: setScriptPrompt },
            { key: 'scene_analysis', label: 'Scene analysis prompt', value: sceneAnalysisPrompt, onChange: setSceneAnalysisPrompt },
          ].map(({ key, label, value, onChange }) => (
            <div key={key} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'rgba(205,195,215,0.4)' }}>
                {label}
              </span>
              <textarea
                value={value}
                onChange={(e) => onChange(e.target.value)}
                rows={5}
                placeholder="Leave empty to use default prompt"
                style={{
                  background: 'rgba(255,255,255,0.02)',
                  border: '1px solid rgba(255,255,255,0.07)',
                  borderRadius: 7,
                  padding: '10px 12px',
                  fontSize: 11,
                  color: '#e5e2e1',
                  outline: 'none',
                  fontFamily: 'monospace',
                  lineHeight: 1.5,
                  resize: 'vertical',
                }}
                onFocus={(e) => { e.currentTarget.style.borderColor = 'rgba(170,255,0,0.25)'; }}
                onBlur={(e) => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.07)'; }}
              />
            </div>
          ))}
        </div>
      </Card>

      {/* ── Save ──────────────────────────────────────────────── */}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button
          type="button"
          onClick={handleSave}
          disabled={isPending}
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '10px 24px', borderRadius: 8, border: 'none',
            background: isPending ? 'rgba(255,255,255,0.05)' : 'var(--v2-accent)',
            color: isPending ? 'rgba(205,195,215,0.3)' : '#000',
            fontSize: 13, fontWeight: 700,
            cursor: isPending ? 'not-allowed' : 'pointer',
            transition: 'all 0.15s ease',
          }}
        >
          {isPending ? (
            <>
              <span className="material-symbols-outlined" style={{ fontSize: 16, animation: 'spin 1s linear infinite' }}>progress_activity</span>
              Saving…
            </>
          ) : (
            <>
              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>save</span>
              Save Template
            </>
          )}
        </button>
      </div>
    </div>
  );
}

// ─── Export ───────────────────────────────────────────────────────────────────

export function ComparisonSettingsPanel({ templates, format }: ComparisonSettingsPanelProps) {
  if (templates.length === 0) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: 'rgba(205,195,215,0.35)', fontSize: 13 }}>
        No templates for this format yet.
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {templates.map((template, i) => (
        <div key={template.id}>
          {templates.length > 1 && (
            <div style={{ fontSize: 11, fontWeight: 600, color: 'rgba(205,195,215,0.4)', marginBottom: 12 }}>
              {template.name}
            </div>
          )}
          <TemplateEditor template={template} format={format} />
          {i < templates.length - 1 && (
            <div style={{ height: 1, background: 'rgba(255,255,255,0.05)', margin: '24px 0' }} />
          )}
        </div>
      ))}

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}

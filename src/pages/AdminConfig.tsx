import React, { useState, useEffect } from 'react';
import {
  Palette,
  Film,
  Search,
  Globe2,
  Target,
  Save,
  RotateCcw,
  Plus,
  Trash2,
  Users,
  Lock,
} from 'lucide-react';
import { StudioConfig, DEFAULT_STUDIO_CONFIG, LengthPreset, KeywordContentType, CompetitionLevel } from '../types/config';
import { StorageService } from '../services/storageService';
import { useConfig, useUsers } from '../hooks/useStore';
import { useToast, useConfirm } from '../components/ui/Feedback';
import { Field, TextInput, NumberInput, Select, Toggle, TagInput, SectionCard } from '../components/ui/Form';
import { LANGUAGES } from '../data/languages';

const CONTENT_TYPES: KeywordContentType[] = ['HOW_TO', 'FULL_TUTORIAL', 'LIST', 'REVIEW'];
const COMPETITION: CompetitionLevel[] = ['Low', 'Medium', 'High'];

/**
 * The owner/admin control surface. Everything the production line does that used
 * to be hardcoded is adjustable here — no code, no AI coding agent required.
 * Edits are staged locally and committed on "Save changes".
 */
export const AdminConfig: React.FC = () => {
  const saved = useConfig();
  const users = useUsers();
  const toast = useToast();
  const confirm = useConfirm();
  const [draft, setDraft] = useState<StudioConfig>(saved);
  const [dirty, setDirty] = useState(false);

  // Re-sync when the persisted config changes elsewhere and we have no pending edits.
  useEffect(() => {
    if (!dirty) setDraft(saved);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saved]);

  const patch = (updates: Partial<StudioConfig>) => {
    setDraft((d) => ({ ...d, ...updates }));
    setDirty(true);
  };
  const patchKeyword = (updates: Partial<StudioConfig['keyword']>) => {
    setDraft((d) => ({ ...d, keyword: { ...d.keyword, ...updates } }));
    setDirty(true);
  };

  const save = () => {
    StorageService.setConfig(draft);
    setDirty(false);
    toast('Studio configuration saved. Changes apply across the app immediately.', 'success', 'Saved');
  };

  const reset = async () => {
    const ok = await confirm({
      title: 'Reset configuration?',
      message: 'This restores every production, keyword, and branding setting to factory defaults. VA accounts and produced videos are not affected.',
      confirmLabel: 'Reset to defaults',
      danger: true,
    });
    if (!ok) return;
    setDraft({ ...DEFAULT_STUDIO_CONFIG });
    StorageService.resetConfig();
    setDirty(false);
    toast('Configuration reset to defaults.', 'info');
  };

  // ---- Length presets --------------------------------------------------------
  const updateLength = (id: string, updates: Partial<LengthPreset>) =>
    patch({ lengthPresets: draft.lengthPresets.map((p) => (p.id === id ? { ...p, ...updates } : p)) });
  const addLength = () =>
    patch({
      lengthPresets: [
        ...draft.lengthPresets,
        { id: `len_${Date.now()}`, label: 'New length', minutes: 3 },
      ],
    });
  const removeLength = (id: string) => patch({ lengthPresets: draft.lengthPresets.filter((p) => p.id !== id) });

  const mixTotal =
    draft.contentTypeMix.HOW_TO + draft.contentTypeMix.FULL_TUTORIAL + draft.contentTypeMix.LIST + draft.contentTypeMix.REVIEW;

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 animate-fadeIn">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-xl font-display font-bold text-foreground">Studio Configuration</h1>
          <p className="text-sm text-muted mt-0.5">
            Adjust how the whole production line behaves. No code required — changes apply live.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={reset} className="btn-outline focus-ring rounded-md px-3 py-2 text-sm flex items-center gap-1.5">
            <RotateCcw size={14} /> <span className="hidden sm:inline">Reset</span>
          </button>
          <button
            onClick={save}
            disabled={!dirty}
            className="btn-accent focus-ring rounded-md px-4 py-2 text-sm flex items-center gap-1.5"
          >
            <Save size={14} /> Save changes
          </button>
        </div>
      </div>

      {dirty && (
        <div className="mb-5 badge badge-warning w-full justify-start px-3 py-2 rounded-lg">
          You have unsaved changes.
        </div>
      )}

      <div className="grid grid-cols-1 gap-5">
        {/* Branding */}
        <SectionCard
          title="Branding"
          description="White-label the workstation for your team or clients."
          icon={<Palette size={18} />}
        >
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="Product name">
              <TextInput value={draft.productName} onChange={(e) => patch({ productName: e.target.value })} />
            </Field>
            <Field label="Brand accent color" hint="Drives buttons, highlights and badges across the app.">
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={draft.brandAccent}
                  onChange={(e) => patch({ brandAccent: e.target.value })}
                  className="h-9 w-12 rounded-md border border-border bg-surface-200 cursor-pointer"
                  aria-label="Brand accent color"
                />
                <TextInput value={draft.brandAccent} onChange={(e) => patch({ brandAccent: e.target.value })} className="font-mono" />
              </div>
            </Field>
          </div>
        </SectionCard>

        {/* Access control */}
        <SectionCard
          title="Access control"
          description="Optional PIN that gates switching into an admin/manager account on this shared workstation."
          icon={<Lock size={18} />}
        >
          <Field
            label="Admin PIN"
            hint="Leave empty for no lock. Deters casual role switching on a shared machine — stored locally, not a security boundary. Real multi-user auth is a server-side deployment concern."
          >
            <TextInput
              type="password"
              value={draft.adminPin}
              onChange={(e) => patch({ adminPin: e.target.value })}
              placeholder="e.g. 4–8 digits"
              className="max-w-xs font-mono"
            />
          </Field>
        </SectionCard>

        {/* Production defaults */}
        <SectionCard
          title="Production defaults"
          description="Video length, playback speed and content mix targets your VAs produce against."
          icon={<Film size={18} />}
        >
          <div className="grid sm:grid-cols-3 gap-4 mb-5">
            <Field label="Default target length (min)">
              <NumberInput
                min={0.5}
                step={0.5}
                value={draft.defaultTargetMinutes}
                onChange={(e) => patch({ defaultTargetMinutes: Number(e.target.value) })}
              />
            </Field>
            <Field label="Default speed">
              <Select value={draft.defaultSpeed} onChange={(e) => patch({ defaultSpeed: Number(e.target.value) })}>
                {draft.speedPresets.map((s) => (
                  <option key={s} value={s}>
                    {s.toFixed(2)}×
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Capture FPS" hint="Used for the speed/FPS indicator.">
              <NumberInput value={draft.captureFps} onChange={(e) => patch({ captureFps: Number(e.target.value) })} />
            </Field>
          </div>

          {/* Length presets */}
          <div className="mb-5">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-foreground">Selectable length presets</span>
              <button onClick={addLength} className="btn-outline focus-ring rounded-md px-2 py-1 text-xs flex items-center gap-1">
                <Plus size={12} /> Add
              </button>
            </div>
            <div className="space-y-2">
              {draft.lengthPresets.map((p) => (
                <div key={p.id} className="flex items-center gap-2">
                  <TextInput
                    value={p.label}
                    onChange={(e) => updateLength(p.id, { label: e.target.value })}
                    className="flex-1"
                  />
                  <NumberInput
                    min={0.5}
                    step={0.5}
                    value={p.minutes}
                    onChange={(e) => updateLength(p.id, { minutes: Number(e.target.value) })}
                    className="w-24"
                  />
                  <span className="text-xs text-muted">min</span>
                  <button
                    onClick={() => removeLength(p.id)}
                    className="text-muted hover:text-danger p-1.5 focus-ring rounded-md"
                    aria-label="Remove length preset"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Speed presets */}
          <Field label="Speed presets" hint="Comma-separated multipliers offered in the recorder/studio." className="mb-5">
            <TextInput
              value={draft.speedPresets.join(', ')}
              onChange={(e) =>
                patch({
                  speedPresets: e.target.value
                    .split(',')
                    .map((s) => parseFloat(s.trim()))
                    .filter((n) => !isNaN(n) && n > 0),
                })
              }
              className="font-mono"
            />
          </Field>

          {/* Content mix */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-foreground">Content type mix (target %)</span>
              <span className={`badge ${mixTotal === 100 ? 'badge-success' : 'badge-warning'}`}>{mixTotal}% total</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {CONTENT_TYPES.map((ct) => (
                <Field key={ct} label={ct.replace('_', ' ')}>
                  <NumberInput
                    min={0}
                    max={100}
                    value={draft.contentTypeMix[ct]}
                    onChange={(e) =>
                      patch({ contentTypeMix: { ...draft.contentTypeMix, [ct]: Number(e.target.value) } })
                    }
                  />
                </Field>
              ))}
            </div>
          </div>
        </SectionCard>

        {/* Topic focus */}
        <SectionCard
          title="Topic & software focus"
          description="Bias keyword sourcing and AI script angle toward the niches you produce for."
          icon={<Target size={18} />}
        >
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="Focus topics / niches">
              <TagInput values={draft.focusTopics} onChange={(v) => patch({ focusTopics: v })} placeholder="e.g. Excel automation" />
            </Field>
            <Field label="Focus software">
              <TagInput values={draft.focusSoftware} onChange={(v) => patch({ focusSoftware: v })} placeholder="e.g. Notion" />
            </Field>
          </div>
        </SectionCard>

        {/* Keyword engine defaults */}
        <SectionCard
          title="Keyword filters & scoring"
          description="Default filters applied to the keyword hub and the opportunity-score weighting."
          icon={<Search size={18} />}
        >
          <div className="grid sm:grid-cols-3 gap-4 mb-5">
            <Field label="Minimum volume">
              <NumberInput
                min={0}
                value={draft.keyword.minVolume}
                onChange={(e) => patchKeyword({ minVolume: Number(e.target.value) })}
              />
            </Field>
            <Field label="Max competition">
              <Select
                value={draft.keyword.maxCompetition}
                onChange={(e) => patchKeyword({ maxCompetition: e.target.value as CompetitionLevel })}
              >
                {COMPETITION.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Length cap (min)" hint="0 = no cap.">
              <NumberInput
                min={0}
                step={0.5}
                value={draft.keyword.lengthCapMinutes}
                onChange={(e) => patchKeyword({ lengthCapMinutes: Number(e.target.value) })}
              />
            </Field>
          </div>

          <Field label="Allowed content types" className="mb-5">
            <div className="flex flex-wrap gap-2">
              {CONTENT_TYPES.map((ct) => {
                const on = draft.keyword.allowedContentTypes.includes(ct);
                return (
                  <button
                    key={ct}
                    onClick={() =>
                      patchKeyword({
                        allowedContentTypes: on
                          ? draft.keyword.allowedContentTypes.filter((x) => x !== ct)
                          : [...draft.keyword.allowedContentTypes, ct],
                      })
                    }
                    className={`badge ${on ? 'badge-accent' : 'badge-neutral'} px-3 py-1.5`}
                  >
                    {ct.replace('_', ' ')}
                  </button>
                );
              })}
            </div>
          </Field>

          <div className="flex items-center justify-between p-3 rounded-lg bg-surface-200 mb-5">
            <div>
              <p className="text-sm font-medium text-foreground">Auto-screen on import</p>
              <p className="text-xs text-muted">Run AI screening (verdict + angle) automatically when keywords are added.</p>
            </div>
            <Toggle checked={draft.keyword.autoScreen} onChange={(v) => patchKeyword({ autoScreen: v })} />
          </div>

          <div>
            <span className="text-xs font-semibold text-foreground block mb-2">Opportunity score weights</span>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              {(['volume', 'competition', 'channelFit', 'freshness', 'lengthFit'] as const).map((k) => (
                <Field key={k} label={k}>
                  <NumberInput
                    min={0}
                    max={1}
                    step={0.05}
                    value={draft.keyword.scoreWeights[k]}
                    onChange={(e) =>
                      patchKeyword({ scoreWeights: { ...draft.keyword.scoreWeights, [k]: Number(e.target.value) } })
                    }
                  />
                </Field>
              ))}
            </div>
          </div>
        </SectionCard>

        {/* Localization */}
        <SectionCard
          title="Localization languages"
          description="The standard language set used by 'translate everything' batches."
          icon={<Globe2 size={18} />}
        >
          <div className="flex flex-wrap gap-2">
            {LANGUAGES.map((l) => {
              const on = draft.standardLanguages.includes(l.code);
              return (
                <button
                  key={l.code}
                  onClick={() =>
                    patch({
                      standardLanguages: on
                        ? draft.standardLanguages.filter((c) => c !== l.code)
                        : [...draft.standardLanguages, l.code],
                    })
                  }
                  className={`badge ${on ? 'badge-accent' : 'badge-neutral'} px-3 py-1.5`}
                >
                  {l.flag} {l.name}
                </button>
              );
            })}
          </div>
        </SectionCard>

        {/* VA targets */}
        <SectionCard
          title="VA production targets"
          description="Global defaults plus per-VA overrides. Metrics track output against these."
          icon={<Users size={18} />}
        >
          <div className="grid sm:grid-cols-2 gap-4 mb-5">
            <Field label="Default daily target (videos / VA)">
              <NumberInput
                min={0}
                value={draft.defaultDailyTarget}
                onChange={(e) => patch({ defaultDailyTarget: Number(e.target.value) })}
              />
            </Field>
            <Field label="Default weekly target (videos / VA)">
              <NumberInput
                min={0}
                value={draft.defaultWeeklyTarget}
                onChange={(e) => patch({ defaultWeeklyTarget: Number(e.target.value) })}
              />
            </Field>
          </div>

          <div className="space-y-2">
            <span className="text-xs font-semibold text-foreground">Per-VA overrides</span>
            {users
              .filter((u) => u.role === 'va' || u.role === 'manager')
              .map((u) => {
                const t = StorageService.getVATarget(u.id);
                return (
                  <div key={u.id} className="flex items-center gap-2 p-2 rounded-lg bg-surface-200">
                    <span className="text-sm text-foreground flex-1 truncate">{u.name}</span>
                    <div className="flex items-center gap-1.5">
                      <NumberInput
                        min={0}
                        defaultValue={t.dailyTarget}
                        onBlur={(e) =>
                          StorageService.setVATarget({ ...t, userId: u.id, dailyTarget: Number(e.target.value) })
                        }
                        className="w-20"
                      />
                      <span className="text-[11px] text-muted">/day</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <NumberInput
                        min={0}
                        defaultValue={t.weeklyTarget}
                        onBlur={(e) =>
                          StorageService.setVATarget({ ...t, userId: u.id, weeklyTarget: Number(e.target.value) })
                        }
                        className="w-20"
                      />
                      <span className="text-[11px] text-muted">/wk</span>
                    </div>
                  </div>
                );
              })}
            <p className="text-[11px] text-muted">Per-VA targets save on blur.</p>
          </div>
        </SectionCard>
      </div>
    </div>
  );
};

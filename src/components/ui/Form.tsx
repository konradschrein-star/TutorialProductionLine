import React, { useState, KeyboardEvent } from 'react';
import { X, Plus } from 'lucide-react';

export const Field: React.FC<{ label: string; hint?: string; children: React.ReactNode; className?: string }> = ({
  label,
  hint,
  children,
  className = '',
}) => (
  <label className={`block ${className}`}>
    <span className="block text-xs font-semibold text-foreground mb-1.5">{label}</span>
    {children}
    {hint && <span className="block text-[11px] text-muted mt-1">{hint}</span>}
  </label>
);

export const TextInput: React.FC<React.InputHTMLAttributes<HTMLInputElement>> = ({ className = '', ...props }) => (
  <input {...props} className={`pro-input focus-ring rounded-md px-3 py-2 text-sm w-full ${className}`} />
);

export const NumberInput: React.FC<React.InputHTMLAttributes<HTMLInputElement>> = ({ className = '', ...props }) => (
  <input type="number" {...props} className={`pro-input focus-ring rounded-md px-3 py-2 text-sm w-full ${className}`} />
);

export const Select: React.FC<React.SelectHTMLAttributes<HTMLSelectElement>> = ({ className = '', children, ...props }) => (
  <select {...props} className={`pro-input focus-ring rounded-md px-3 py-2 text-sm w-full ${className}`}>
    {children}
  </select>
);

export const Toggle: React.FC<{ checked: boolean; onChange: (v: boolean) => void; label?: string }> = ({
  checked,
  onChange,
  label,
}) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    onClick={() => onChange(!checked)}
    className="inline-flex items-center gap-2 focus-ring rounded-md"
  >
    <span
      className={`relative w-9 h-5 rounded-full transition-colors ${checked ? 'bg-accent' : 'bg-surface-300'}`}
    >
      <span
        className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
          checked ? 'translate-x-4' : ''
        }`}
      />
    </span>
    {label && <span className="text-sm text-foreground">{label}</span>}
  </button>
);

/** Chip-based multi-value editor for free-text tags. */
export const TagInput: React.FC<{
  values: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
}> = ({ values, onChange, placeholder }) => {
  const [draft, setDraft] = useState('');
  const add = () => {
    const v = draft.trim();
    if (v && !values.includes(v)) onChange([...values, v]);
    setDraft('');
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      add();
    } else if (e.key === 'Backspace' && !draft && values.length) {
      onChange(values.slice(0, -1));
    }
  };
  return (
    <div className="pro-input rounded-md px-2 py-1.5 flex flex-wrap gap-1.5 items-center min-h-[2.5rem]">
      {values.map((v) => (
        <span key={v} className="badge badge-accent gap-1">
          {v}
          <button type="button" onClick={() => onChange(values.filter((x) => x !== v))} aria-label={`Remove ${v}`}>
            <X size={11} />
          </button>
        </span>
      ))}
      <span className="flex items-center gap-1 flex-1 min-w-[6rem]">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKey}
          onBlur={add}
          placeholder={placeholder || 'Add…'}
          className="bg-transparent outline-none text-sm flex-1 min-w-0"
        />
        {draft && (
          <button type="button" onClick={add} className="text-muted hover:text-foreground" aria-label="Add tag">
            <Plus size={14} />
          </button>
        )}
      </span>
    </div>
  );
};

export const SectionCard: React.FC<{
  title: string;
  description?: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
  actions?: React.ReactNode;
}> = ({ title, description, icon, children, actions }) => (
  <section className="pro-panel rounded-xl p-5">
    <div className="flex items-start justify-between gap-3 mb-4">
      <div className="flex items-start gap-3">
        {icon && <span className="text-accent mt-0.5">{icon}</span>}
        <div>
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          {description && <p className="text-xs text-muted mt-0.5">{description}</p>}
        </div>
      </div>
      {actions}
    </div>
    {children}
  </section>
);

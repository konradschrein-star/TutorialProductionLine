import { cn } from '@/lib/utils';
import type { SelectHTMLAttributes } from 'react';

interface V2SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  helperText?: string;
  fullWidth?: boolean;
  options: Array<{ value: string; label: string }>;
}

/**
 * V2 Select Component
 *
 * Dropdown select with consistent V2 styling.
 * Supports labels, error states, and helper text.
 */
export function V2Select({
  label,
  error,
  helperText,
  fullWidth,
  options,
  className,
  ...props
}: V2SelectProps) {
  return (
    <div className={cn('flex flex-col gap-1.5', fullWidth && 'w-full')}>
      {label && (
        <label
          htmlFor={props.id}
          className="text-[10px] font-bold text-[var(--v2-text-2)] uppercase tracking-wider"
        >
          {label}
        </label>
      )}
      <select
        className={cn(
          'px-3 py-2 bg-[var(--v2-surface-2)] border border-[var(--v2-border-1)]',
          'rounded-lg text-[13px] text-[var(--v2-text-1)] font-medium',
          'focus:outline-none focus:ring-2 focus:ring-[var(--v2-accent)]/30 focus:border-[var(--v2-accent)]',
          'transition-all duration-150 cursor-pointer',
          error && 'border-[var(--v2-error)] focus:ring-[var(--v2-error)]/30',
          'disabled:opacity-50 disabled:cursor-not-allowed',
          className
        )}
        {...props}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {error && (
        <span className="text-[11px] text-[var(--v2-error)] font-medium">
          {error}
        </span>
      )}
      {helperText && !error && (
        <span className="text-[10px] text-[var(--v2-text-3)]">
          {helperText}
        </span>
      )}
    </div>
  );
}

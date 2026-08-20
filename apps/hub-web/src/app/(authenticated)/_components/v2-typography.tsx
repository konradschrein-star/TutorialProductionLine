import { cn } from '@/lib/utils';
import type { ReactNode } from 'react';

interface V2HeadingProps {
  children: ReactNode;
  level?: 1 | 2 | 3;
  className?: string;
}

/**
 * V2 Heading Component
 *
 * Consistent heading typography across V2.
 */
export function V2Heading({ children, level = 1, className }: V2HeadingProps) {
  const levelClasses = {
    1: 'text-[20px] font-extrabold text-[var(--v2-text-1)]',
    2: 'text-[11px] font-bold text-[var(--v2-text-2)] uppercase tracking-wider',
    3: 'text-[13px] font-bold text-[var(--v2-text-1)]',
  };

  const Tag = level === 1 ? 'h1' : level === 2 ? 'h2' : 'h3';

  return (
    <Tag className={cn(levelClasses[level], className)}>
      {children}
    </Tag>
  );
}

interface V2TextProps {
  children: ReactNode;
  variant?: 'body' | 'caption' | 'small';
  muted?: boolean;
  className?: string;
}

/**
 * V2 Text Component
 *
 * Consistent body text typography across V2.
 */
export function V2Text({ children, variant = 'body', muted, className }: V2TextProps) {
  const variantClasses = {
    body: 'text-[13px]',
    caption: 'text-[11px]',
    small: 'text-[10px]',
  };

  const colorClass = muted ? 'text-[var(--v2-text-3)]' : 'text-[var(--v2-text-2)]';

  return (
    <p className={cn(variantClasses[variant], colorClass, className)}>
      {children}
    </p>
  );
}

interface V2LabelProps {
  children: ReactNode;
  htmlFor?: string;
  required?: boolean;
  className?: string;
}

/**
 * V2 Label Component
 *
 * Consistent label styling for forms.
 */
export function V2Label({ children, htmlFor, required, className }: V2LabelProps) {
  return (
    <label
      htmlFor={htmlFor}
      className={cn(
        'text-[10px] font-bold text-[var(--v2-text-2)] uppercase tracking-wider',
        className
      )}
    >
      {children}
      {required && <span className="text-[var(--v2-error)] ml-1">*</span>}
    </label>
  );
}

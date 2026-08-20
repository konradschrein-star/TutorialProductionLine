import { cn } from '@/lib/utils';
import type { ReactNode } from 'react';

interface V2MetaFieldProps {
  label: string;
  value: ReactNode;
}

/**
 * V2 Meta Field Component
 *
 * Single metadata field with label and value.
 * Used within V2MetaGrid.
 */
export function V2MetaField({ label, value }: V2MetaFieldProps) {
  return (
    <div className="flex flex-col gap-1">
      <p className="text-[10px] text-[var(--v2-text-3)] uppercase tracking-wider font-semibold">
        {label}
      </p>
      <div className="text-[13px] text-[var(--v2-text-1)] font-medium">
        {value}
      </div>
    </div>
  );
}

interface V2MetaGridProps {
  children: ReactNode;
  columns?: 1 | 2 | 3 | 4;
  className?: string;
}

/**
 * V2 Meta Grid Component
 *
 * Grid layout for displaying metadata fields.
 * Typically used with V2MetaField components.
 */
export function V2MetaGrid({ children, columns = 2, className }: V2MetaGridProps) {
  const columnClasses = {
    1: 'grid-cols-1',
    2: 'grid-cols-1 sm:grid-cols-2',
    3: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
    4: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4',
  };

  return (
    <div className={cn('grid gap-6', columnClasses[columns], className)}>
      {children}
    </div>
  );
}

'use client';

import { cn } from '@/lib/utils';
import type { ReactNode } from 'react';

export interface V2Tab {
  id: string;
  label: string;
  icon?: ReactNode;
  badge?: number;
}

interface V2TabNavProps {
  tabs: V2Tab[];
  activeTab: string;
  onChange: (tabId: string) => void;
  className?: string;
}

/**
 * V2 Tab Navigation Component
 *
 * Horizontal tab navigation with consistent V2 styling.
 * Supports icons and badge counts.
 */
export function V2TabNav({ tabs, activeTab, onChange, className }: V2TabNavProps) {
  return (
    <div
      className={cn(
        'flex items-center gap-2 border-b border-[var(--v2-border-1)] pb-px',
        className
      )}
    >
      {tabs.map((tab) => {
        const isActive = tab.id === activeTab;

        return (
          <button
            key={tab.id}
            onClick={() => onChange(tab.id)}
            className={cn(
              'flex items-center gap-2 px-4 py-2.5 text-[11px] font-bold uppercase tracking-wide',
              'transition-all duration-150 relative',
              isActive
                ? 'text-[var(--v2-accent)] border-b-2 border-[var(--v2-accent)] -mb-px'
                : 'text-[var(--v2-text-2)] hover:text-[var(--v2-text-1)] border-b-2 border-transparent -mb-px'
            )}
          >
            {tab.icon}
            <span>{tab.label}</span>
            {tab.badge !== undefined && tab.badge > 0 && (
              <span
                className={cn(
                  'px-1.5 py-0.5 text-[9px] font-bold rounded-full',
                  isActive
                    ? 'bg-[var(--v2-accent)] text-black'
                    : 'bg-[var(--v2-surface-3)] text-[var(--v2-text-2)]'
                )}
              >
                {tab.badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

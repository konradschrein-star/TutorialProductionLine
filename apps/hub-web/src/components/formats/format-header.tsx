import Link from 'next/link';
import { cn } from '@/lib/utils';
import {
  FORMAT_META,
  formatSlug,
  formatDisplayName,
} from '@/components/formats/format-card';

/**
 * Format Header Component
 *
 * Server component rendered at the top of a format workstation page.
 * Shows the format identity, high-level stats, and tab navigation.
 */

interface FormatHeaderProps {
  format: string;
  templateCount: number;
  totalJobs: number;
  activeJobs: number;
  activeTab: 'ingestion' | 'settings';
}

export function FormatHeader({
  format,
  templateCount,
  totalJobs,
  activeJobs,
  activeTab,
}: FormatHeaderProps) {
  const slug = formatSlug(format);
  const name = formatDisplayName(format);
  const meta = FORMAT_META[format];
  const Icon = meta?.icon;

  const tabs = [
    { key: 'ingestion' as const, label: 'Ingestion', href: `/formats/${slug}` },
    { key: 'settings' as const, label: 'Settings', href: `/formats/${slug}?tab=settings` },
  ];

  return (
    <div className="space-y-4">
      {/* Title row */}
      <div className="flex items-center gap-4">
        {Icon && (
          <Icon className="w-9 h-9 text-primary" />
        )}
        <h1 className="text-3xl font-bold text-text">{name}</h1>
      </div>

      {/* Stats line */}
      <p className="text-text-muted text-sm">
        {templateCount} active template{templateCount !== 1 ? 's' : ''} |{' '}
        {totalJobs} total job{totalJobs !== 1 ? 's' : ''} |{' '}
        {activeJobs} active
      </p>

      {/* Tab navigation */}
      <div className="flex gap-2 border-b border-surface-bright">
        {tabs.map((tab) => (
          <Link
            key={tab.key}
            href={tab.href}
            className={cn(
              'px-4 py-2 text-sm transition-colors',
              activeTab === tab.key
                ? 'border-b-2 border-primary text-primary font-semibold'
                : 'text-text-muted hover:text-text'
            )}
          >
            {tab.label}
          </Link>
        ))}
      </div>
    </div>
  );
}

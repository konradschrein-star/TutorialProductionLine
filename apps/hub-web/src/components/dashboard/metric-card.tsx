import { type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Metric Card Component
 *
 * A high-tech, deeply hierarchical glass-card for key metrics.
 * Follows the "Obsidian Pulse" aesthetic standards.
 */

interface MetricCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: LucideIcon;
  variant?: 'default' | 'primary' | 'success' | 'warning' | 'error';
  pulse?: boolean;
  className?: string;
}

const VARIANT_STYLES = {
  default: 'text-text shadow-[0_0_15px_hsl(var(--foreground)/0.1)]',
  primary: 'text-primary shadow-[0_0_15px_hsl(var(--primary)/0.2)]',
  success: 'text-success shadow-[0_0_15px_hsl(var(--success)/0.2)]',
  warning: 'text-warning shadow-[0_0_15px_hsl(var(--warning)/0.2)]',
  error: 'text-error shadow-[0_0_15px_hsl(var(--error)/0.2)]',
};

const VARIANT_BG = {
  default: 'bg-text',
  primary: 'bg-primary',
  success: 'bg-success',
  warning: 'bg-warning',
  error: 'bg-error',
};

export function MetricCard({
  title,
  value,
  subtitle,
  icon: Icon,
  variant = 'default',
  pulse = false,
  className,
}: MetricCardProps) {
  const textColorClass = variant === 'default' ? 'text-text' : VARIANT_STYLES[variant].split(' ')[0];
  const shadowClass = VARIANT_STYLES[variant].split(' ')[1];
  const bgColorClass = VARIANT_BG[variant];

  return (
    <div
      className={cn(
        'glass-card p-5 rounded-xl flex flex-col justify-between hover:bg-surface-bright/50 transition-all duration-300 group',
        className
      )}
    >
      <div className="flex justify-between items-start mb-2">
        <div className="flex items-center gap-2">
          {pulse && (
            <span className={cn('w-1.5 h-1.5 rounded-full pulse-dot', bgColorClass)}></span>
          )}
          <span className="text-[10px] font-semibold text-text-muted uppercase tracking-widest">
            {title}
          </span>
        </div>
        <Icon className="w-4 h-4 text-text-muted/40 group-hover:text-primary transition-colors duration-300" />
      </div>
      
      <div className="flex items-end gap-3 mt-2">
        <span className={cn('text-3xl font-black', textColorClass, shadowClass)}>
          {value}
        </span>
        {subtitle && (
          <span className="text-[10px] text-text-muted mb-1 font-medium">{subtitle}</span>
        )}
      </div>

      {/* Decorative high-tech bottom bar */}
      <div className="mt-4 flex gap-1 h-1 w-full overflow-hidden opacity-50 group-hover:opacity-100 transition-opacity">
        <div className={cn('flex-1 rounded-full', bgColorClass)}></div>
        <div className={cn('flex-[2] rounded-full opacity-30', bgColorClass)}></div>
        <div className="flex-[8] bg-surface-bright rounded-full"></div>
      </div>
    </div>
  );
}

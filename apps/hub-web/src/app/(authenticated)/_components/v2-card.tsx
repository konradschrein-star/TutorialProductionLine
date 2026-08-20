import { cn } from "@/lib/utils";
import type { CSSProperties, ReactNode } from "react";

interface V2CardProps {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  noPadding?: boolean;
  onClick?: () => void;
  hover?: boolean;
}

/**
 * V2 Glass Card Component
 *
 * Standard card container with glassmorphic effect and consistent styling.
 * Uses V2 design tokens for surfaces, borders, and spacing.
 */
export function V2Card({
  children,
  className,
  style,
  noPadding,
  onClick,
  hover,
}: V2CardProps) {
  const isInteractive = !!onClick;

  return (
    <div
      className={cn(
        "backdrop-blur-xl border rounded-lg",
        "bg-[var(--v2-surface-1)] border-[var(--v2-border-1)]",
        !noPadding && "p-6",
        isInteractive && "cursor-pointer transition-all duration-200",
        (isInteractive || hover) &&
          "hover:border-[var(--v2-border-2)] hover:shadow-lg hover:shadow-black/20",
        className,
      )}
      style={style}
      onClick={onClick}
      role={isInteractive ? "button" : undefined}
      tabIndex={isInteractive ? 0 : undefined}
    >
      {children}
    </div>
  );
}

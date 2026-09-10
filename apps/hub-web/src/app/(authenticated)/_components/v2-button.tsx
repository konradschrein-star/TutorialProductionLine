import { cn } from "@/lib/utils";
import type { MouseEvent, ReactNode } from "react";

interface V2ButtonProps {
  children: ReactNode;
  variant?: "default" | "accent" | "outline" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
  className?: string;
  onClick?: (e: MouseEvent<HTMLButtonElement>) => void;
  disabled?: boolean;
  type?: "button" | "submit" | "reset";
  title?: string;
}

/**
 * V2 Button Component
 *
 * Consistent button styling using V2 design tokens.
 *
 * Variants:
 * - default: Dark grey, neutral (secondary actions)
 * - accent: Theme-colored fill (primary CTAs)
 * - outline: Transparent with border
 * - ghost: No background, minimal styling
 * - danger: Red destructive actions
 */
export function V2Button({
  children,
  variant = "default",
  size = "md",
  className,
  onClick,
  disabled,
  type = "button",
  title,
}: V2ButtonProps) {
  const baseClasses =
    "inline-flex items-center justify-center gap-2 font-medium transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed";

  const variantClasses = {
    default: "v2-btn",
    accent: "v2-btn-accent",
    outline: "v2-btn-outline",
    ghost:
      "bg-transparent hover:bg-[var(--v2-surface-2)] text-[var(--v2-text-2)] hover:text-[var(--v2-text-1)]",
    danger:
      "bg-[var(--v2-error)] hover:bg-[var(--v2-error)] text-white border border-[var(--v2-error)] hover:border-[var(--v2-error)]",
  };

  const sizeClasses = {
    sm: "px-3 py-1.5 text-[13px] rounded-md",
    md: "px-4 py-2 text-[14px] rounded-md",
    lg: "px-6 py-3 text-[15px] rounded-lg",
  };

  return (
    <button
      type={type}
      className={cn(
        baseClasses,
        variantClasses[variant],
        sizeClasses[size],
        className,
      )}
      onClick={onClick}
      disabled={disabled}
      title={title}
    >
      {children}
    </button>
  );
}

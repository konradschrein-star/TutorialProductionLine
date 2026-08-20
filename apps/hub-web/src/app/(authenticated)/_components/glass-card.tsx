import type { ReactNode, CSSProperties } from "react";

interface GlassCardProps {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  onClick?: () => void;
}

export function GlassCard({
  children,
  className = "",
  style,
  onClick,
}: GlassCardProps) {
  return (
    <div
      className={`rounded-xl ${className}`}
      style={{
        background: "rgba(255, 255, 255, 0.04)",
        backdropFilter: "blur(20px)",
        border: "1px solid rgba(255, 255, 255, 0.09)",
        ...style,
      }}
      onClick={onClick}
    >
      {children}
    </div>
  );
}

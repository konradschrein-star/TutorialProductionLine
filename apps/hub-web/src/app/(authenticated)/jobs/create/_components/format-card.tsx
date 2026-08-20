'use client';

import { useState } from 'react';

interface FormatCardProps {
  id: string;
  name: string;
  description: string;
  icon: string;
  href: string;
}

export function FormatCard({ id, name, description, icon, href }: FormatCardProps) {
  const [isHovered, setIsHovered] = useState(false);

  return (
    <a
      key={id}
      href={href}
      style={{
        padding: 20,
        background: isHovered ? 'rgba(170,255,0,0.08)' : 'rgba(255,255,255,0.02)',
        border: `1px solid ${isHovered ? 'rgba(170,255,0,0.3)' : 'rgba(170,255,0,0.1)'}`,
        borderRadius: 12,
        textDecoration: 'none',
        color: 'inherit',
        transition: 'all 0.2s ease',
        display: 'block',
        transform: isHovered ? 'translateY(-2px)' : 'translateY(0)',
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
        <span style={{ fontSize: 24 }}>
          {icon}
        </span>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>
          {name}
        </h3>
      </div>
      <p style={{ margin: 0, fontSize: 13, color: 'rgba(205,195,215,0.6)', lineHeight: 1.5 }}>
        {description}
      </p>
    </a>
  );
}

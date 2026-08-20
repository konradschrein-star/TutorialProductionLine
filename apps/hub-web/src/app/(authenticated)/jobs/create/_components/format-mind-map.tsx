'use client';

/**
 * Format Mind Map Component
 *
 * Displays all available content formats in a hierarchical mind map visualization.
 * Shows formats as primary nodes branching from a central "Create Content" node.
 */

import { useRouter } from 'next/navigation';

interface FormatMetadata {
  id: string;
  name: string;
  description: string;
  icon?: string;
  version: string;
}

interface FormatMindMapProps {
  formats: FormatMetadata[];
}

export function FormatMindMap({ formats }: FormatMindMapProps) {
  const router = useRouter();

  const handleFormatClick = (formatId: string) => {
    const formatSlug = formatId.toLowerCase().replace(/_/g, '-');
    router.push(`/jobs/create/${formatSlug}`);
  };

  // Calculate positions for formats in a circle around the center
  const centerX = 400;
  const centerY = 300;
  const radius = 200;

  const formatNodes = formats.map((format, index) => {
    const angle = (index / formats.length) * 2 * Math.PI - Math.PI / 2;
    const x = centerX + radius * Math.cos(angle);
    const y = centerY + radius * Math.sin(angle);

    return {
      format,
      x,
      y,
      angle,
    };
  });

  return (
    <div style={{ width: '100%', height: '700px', position: 'relative', background: 'rgba(0,0,0,0.2)', borderRadius: 12, overflow: 'hidden' }}>
      <svg width="100%" height="100%" style={{ position: 'absolute', top: 0, left: 0 }}>
        {/* Connection lines from center to formats */}
        {formatNodes.map((node, index) => (
          <line
            key={`line-${index}`}
            x1={centerX}
            y1={centerY}
            x2={node.x}
            y2={node.y}
            stroke="rgba(139, 92, 246, 0.3)"
            strokeWidth={2}
            strokeDasharray="5,5"
          />
        ))}
      </svg>

      {/* Center node */}
      <div
        style={{
          position: 'absolute',
          left: centerX - 80,
          top: centerY - 80,
          width: 160,
          height: 160,
          borderRadius: '50%',
          background: 'linear-gradient(135deg, rgba(139, 92, 246, 0.8), rgba(59, 130, 246, 0.8))',
          border: '3px solid rgba(255,255,255,0.2)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'column',
          boxShadow: '0 8px 32px rgba(139, 92, 246, 0.4)',
          zIndex: 10,
        }}
      >
        <div style={{ fontSize: 32, marginBottom: 4 }}>🎬</div>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'white', textAlign: 'center' }}>
          Create
          <br />
          Content
        </div>
      </div>

      {/* Format nodes */}
      {formatNodes.map((node, index) => {
        const { format, x, y } = node;

        return (
          <div
            key={format.id}
            onClick={() => handleFormatClick(format.id)}
            style={{
              position: 'absolute',
              left: x - 75,
              top: y - 60,
              width: 150,
              padding: '16px',
              borderRadius: 12,
              background: 'rgba(30, 30, 40, 0.95)',
              border: '2px solid rgba(139, 92, 246, 0.4)',
              cursor: 'pointer',
              transition: 'all 0.3s ease',
              zIndex: 5,
              boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'scale(1.1)';
              e.currentTarget.style.borderColor = 'rgba(139, 92, 246, 0.8)';
              e.currentTarget.style.boxShadow = '0 8px 24px rgba(139, 92, 246, 0.4)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'scale(1)';
              e.currentTarget.style.borderColor = 'rgba(139, 92, 246, 0.4)';
              e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.3)';
            }}
          >
            <div style={{ fontSize: 24, marginBottom: 8, textAlign: 'center' }}>
              {format.icon || '📄'}
            </div>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#e5e2e1', textAlign: 'center', marginBottom: 4 }}>
              {format.name}
            </div>
            <div style={{ fontSize: 10, color: 'rgba(205,195,215,0.6)', textAlign: 'center', lineHeight: 1.3 }}>
              {format.description.slice(0, 60)}
              {format.description.length > 60 ? '...' : ''}
            </div>
          </div>
        );
      })}

      {/* Format count */}
      <div style={{ position: 'absolute', bottom: 16, right: 16, fontSize: 12, color: 'rgba(205,195,215,0.5)' }}>
        {formats.length} format{formats.length !== 1 ? 's' : ''} available
      </div>
    </div>
  );
}

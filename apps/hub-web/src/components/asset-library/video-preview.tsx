'use client';

import { useState } from 'react';

interface VideoPreviewProps {
  assetId: string;
  name: string;
}

export function VideoPreview({ assetId, name }: VideoPreviewProps) {
  const [error, setError] = useState(false);

  const handleError = () => {
    setError(true);
  };

  if (error) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: 400,
          gap: 12,
          padding: 40,
          color: 'var(--v2-text-2)',
          background: 'rgba(0, 0, 0, 0.8)',
          borderRadius: 8,
        }}
      >
        <span
          className="material-symbols-outlined"
          style={{ fontSize: 48, opacity: 0.3 }}
        >
          videocam_off
        </span>
        <p style={{ margin: 0, fontSize: 14 }}>
          Failed to load video
        </p>
        <p style={{ margin: 0, fontSize: 12, opacity: 0.7 }}>
          The video file may be missing or in an unsupported format
        </p>
      </div>
    );
  }

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0, 0, 0, 0.9)',
        borderRadius: 8,
      }}
    >
      <video
        data-testid="video-player"
        src={`/api/assets/${assetId}/stream`}
        controls
        preload="metadata"
        style={{
          maxWidth: '100%',
          maxHeight: 600,
          width: '100%',
        }}
        onError={handleError}
      >
        Your browser does not support the video tag.
      </video>
    </div>
  );
}

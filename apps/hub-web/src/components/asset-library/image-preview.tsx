'use client';

import { useState } from 'react';

interface ImagePreviewProps {
  assetId: string;
  name: string;
}

export function ImagePreview({ assetId, name }: ImagePreviewProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const handleLoad = () => {
    setLoading(false);
  };

  const handleError = () => {
    setLoading(false);
    setError(true);
  };

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 400,
        maxHeight: 600,
        position: 'relative',
        background: 'rgba(0, 0, 0, 0.8)',
        borderRadius: 8,
      }}
    >
      {loading && !error && (
        <div
          style={{
            position: 'absolute',
            color: 'var(--v2-text-2)',
            fontSize: 14,
          }}
        >
          Loading...
        </div>
      )}

      {error ? (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 12,
            padding: 40,
            color: 'var(--v2-text-2)',
          }}
        >
          <span
            className="material-symbols-outlined"
            style={{ fontSize: 48, opacity: 0.3 }}
          >
            broken_image
          </span>
          <p style={{ margin: 0, fontSize: 14 }}>
            Failed to load image
          </p>
        </div>
      ) : (
        <img
          src={`/api/assets/${assetId}/stream`}
          alt={name}
          onLoad={handleLoad}
          onError={handleError}
          style={{
            maxWidth: '100%',
            maxHeight: 600,
            objectFit: 'contain',
            display: loading ? 'none' : 'block',
          }}
        />
      )}
    </div>
  );
}

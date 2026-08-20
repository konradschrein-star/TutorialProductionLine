'use client';

import { useCallback, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import type { AssetZoneDefinition } from '@/lib/asset-type-registry';
import { validateFileForZone, formatSizeLimit } from '@/lib/asset-type-registry';

export interface DropZoneAsset {
  file: File;
  preview?: string; // For images/videos
  zoneId: string;
}

interface DropZoneCardProps {
  zone: AssetZoneDefinition;
  assets: DropZoneAsset[];
  onDrop: (files: File[], zoneId: string) => void;
  onRemove: (file: File, zoneId: string) => void;
  onMediaAssetDrop?: (assetData: any, zoneId: string) => void;
  disabled?: boolean;
}

export function DropZoneCard({
  zone,
  assets,
  onDrop,
  onRemove,
  onMediaAssetDrop,
  disabled = false,
}: DropZoneCardProps) {
  const [validationError, setValidationError] = useState<string | null>(null);

  const handleDrop = useCallback(
    (acceptedFiles: File[]) => {
      setValidationError(null);

      // Validate each file
      const validFiles: File[] = [];
      for (const file of acceptedFiles) {
        const validation = validateFileForZone(file, zone);
        if (!validation.valid) {
          setValidationError(validation.error ?? 'Invalid file');
          continue;
        }

        // Check max files
        if (zone.maxFiles !== null && assets.length + validFiles.length >= zone.maxFiles) {
          setValidationError(`Maximum ${zone.maxFiles} file(s) allowed`);
          break;
        }

        validFiles.push(file);
      }

      if (validFiles.length > 0) {
        onDrop(validFiles, zone.id);
      }
    },
    [zone, assets.length, onDrop]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: handleDrop,
    accept: zone.accept.reduce(
      (acc, ext) => {
        // Map extensions to MIME types
        const mimeMap: Record<string, string[]> = {
          '.mp4': ['video/mp4'],
          '.mov': ['video/quicktime'],
          '.avi': ['video/x-msvideo'],
          '.mkv': ['video/x-matroska'],
          '.txt': ['text/plain'],
          '.md': ['text/markdown', 'text/plain'],
          '.srt': ['application/x-subrip'],
          '.vtt': ['text/vtt'],
          '.jpg': ['image/jpeg'],
          '.jpeg': ['image/jpeg'],
          '.png': ['image/png'],
          '.webp': ['image/webp'],
          '.pdf': ['application/pdf'],
        };

        const mimes = mimeMap[ext] ?? [];
        for (const mime of mimes) {
          if (!acc[mime]) acc[mime] = [];
          acc[mime].push(ext);
        }
        return acc;
      },
      {} as Record<string, string[]>
    ),
    disabled,
    maxSize: zone.maxSize ?? undefined,
    noClick: false,
    noKeyboard: false,
  });

  // Custom drop handler to intercept media library assets
  const handleCustomDrop = useCallback((e: React.DragEvent) => {
    // Check if this is a media asset from library
    const dataStr = e.dataTransfer.getData('application/json');
    if (dataStr) {
      try {
        const data = JSON.parse(dataStr);
        if (data.source === 'media-library' && onMediaAssetDrop) {
          e.preventDefault();
          e.stopPropagation();
          onMediaAssetDrop(data, zone.id);
          return;
        }
      } catch {
        // Not JSON or invalid - let react-dropzone handle it
      }
    }
    // If not a media library asset, let react-dropzone handle file drops
    // (react-dropzone will process this via the onDrop callback)
  }, [zone.id, onMediaAssetDrop]);

  const hasAssets = assets.length > 0;
  const isFull = zone.maxFiles !== null && assets.length >= zone.maxFiles;

  // Merge getRootProps with custom drop handler
  const rootProps = getRootProps();
  const mergedOnDrop = useCallback((e: React.DragEvent) => {
    handleCustomDrop(e);
    // If not prevented by handleCustomDrop, let react-dropzone handle it
    if (!e.defaultPrevented && rootProps.onDrop) {
      rootProps.onDrop(e as any);
    }
  }, [handleCustomDrop, rootProps.onDrop]);

  return (
    <div
      style={{
        background: 'rgba(255,255,255,0.02)',
        border: zone.required
          ? '1px solid rgba(var(--v2-accent-rgb), 0.3)'
          : '1px solid rgba(var(--v2-accent-rgb), 0.1)',
        borderRadius: 12,
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '12px 16px',
          background: 'rgba(0,0,0,0.2)',
          borderBottom: '1px solid rgba(255,255,255,0.05)',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
        }}
      >
        <span
          className="material-symbols-outlined"
          style={{
            fontSize: 18,
            color: zone.required ? 'var(--v2-accent)' : 'rgba(205,195,215,0.5)',
          }}
        >
          {zone.icon}
        </span>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: '#e5e2e1' }}>
              {zone.label}
            </span>
            {zone.required && (
              <span
                style={{
                  fontSize: 9,
                  color: 'var(--v2-accent)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                  fontWeight: 600,
                }}
              >
                Required
              </span>
            )}
          </div>
        </div>
        {hasAssets && (
          <span
            style={{
              fontSize: 10,
              color: 'rgba(205,195,215,0.6)',
            }}
          >
            {assets.length}
            {zone.maxFiles !== null && ` / ${zone.maxFiles}`}
          </span>
        )}
      </div>

      {/* Drop zone or asset list */}
      <div style={{ padding: 16 }}>
        {!hasAssets || !isFull ? (
          <div
            {...rootProps}
            onDrop={mergedOnDrop}
            style={{
              padding: 24,
              border: isDragActive
                ? '2px dashed var(--v2-accent)'
                : '2px dashed rgba(var(--v2-accent-rgb), 0.2)',
              borderRadius: 8,
              background: isDragActive
                ? 'rgba(var(--v2-accent-rgb), 0.1)'
                : 'rgba(255,255,255,0.02)',
              cursor: disabled || isFull ? 'not-allowed' : 'pointer',
              transition: 'all 0.2s ease',
              textAlign: 'center',
              opacity: disabled ? 0.5 : 1,
            }}
          >
            <input {...getInputProps()} />
            <span
              className="material-symbols-outlined"
              style={{
                fontSize: 32,
                color: isDragActive
                  ? 'var(--v2-accent)'
                  : 'rgba(205,195,215,0.3)',
                display: 'block',
                marginBottom: 8,
              }}
            >
              {isDragActive ? 'download' : 'upload'}
            </span>
            <p
              style={{
                fontSize: 12,
                color: '#e5e2e1',
                marginBottom: 4,
                fontWeight: 500,
              }}
            >
              {isDragActive ? 'Drop files here' : zone.hint}
            </p>
            <p style={{ fontSize: 10, color: 'rgba(205,195,215,0.5)', margin: 0 }}>
              Accepted: {zone.accept.join(', ')}
              {zone.maxSize && ` · Max: ${formatSizeLimit(zone.maxSize)}`}
            </p>
          </div>
        ) : null}

        {/* Validation error */}
        {validationError && (
          <div
            style={{
              marginTop: hasAssets ? 12 : 0,
              padding: '8px 12px',
              background: 'rgba(255,80,80,0.1)',
              border: '1px solid rgba(255,80,80,0.3)',
              borderRadius: 6,
              fontSize: 11,
              color: '#ff8080',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 14 }}>
              error
            </span>
            {validationError}
          </div>
        )}

        {/* Asset list */}
        {hasAssets && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: hasAssets && !isFull ? 12 : 0 }}>
            {assets.map((asset, idx) => (
              <AssetItem
                key={idx}
                asset={asset}
                onRemove={() => onRemove(asset.file, zone.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// Asset item component
function AssetItem({
  asset,
  onRemove,
}: {
  asset: DropZoneAsset;
  onRemove: () => void;
}) {
  const sizeKB = (asset.file.size / 1024).toFixed(1);
  const sizeMB = (asset.file.size / 1024 / 1024).toFixed(1);
  const sizeDisplay = asset.file.size > 1024 * 1024 ? `${sizeMB} MB` : `${sizeKB} KB`;

  const isImage = asset.file.type.startsWith('image/');
  const isVideo = asset.file.type.startsWith('video/');

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '10px 12px',
        background: 'rgba(255,255,255,0.03)',
        border: '1px solid rgba(var(--v2-accent-rgb), 0.15)',
        borderRadius: 8,
      }}
    >
      {/* Icon or preview */}
      <div
        style={{
          width: 36,
          height: 36,
          borderRadius: 6,
          background: 'rgba(var(--v2-accent-rgb), 0.1)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          overflow: 'hidden',
        }}
      >
        {asset.preview ? (
          <img
            src={asset.preview}
            alt={asset.file.name}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        ) : (
          <span
            className="material-symbols-outlined"
            style={{ fontSize: 20, color: 'var(--v2-accent)' }}
          >
            {isImage ? 'image' : isVideo ? 'videocam' : 'description'}
          </span>
        )}
      </div>

      {/* File info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 12,
            fontWeight: 500,
            color: '#e5e2e1',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {asset.file.name}
        </div>
        <div style={{ fontSize: 10, color: 'rgba(205,195,215,0.5)' }}>
          {sizeDisplay}
        </div>
      </div>

      {/* Remove button */}
      <button
        onClick={onRemove}
        style={{
          padding: 6,
          background: 'none',
          border: 'none',
          borderRadius: 6,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'rgba(255,80,80,0.15)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'none';
        }}
      >
        <span
          className="material-symbols-outlined"
          style={{ fontSize: 18, color: '#ff8080' }}
        >
          close
        </span>
      </button>
    </div>
  );
}

'use client';

import { useState } from 'react';
import type { AssetCardAsset } from './asset-card';

/**
 * CreateVariantModal Component
 *
 * Modal for creating a new variant relationship between assets.
 * Allows selecting an existing asset as a variant or uploading a new file.
 */

interface CreateVariantModalProps {
  parentAsset: AssetCardAsset;
  availableAssets: AssetCardAsset[];
  onClose: () => void;
  onCreateVariant: (parentId: string, variantId: string, variantType: string, variantMetadata: Record<string, unknown>) => Promise<void>;
}

const VARIANT_TYPES = [
  { value: 'original', label: 'Original', description: 'Source file with highest quality' },
  { value: 'compressed', label: 'Compressed', description: 'Reduced file size for faster loading' },
  { value: 'mobile', label: 'Mobile', description: 'Optimized for mobile devices' },
  { value: 'translated', label: 'Translated', description: 'Translated to different language' },
  { value: 'cropped', label: 'Cropped', description: 'Cropped or resized version' },
  { value: 'thumbnail', label: 'Thumbnail', description: 'Small preview image' },
];

export function CreateVariantModal({
  parentAsset,
  availableAssets,
  onClose,
  onCreateVariant,
}: CreateVariantModalProps) {
  const [selectedAssetId, setSelectedAssetId] = useState<string>('');
  const [variantType, setVariantType] = useState<string>('compressed');
  const [resolution, setResolution] = useState<string>('');
  const [language, setLanguage] = useState<string>('');
  const [bitrate, setBitrate] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filter out the parent asset and assets that are already variants
  const filteredAssets = availableAssets.filter((a) => a.id !== parentAsset.id);

  const handleSubmit = async () => {
    if (!selectedAssetId) {
      setError('Please select an asset');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const variantMetadata: Record<string, unknown> = {};
      if (resolution) variantMetadata.resolution = resolution;
      if (language) variantMetadata.language = language;
      if (bitrate) variantMetadata.bitrate = bitrate;

      await onCreateVariant(parentAsset.id, selectedAssetId, variantType, variantMetadata);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create variant');
      setIsSubmitting(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0, 0, 0, 0.7)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        backdropFilter: 'blur(4px)',
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'var(--v2-surface)',
          borderRadius: 12,
          width: '90%',
          maxWidth: 600,
          maxHeight: '90vh',
          overflow: 'auto',
          boxShadow: '0 24px 48px rgba(0, 0, 0, 0.4)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            padding: '20px 24px',
            borderBottom: '1px solid var(--v2-surface-bright)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div>
            <h2
              style={{
                fontSize: 18,
                fontWeight: 600,
                color: 'var(--v2-text-1)',
                margin: 0,
              }}
            >
              Create Asset Variant
            </h2>
            <p
              style={{
                fontSize: 13,
                color: 'var(--v2-text-2)',
                margin: '4px 0 0 0',
              }}
            >
              Link an existing asset as a variant of &quot;{parentAsset.name}&quot;
            </p>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              padding: 4,
              display: 'flex',
              alignItems: 'center',
              color: 'var(--v2-text-2)',
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 24 }}>
              close
            </span>
          </button>
        </div>

        {/* Content */}
        <div style={{ padding: 24 }}>
          {error && (
            <div
              style={{
                padding: 12,
                borderRadius: 6,
                background: 'rgba(239, 68, 68, 0.1)',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                color: '#EF4444',
                fontSize: 13,
                marginBottom: 16,
              }}
            >
              {error}
            </div>
          )}

          {/* Variant Type */}
          <div style={{ marginBottom: 20 }}>
            <label
              style={{
                display: 'block',
                fontSize: 13,
                fontWeight: 600,
                color: 'var(--v2-text-1)',
                marginBottom: 8,
              }}
            >
              Variant Type
            </label>
            <select
              value={variantType}
              onChange={(e) => setVariantType(e.target.value)}
              style={{
                width: '100%',
                padding: 10,
                borderRadius: 6,
                border: '1px solid var(--v2-surface-bright)',
                background: 'var(--v2-surface-container)',
                color: 'var(--v2-text-1)',
                fontSize: 13,
              }}
            >
              {VARIANT_TYPES.map((type) => (
                <option key={type.value} value={type.value}>
                  {type.label} — {type.description}
                </option>
              ))}
            </select>
          </div>

          {/* Select Asset */}
          <div style={{ marginBottom: 20 }}>
            <label
              style={{
                display: 'block',
                fontSize: 13,
                fontWeight: 600,
                color: 'var(--v2-text-1)',
                marginBottom: 8,
              }}
            >
              Select Asset
            </label>
            <select
              value={selectedAssetId}
              onChange={(e) => setSelectedAssetId(e.target.value)}
              style={{
                width: '100%',
                padding: 10,
                borderRadius: 6,
                border: '1px solid var(--v2-surface-bright)',
                background: 'var(--v2-surface-container)',
                color: 'var(--v2-text-1)',
                fontSize: 13,
              }}
            >
              <option value="">— Select an asset —</option>
              {filteredAssets.map((asset) => (
                <option key={asset.id} value={asset.id}>
                  {asset.name} ({asset.file_format})
                </option>
              ))}
            </select>
          </div>

          {/* Metadata Fields */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
            {/* Resolution */}
            <div>
              <label
                style={{
                  display: 'block',
                  fontSize: 13,
                  fontWeight: 600,
                  color: 'var(--v2-text-1)',
                  marginBottom: 8,
                }}
              >
                Resolution (optional)
              </label>
              <input
                type="text"
                value={resolution}
                onChange={(e) => setResolution(e.target.value)}
                placeholder="e.g., 1920x1080"
                style={{
                  width: '100%',
                  padding: 10,
                  borderRadius: 6,
                  border: '1px solid var(--v2-surface-bright)',
                  background: 'var(--v2-surface-container)',
                  color: 'var(--v2-text-1)',
                  fontSize: 13,
                }}
              />
            </div>

            {/* Language */}
            {variantType === 'translated' && (
              <div>
                <label
                  style={{
                    display: 'block',
                    fontSize: 13,
                    fontWeight: 600,
                    color: 'var(--v2-text-1)',
                    marginBottom: 8,
                  }}
                >
                  Language
                </label>
                <input
                  type="text"
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                  placeholder="e.g., es, fr, de"
                  style={{
                    width: '100%',
                    padding: 10,
                    borderRadius: 6,
                    border: '1px solid var(--v2-surface-bright)',
                    background: 'var(--v2-surface-container)',
                    color: 'var(--v2-text-1)',
                    fontSize: 13,
                  }}
                />
              </div>
            )}

            {/* Bitrate */}
            {(variantType === 'compressed' || variantType === 'mobile') && (
              <div>
                <label
                  style={{
                    display: 'block',
                    fontSize: 13,
                    fontWeight: 600,
                    color: 'var(--v2-text-1)',
                    marginBottom: 8,
                  }}
                >
                  Bitrate (optional)
                </label>
                <input
                  type="text"
                  value={bitrate}
                  onChange={(e) => setBitrate(e.target.value)}
                  placeholder="e.g., 2M, 5M"
                  style={{
                    width: '100%',
                    padding: 10,
                    borderRadius: 6,
                    border: '1px solid var(--v2-surface-bright)',
                    background: 'var(--v2-surface-container)',
                    color: 'var(--v2-text-1)',
                    fontSize: 13,
                  }}
                />
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            padding: '16px 24px',
            borderTop: '1px solid var(--v2-surface-bright)',
            display: 'flex',
            gap: 12,
            justifyContent: 'flex-end',
          }}
        >
          <button
            onClick={onClose}
            disabled={isSubmitting}
            style={{
              padding: '10px 20px',
              borderRadius: 6,
              border: '1px solid var(--v2-surface-bright)',
              background: 'transparent',
              color: 'var(--v2-text-1)',
              fontSize: 13,
              fontWeight: 500,
              cursor: 'pointer',
              transition: 'all 0.2s ease',
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={isSubmitting || !selectedAssetId}
            style={{
              padding: '10px 20px',
              borderRadius: 6,
              border: 'none',
              background: 'var(--v2-accent)',
              color: 'white',
              fontSize: 13,
              fontWeight: 600,
              cursor: isSubmitting || !selectedAssetId ? 'not-allowed' : 'pointer',
              opacity: isSubmitting || !selectedAssetId ? 0.5 : 1,
              transition: 'all 0.2s ease',
            }}
          >
            {isSubmitting ? 'Creating...' : 'Create Variant'}
          </button>
        </div>
      </div>
    </div>
  );
}

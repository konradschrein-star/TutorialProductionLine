'use client';

import { useState, useCallback, useRef } from 'react';
import JSZip from 'jszip';
import { DropZoneCard, type DropZoneAsset } from './drop-zone-card';
import { getAssetConfig } from '@/lib/asset-type-registry';

interface AssetDropZonesProps {
  format: string;
  onAssetsChange: (assets: Map<string, DropZoneAsset[]>) => void;
  onWarnings?: (warnings: string[]) => void;
  onJobsExtracted?: (jobs: Array<{ topic: string; assets: Map<string, File[]> }>) => void;
  onMediaAssetDrop?: (assetData: any, zoneId: string) => void;
}

export function AssetDropZones({
  format,
  onAssetsChange,
  onWarnings,
  onJobsExtracted,
  onMediaAssetDrop,
}: AssetDropZonesProps) {
  const [assetsByZone, setAssetsByZone] = useState<Map<string, DropZoneAsset[]>>(
    new Map()
  );
  const [zipStatus, setZipStatus] = useState<string>('');
  const [showOptionalZones, setShowOptionalZones] = useState(false);

  const config = getAssetConfig(format);

  const handleDrop = useCallback(
    async (files: File[], zoneId: string) => {
      const newAssets: DropZoneAsset[] = [];

      // Create previews for images
      for (const file of files) {
        let preview: string | undefined;

        if (file.type.startsWith('image/')) {
          try {
            preview = await new Promise((resolve) => {
              const reader = new FileReader();
              reader.onloadend = () => resolve(reader.result as string);
              reader.readAsDataURL(file);
            });
          } catch (err) {
            console.warn('Failed to create preview:', err);
          }
        }

        newAssets.push({
          file,
          preview,
          zoneId,
        });
      }

      // Update assets
      setAssetsByZone((prev) => {
        const next = new Map(prev);
        const existing = next.get(zoneId) ?? [];
        next.set(zoneId, [...existing, ...newAssets]);
        onAssetsChange(next);
        return next;
      });
    },
    [onAssetsChange]
  );

  // Handle media asset drops from library
  const handleMediaAssetDrop = useCallback(
    (assetData: any, zoneId: string) => {
      // Validate asset type matches zone requirements
      const zone = config.zones.find(z => z.id === zoneId);
      if (!zone) return;

      const assetExtensions: Record<string, string[]> = {
        video: ['.mp4', '.mov', '.avi', '.mkv'],
        audio: ['.mp3', '.wav', '.m4a'],
        image: ['.jpg', '.jpeg', '.png', '.webp'],
      };

      const extensions = assetExtensions[assetData.asset_type] || [];
      const isCompatible = extensions.some(ext => zone.accept.includes(ext));

      if (!isCompatible) {
        onWarnings?.([`Cannot drop ${assetData.asset_type} asset in ${zone.label}`]);
        return;
      }

      // Pass to parent callback if provided
      if (onMediaAssetDrop) {
        onMediaAssetDrop(assetData, zoneId);
      }
    },
    [config.zones, onWarnings, onMediaAssetDrop]
  );

  const handleRemove = useCallback(
    (file: File, zoneId: string) => {
      setAssetsByZone((prev) => {
        const next = new Map(prev);
        const existing = next.get(zoneId) ?? [];
        const filtered = existing.filter((a) => a.file !== file);

        if (filtered.length === 0) {
          next.delete(zoneId);
        } else {
          next.set(zoneId, filtered);
        }

        onAssetsChange(next);
        return next;
      });
    },
    [onAssetsChange]
  );

  // Handle ZIP upload and extraction
  const handleZipUpload = useCallback(
    async (zipFile: File) => {
      try {
        setZipStatus('Extracting ZIP...');
        const zip = await JSZip.loadAsync(zipFile);

        // Group files by folder
        const folderMap = new Map<string, File[]>();
        const warnings: string[] = [];

        for (const [path, zipEntry] of Object.entries(zip.files)) {
          if (zipEntry.dir) continue;

          // Extract folder name (first part of path)
          const parts = path.split('/').filter(Boolean);
          if (parts.length === 0) continue;

          const folderName = parts.length > 1 ? parts[0] : 'root';
          const fileName = parts[parts.length - 1];

          // Skip hidden files
          if (fileName.startsWith('.')) continue;

          // Get file extension
          const ext = '.' + (fileName.split('.').pop() ?? '').toLowerCase();

          // Check if this extension is accepted by any zone
          const acceptingZone = config.zones.find((z) => z.accept.includes(ext));
          if (!acceptingZone) {
            warnings.push(`Skipping ${fileName}: unsupported file type`);
            continue;
          }

          // Extract file as blob
          const blob = await zipEntry.async('blob');
          const file = new File([blob], fileName, { type: blob.type });

          // Group by folder
          if (!folderMap.has(folderName)) {
            folderMap.set(folderName, []);
          }
          folderMap.get(folderName)!.push(file);
        }

        if (warnings.length > 0) {
          onWarnings?.(warnings);
        }

        // Route files to zones and create jobs
        const extractedJobs: Array<{ topic: string; assets: Map<string, File[]> }> = [];

        for (const [folderName, files] of folderMap.entries()) {
          const jobAssets = new Map<string, File[]>();

          // Route each file to its appropriate zone
          for (const file of files) {
            const ext = '.' + (file.name.split('.').pop() ?? '').toLowerCase();
            const zone = config.zones.find((z) => z.accept.includes(ext));

            if (zone) {
              if (!jobAssets.has(zone.id)) {
                jobAssets.set(zone.id, []);
              }
              jobAssets.get(zone.id)!.push(file);
            }
          }

          // Create job from folder
          const topic = folderName
            .replace(/[-_]+/g, ' ')
            .replace(/\b\w/g, (c) => c.toUpperCase())
            .trim();

          extractedJobs.push({ topic, assets: jobAssets });
        }

        // Notify parent about extracted jobs
        if (extractedJobs.length > 0 && onJobsExtracted) {
          setZipStatus(`Extracted ${extractedJobs.length} job${extractedJobs.length !== 1 ? 's' : ''} from ZIP`);
          onJobsExtracted(extractedJobs);
        } else {
          setZipStatus('');
        }
      } catch (err) {
        const error = err instanceof Error ? err.message : 'Failed to extract ZIP';
        onWarnings?.([error]);
        setZipStatus('');
      }
    },
    [config.zones, onWarnings, onJobsExtracted]
  );

  if (config.zones.length === 0) {
    return (
      <div
        style={{
          padding: 40,
          textAlign: 'center',
          background: 'rgba(255,180,0,0.1)',
          border: '1px solid rgba(255,180,0,0.2)',
          borderRadius: 12,
        }}
      >
        <span
          className="material-symbols-outlined"
          style={{ fontSize: 48, color: '#ffb400' }}
        >
          warning
        </span>
        <p style={{ fontSize: 13, color: '#ffb400', marginTop: 12 }}>
          This format has no asset zones configured.
        </p>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 16 }}>
        <h3
          style={{
            fontSize: 12,
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            color: 'rgba(205,195,215,0.6)',
            margin: '0 0 4px 0',
          }}
        >
          Assets
        </h3>
        <p style={{ fontSize: 11, color: 'rgba(205,195,215,0.5)', margin: 0 }}>
          {config.notes
            ? config.notes
            : 'Drop files into the zones below or upload a ZIP containing structured assets'}
        </p>
      </div>

      {/* Drop zones grid */}
      {/* Optional zones toggle */}
      {config.zones.some(z => !z.required) && (
        <div style={{ marginBottom: 12 }}>
          <button
            onClick={() => setShowOptionalZones(!showOptionalZones)}
            style={{
              padding: '8px 14px',
              background: showOptionalZones
                ? 'rgba(var(--v2-accent-rgb), 0.15)'
                : 'rgba(255,255,255,0.03)',
              border: showOptionalZones
                ? '1px solid rgba(var(--v2-accent-rgb), 0.3)'
                : '1px solid rgba(255,255,255,0.09)',
              borderRadius: 6,
              color: showOptionalZones ? 'var(--v2-accent)' : 'rgba(205,195,215,0.7)',
              fontSize: 11,
              fontWeight: 500,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              transition: 'all 0.2s ease',
            }}
            onMouseEnter={(e) => {
              if (!showOptionalZones) {
                e.currentTarget.style.background = 'rgba(255,255,255,0.05)';
                e.currentTarget.style.borderColor = 'rgba(255,255,255,0.12)';
              }
            }}
            onMouseLeave={(e) => {
              if (!showOptionalZones) {
                e.currentTarget.style.background = 'rgba(255,255,255,0.03)';
                e.currentTarget.style.borderColor = 'rgba(255,255,255,0.09)';
              }
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 14 }}>
              {showOptionalZones ? 'visibility_off' : 'add_circle'}
            </span>
            {showOptionalZones ? 'Hide' : 'Show'} optional asset zones ({config.zones.filter(z => !z.required && !assetsByZone.has(z.id)).length})
          </button>
        </div>
      )}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
          gap: 16,
        }}
      >
        {config.zones
          .filter((zone) => {
            const assets = assetsByZone.get(zone.id) ?? [];
            const hasAssets = assets.length > 0;

            // Always show required zones
            if (zone.required) return true;

            // Always show optional zones that have assets
            if (hasAssets) return true;

            // Show optional empty zones only if user toggled them visible
            return showOptionalZones;
          })
          .map((zone) => {
            const assets = assetsByZone.get(zone.id) ?? [];
            return (
              <DropZoneCard
                key={zone.id}
                zone={zone}
                assets={assets}
                onDrop={handleDrop}
                onRemove={handleRemove}
                onMediaAssetDrop={handleMediaAssetDrop}
              />
            );
          })}

        {/* ZIP upload zone */}
        {config.supportsZip && (
          <ZipUploadZone onUpload={handleZipUpload} onProgress={setZipStatus} />
        )}
      </div>

      {/* ZIP status */}
      {zipStatus && (
        <div
          style={{
            marginTop: 12,
            padding: '8px 12px',
            background: 'rgba(var(--v2-accent-rgb), 0.1)',
            border: '1px solid rgba(var(--v2-accent-rgb), 0.2)',
            borderRadius: 6,
            fontSize: 11,
            color: 'var(--v2-accent)',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 14 }}>
            {zipStatus.includes('successfully') || zipStatus.includes('Extracted')
              ? 'check_circle'
              : 'info'}
          </span>
          {zipStatus}
        </div>
      )}
    </div>
  );
}

// ZIP upload zone component
function ZipUploadZone({
  onUpload,
  onProgress,
}: {
  onUpload: (file: File) => void;
  onProgress?: (status: string) => void;
}) {
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    if (!file.name.toLowerCase().endsWith('.zip')) {
      onProgress?.('Not a ZIP file');
      return;
    }

    setIsProcessing(true);
    onProgress?.('Processing ZIP...');

    try {
      await onUpload(file);
    } catch (err) {
      onProgress?.(err instanceof Error ? err.message : 'Failed to process ZIP');
    } finally {
      setIsProcessing(false);
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(false);

    const file = Array.from(e.dataTransfer.files).find((f) =>
      f.name.toLowerCase().endsWith('.zip')
    );
    if (file) {
      handleFile(file);
    }
  }

  function handleClick() {
    fileInputRef.current?.click();
  }

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept=".zip"
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
        }}
      />
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        onClick={handleClick}
        style={{
          border: '1px dashed rgba(var(--v2-accent-rgb), 0.2)',
          borderRadius: 12,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
          minHeight: 160,
          cursor: isProcessing ? 'wait' : 'pointer',
          transition: 'all 0.2s ease',
          borderColor: isDragging
            ? 'var(--v2-accent)'
            : 'rgba(var(--v2-accent-rgb), 0.2)',
          background: isDragging
            ? 'rgba(var(--v2-accent-rgb), 0.1)'
            : 'rgba(255,255,255,0.02)',
          opacity: isProcessing ? 0.6 : 1,
        }}
      >
        <span
          className="material-symbols-outlined"
          style={{
            fontSize: 40,
            color: isDragging ? 'var(--v2-accent)' : 'rgba(205,195,215,0.3)',
            marginBottom: 12,
          }}
        >
          {isProcessing ? 'hourglass_empty' : 'folder_zip'}
        </span>
        <p
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: '#e5e2e1',
            marginBottom: 4,
          }}
        >
          {isProcessing ? 'Processing...' : 'Upload ZIP Archive'}
        </p>
        <p style={{ fontSize: 10, color: 'rgba(205,195,215,0.5)', margin: 0 }}>
          {isProcessing
            ? 'Extracting and routing files...'
            : 'Click or drop ZIP file here'}
        </p>
      </div>
    </>
  );
}

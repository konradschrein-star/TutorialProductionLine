'use client';

import { FormatStyleCard } from './format-style-card';
import type { FormatStyleLibrary } from '@/lib/repositories/format-style-library-repository';

interface FormatStyleLibraryPickerProps {
  libraries: (FormatStyleLibrary & { reference_count?: number })[];
  selectedLibraryId: string | null;
  onSelect: (libraryId: string | null) => void;
  format: string; // Filter libraries by format
}

export function FormatStyleLibraryPicker({
  libraries,
  selectedLibraryId,
  onSelect,
  format,
}: FormatStyleLibraryPickerProps) {
  // Filter libraries by format
  const filteredLibraries = libraries.filter((lib) => lib.format === format && lib.is_active);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <h3 style={{ fontSize: 14, fontWeight: 700, color: '#e5e2e1', margin: 0, marginBottom: 6 }}>
          Style Library (Optional)
        </h3>
        <p style={{ fontSize: 12, color: '#cdc3d7', margin: 0 }}>
          Select a style library to apply visual consistency to this video
        </p>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
          gap: 12,
        }}
      >
        {/* No Style option */}
        <div
          onClick={() => onSelect(null)}
          style={{
            padding: 16,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            minHeight: 120,
            cursor: 'pointer',
            border:
              selectedLibraryId === null
                ? '2px solid var(--v2-accent)'
                : '1px solid rgba(var(--v2-accent-rgb), 0.12)',
            borderRadius: 12,
            background:
              selectedLibraryId === null
                ? 'rgba(var(--v2-accent-rgb), 0.08)'
                : 'rgba(255,255,255, 0.03)',
            transition: 'all 0.2s',
          }}
        >
          <span
            className="material-symbols-outlined"
            style={{
              fontSize: 32,
              color: selectedLibraryId === null ? 'var(--v2-accent)' : '#cdc3d7',
            }}
          >
            block
          </span>
          <span
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: selectedLibraryId === null ? 'var(--v2-accent)' : '#cdc3d7',
            }}
          >
            No Style Library
          </span>
          {selectedLibraryId === null && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                fontSize: 11,
                fontWeight: 600,
                color: 'var(--v2-accent)',
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 14 }}>
                check_circle
              </span>
              Selected
            </div>
          )}
        </div>

        {/* Available libraries */}
        {filteredLibraries.map((library) => (
          <FormatStyleCard
            key={library.id}
            library={library}
            onSelect={() => onSelect(library.id)}
            isSelected={selectedLibraryId === library.id}
          />
        ))}
      </div>

      {filteredLibraries.length === 0 && (
        <div
          style={{
            padding: 24,
            textAlign: 'center',
            background: 'rgba(255,255,255, 0.03)',
            border: '1px solid rgba(var(--v2-accent-rgb), 0.12)',
            borderRadius: 8,
          }}
        >
          <p style={{ fontSize: 12, color: '#cdc3d7', margin: 0 }}>
            No style libraries available for {format} format yet.
          </p>
        </div>
      )}
    </div>
  );
}

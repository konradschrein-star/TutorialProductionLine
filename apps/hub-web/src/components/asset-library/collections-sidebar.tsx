'use client';

import { useState, useEffect } from 'react';

interface Collection {
  id: string;
  name: string;
  description: string | null;
  color: string | null;
  icon: string | null;
  created_at: string;
  updated_at: string;
  asset_count: number;
}

interface CollectionsSidebarProps {
  selectedCollectionId: string | null;
  onSelectCollection: (collectionId: string | null) => void;
  onCreateClick: () => void;
  refreshTrigger?: number; // External trigger to refresh collections list
}

export function CollectionsSidebar({
  selectedCollectionId,
  onSelectCollection,
  onCreateClick,
  refreshTrigger = 0,
}: CollectionsSidebarProps) {
  const [collections, setCollections] = useState<Collection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Fetch collections
  useEffect(() => {
    const fetchCollections = async () => {
      setLoading(true);
      setError('');

      try {
        const response = await fetch('/api/assets/collections');

        if (!response.ok) {
          throw new Error('Failed to fetch collections');
        }

        const data = await response.json();
        setCollections(data.collections || []);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load collections');
      } finally {
        setLoading(false);
      }
    };

    fetchCollections();
  }, [refreshTrigger]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Header with "New Collection" button */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ fontSize: 12, fontWeight: 600, color: 'var(--v2-text-2)', margin: 0, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Collections
        </h3>
        <button
          onClick={onCreateClick}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--v2-accent)',
            cursor: 'pointer',
            padding: 4,
            display: 'flex',
            alignItems: 'center',
            gap: 4,
          }}
          title="Create new collection"
        >
          <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
            add
          </span>
        </button>
      </div>

      {/* Error state */}
      {error && (
        <div
          style={{
            padding: 8,
            borderRadius: 6,
            background: 'rgba(239, 68, 68, 0.1)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            color: '#EF4444',
            fontSize: 12,
          }}
        >
          {error}
        </div>
      )}

      {/* Loading state */}
      {loading && (
        <div style={{ padding: 12, textAlign: 'center', color: 'var(--v2-text-2)', fontSize: 13 }}>
          Loading collections...
        </div>
      )}

      {/* Collections list */}
      {!loading && !error && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {/* "All Assets" option (no collection filter) */}
          <button
            onClick={() => onSelectCollection(null)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '8px 12px',
              borderRadius: 8,
              border: 'none',
              background: selectedCollectionId === null ? 'rgba(var(--v2-accent-rgb), 0.15)' : 'transparent',
              color: selectedCollectionId === null ? 'var(--v2-accent)' : 'var(--v2-text-2)',
              fontSize: 13,
              fontWeight: selectedCollectionId === null ? 600 : 500,
              cursor: 'pointer',
              textAlign: 'left',
              transition: 'all 0.2s ease',
            }}
            onMouseEnter={(e) => {
              if (selectedCollectionId !== null) {
                e.currentTarget.style.background = 'var(--v2-surface-bright)';
              }
            }}
            onMouseLeave={(e) => {
              if (selectedCollectionId !== null) {
                e.currentTarget.style.background = 'transparent';
              }
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 18, color: '#6B7280' }}>
              video_library
            </span>
            <span style={{ flex: 1 }}>All Assets</span>
          </button>

          {/* Individual collections */}
          {collections.map((collection) => (
            <button
              key={collection.id}
              onClick={() => onSelectCollection(collection.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 12px',
                borderRadius: 8,
                border: 'none',
                background: selectedCollectionId === collection.id ? 'rgba(var(--v2-accent-rgb), 0.15)' : 'transparent',
                color: selectedCollectionId === collection.id ? 'var(--v2-accent)' : 'var(--v2-text-2)',
                fontSize: 13,
                fontWeight: selectedCollectionId === collection.id ? 600 : 500,
                cursor: 'pointer',
                textAlign: 'left',
                transition: 'all 0.2s ease',
              }}
              title={collection.description || collection.name}
              onMouseEnter={(e) => {
                if (selectedCollectionId !== collection.id) {
                  e.currentTarget.style.background = 'var(--v2-surface-bright)';
                }
              }}
              onMouseLeave={(e) => {
                if (selectedCollectionId !== collection.id) {
                  e.currentTarget.style.background = 'transparent';
                }
              }}
            >
              <span
                className="material-symbols-outlined"
                style={{
                  fontSize: 18,
                  color: collection.color || '#6366F1',
                }}
              >
                {collection.icon || 'folder'}
              </span>
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {collection.name}
              </span>
              {collection.asset_count > 0 && (
                <span
                  style={{
                    padding: '2px 6px',
                    borderRadius: 10,
                    background: selectedCollectionId === collection.id ? 'rgba(var(--v2-accent-rgb), 0.2)' : 'rgba(var(--v2-text-2-rgb), 0.1)',
                    fontSize: 11,
                    fontWeight: 600,
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {collection.asset_count}
                </span>
              )}
            </button>
          ))}

          {/* Empty state */}
          {collections.length === 0 && (
            <div
              style={{
                padding: '16px 12px',
                textAlign: 'center',
                color: 'var(--v2-text-2)',
                fontSize: 12,
              }}
            >
              No collections yet.
              <br />
              Click + to create one.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

'use client';

import { useState, useEffect } from 'react';

/**
 * Asset Browser Panel
 *
 * Collapsible side panel for browsing existing assets from the database.
 * Supports drag-and-drop to staging table cells.
 *
 * Asset types:
 * - Characters (personas for illustration formats)
 * - Environments (backgrounds/settings)
 * - Style Assets (style guides, references)
 * - Knowledge (research notes, references)
 */

export type AssetType = 'characters' | 'environments' | 'style-assets' | 'knowledge';

interface AssetItem {
  id: string;
  name: string;
  description?: string;
  thumbnail?: string;
  type: AssetType;
}

interface AssetBrowserPanelProps {
  isOpen: boolean;
  onToggle: () => void;
  channelId?: string;
  format?: string;
}

export function AssetBrowserPanel({
  isOpen,
  onToggle,
  channelId,
  format,
}: AssetBrowserPanelProps) {
  const [activeTab, setActiveTab] = useState<AssetType>('characters');
  const [assets, setAssets] = useState<AssetItem[]>([]);
  const [loading, setLoading] = useState(false);

  // Load assets when tab changes
  useEffect(() => {
    if (!isOpen) return;

    setLoading(true);
    const url = new URL(`/api/assets/${activeTab}`, window.location.origin);
    if (channelId) url.searchParams.set('channel_id', channelId);
    if (format) url.searchParams.set('format', format);

    fetch(url.toString())
      .then((r) => r.json())
      .then((data) => {
        setAssets(data.assets ?? []);
      })
      .catch((err) => {
        console.error('Failed to load assets:', err);
        setAssets([]);
      })
      .finally(() => setLoading(false));
  }, [activeTab, channelId, format, isOpen]);

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        right: 0,
        bottom: 0,
        width: isOpen ? 360 : 0,
        background: 'rgba(0,0,0,0.95)',
        borderLeft: isOpen ? '1px solid rgba(var(--v2-accent-rgb), 0.2)' : 'none',
        transition: 'width 0.3s ease',
        zIndex: 100,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/* Toggle button */}
      <button
        onClick={onToggle}
        style={{
          position: 'absolute',
          left: -48,
          top: '50%',
          transform: 'translateY(-50%)',
          width: 48,
          height: 96,
          background: 'rgba(0,0,0,0.95)',
          border: '1px solid rgba(var(--v2-accent-rgb), 0.2)',
          borderRight: 'none',
          borderRadius: '8px 0 0 8px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          transition: 'all 0.2s ease',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'rgba(var(--v2-accent-rgb), 0.1)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'rgba(0,0,0,0.95)';
        }}
      >
        <span
          className="material-symbols-outlined"
          style={{ fontSize: 20, color: 'var(--v2-accent)' }}
        >
          {isOpen ? 'chevron_right' : 'folder_open'}
        </span>
      </button>

      {/* Panel content */}
      {isOpen && (
        <>
          {/* Header */}
          <div
            style={{
              padding: '20px 24px',
              borderBottom: '1px solid rgba(var(--v2-accent-rgb), 0.1)',
            }}
          >
            <h2
              style={{
                fontSize: 14,
                fontWeight: 700,
                color: '#e5e2e1',
                margin: '0 0 4px 0',
                letterSpacing: '0.05em',
              }}
            >
              Asset Library
            </h2>
            <p style={{ fontSize: 10, color: 'rgba(205,195,215,0.5)', margin: 0 }}>
              Browse and drag assets to jobs
            </p>
          </div>

          {/* Tabs */}
          <div
            style={{
              display: 'flex',
              gap: 8,
              padding: '16px 24px',
              borderBottom: '1px solid rgba(var(--v2-accent-rgb), 0.1)',
              overflowX: 'auto',
            }}
          >
            {[
              { id: 'characters', label: 'Characters', icon: 'person' },
              { id: 'environments', label: 'Environments', icon: 'landscape' },
              { id: 'style-assets', label: 'Styles', icon: 'palette' },
              { id: 'knowledge', label: 'Knowledge', icon: 'school' },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as AssetType)}
                style={{
                  padding: '8px 12px',
                  background:
                    activeTab === tab.id
                      ? 'rgba(var(--v2-accent-rgb), 0.15)'
                      : 'rgba(255,255,255,0.03)',
                  border:
                    activeTab === tab.id
                      ? '1px solid rgba(var(--v2-accent-rgb), 0.4)'
                      : '1px solid rgba(255,255,255,0.05)',
                  borderRadius: 6,
                  color: activeTab === tab.id ? 'var(--v2-accent)' : 'rgba(205,195,215,0.7)',
                  fontSize: 10,
                  fontWeight: 600,
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  whiteSpace: 'nowrap',
                }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 14 }}>
                  {tab.icon}
                </span>
                {tab.label}
              </button>
            ))}
          </div>

          {/* Assets list */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '16px 24px' }}>
            {loading ? (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: 40,
                  color: 'rgba(205,195,215,0.5)',
                  fontSize: 12,
                }}
              >
                <div
                  style={{
                    width: 20,
                    height: 20,
                    border: '2px solid rgba(var(--v2-accent-rgb), 0.2)',
                    borderTopColor: 'var(--v2-accent)',
                    borderRadius: '50%',
                    animation: 'spin 0.8s linear infinite',
                  }}
                />
              </div>
            ) : assets.length === 0 ? (
              <div
                style={{
                  padding: 40,
                  textAlign: 'center',
                  color: 'rgba(205,195,215,0.4)',
                  fontSize: 11,
                }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 32, opacity: 0.3 }}>
                  inventory_2
                </span>
                <p style={{ margin: '12px 0 0 0' }}>No {activeTab} found</p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {assets.map((asset) => (
                  <div
                    key={asset.id}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData('application/json', JSON.stringify(asset));
                      e.dataTransfer.effectAllowed = 'copy';
                    }}
                    style={{
                      padding: 12,
                      background: 'rgba(255,255,255,0.03)',
                      border: '1px solid rgba(255,255,255,0.08)',
                      borderRadius: 8,
                      cursor: 'grab',
                      transition: 'all 0.15s ease',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = 'rgba(var(--v2-accent-rgb), 0.08)';
                      e.currentTarget.style.borderColor = 'rgba(var(--v2-accent-rgb), 0.3)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'rgba(255,255,255,0.03)';
                      e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)';
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                      }}
                    >
                      {asset.thumbnail ? (
                        <img
                          src={asset.thumbnail}
                          alt={asset.name}
                          style={{
                            width: 40,
                            height: 40,
                            objectFit: 'cover',
                            borderRadius: 6,
                            background: 'rgba(0,0,0,0.3)',
                          }}
                        />
                      ) : (
                        <div
                          style={{
                            width: 40,
                            height: 40,
                            borderRadius: 6,
                            background: 'rgba(var(--v2-accent-rgb), 0.1)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          <span
                            className="material-symbols-outlined"
                            style={{ fontSize: 18, color: 'rgba(var(--v2-accent-rgb), 0.5)' }}
                          >
                            image
                          </span>
                        </div>
                      )}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div
                          style={{
                            fontSize: 11,
                            fontWeight: 600,
                            color: '#e5e2e1',
                            marginBottom: 2,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {asset.name}
                        </div>
                        {asset.description && (
                          <div
                            style={{
                              fontSize: 9,
                              color: 'rgba(205,195,215,0.5)',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {asset.description}
                          </div>
                        )}
                      </div>
                      <span
                        className="material-symbols-outlined"
                        style={{ fontSize: 14, color: 'rgba(205,195,215,0.3)' }}
                      >
                        drag_indicator
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      <style jsx>{`
        @keyframes spin {
          to {
            transform: rotate(360deg);
          }
        }
      `}</style>
    </div>
  );
}

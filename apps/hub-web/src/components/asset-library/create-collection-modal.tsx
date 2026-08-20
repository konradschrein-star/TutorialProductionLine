'use client';

import { useState } from 'react';

interface CreateCollectionModalProps {
  open: boolean;
  onClose: () => void;
  onCreated: (collection: {
    id: string;
    name: string;
    description: string | null;
    color: string | null;
    icon: string | null;
  }) => void;
}

const COLOR_OPTIONS = [
  { name: 'Indigo', value: '#6366F1' },
  { name: 'Blue', value: '#3B82F6' },
  { name: 'Green', value: '#10B981' },
  { name: 'Yellow', value: '#F59E0B' },
  { name: 'Red', value: '#EF4444' },
  { name: 'Purple', value: '#A855F7' },
  { name: 'Pink', value: '#EC4899' },
  { name: 'Gray', value: '#6B7280' },
];

const ICON_OPTIONS = [
  'folder',
  'video_library',
  'photo_library',
  'music_note',
  'mic',
  'movie',
  'collections',
  'category',
  'label',
  'bookmark',
];

export function CreateCollectionModal({ open, onClose, onCreated }: CreateCollectionModalProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [color, setColor] = useState('#6366F1');
  const [icon, setIcon] = useState('folder');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const response = await fetch('/api/assets/collections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || undefined,
          color,
          icon,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to create collection');
      }

      const data = await response.json();
      onCreated(data.collection);

      // Reset form
      setName('');
      setDescription('');
      setColor('#6366F1');
      setIcon('folder');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create collection');
    } finally {
      setLoading(false);
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
        background: 'rgba(0, 0, 0, 0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'var(--v2-surface-container)',
          borderRadius: 16,
          padding: 24,
          width: '90%',
          maxWidth: 500,
          border: '1px solid var(--v2-surface-bright)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h2 style={{ fontSize: 20, fontWeight: 600, color: 'var(--v2-text-1)', margin: 0 }}>
            Create Collection
          </h2>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--v2-text-2)',
              cursor: 'pointer',
              padding: 4,
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 24 }}>
              close
            </span>
          </button>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Name */}
          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: 'var(--v2-text-2)', marginBottom: 6 }}>
              Name *
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={100}
              placeholder="e.g., Episode 5 Assets"
              style={{
                width: '100%',
                padding: '10px 12px',
                borderRadius: 8,
                border: '1px solid var(--v2-surface-bright)',
                background: 'var(--v2-surface-container)',
                color: 'var(--v2-text-1)',
                fontSize: 14,
                outline: 'none',
              }}
            />
          </div>

          {/* Description */}
          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: 'var(--v2-text-2)', marginBottom: 6 }}>
              Description (optional)
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Brief description of this collection..."
              rows={3}
              style={{
                width: '100%',
                padding: '10px 12px',
                borderRadius: 8,
                border: '1px solid var(--v2-surface-bright)',
                background: 'var(--v2-surface-container)',
                color: 'var(--v2-text-1)',
                fontSize: 14,
                outline: 'none',
                resize: 'vertical',
              }}
            />
          </div>

          {/* Color */}
          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: 'var(--v2-text-2)', marginBottom: 6 }}>
              Color
            </label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {COLOR_OPTIONS.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  onClick={() => setColor(c.value)}
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 8,
                    background: c.value,
                    border: color === c.value ? '2px solid var(--v2-text-1)' : '1px solid var(--v2-surface-bright)',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                  }}
                  title={c.name}
                />
              ))}
            </div>
          </div>

          {/* Icon */}
          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: 'var(--v2-text-2)', marginBottom: 6 }}>
              Icon
            </label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {ICON_OPTIONS.map((i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setIcon(i)}
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 8,
                    background: icon === i ? 'rgba(var(--v2-accent-rgb), 0.15)' : 'var(--v2-surface-bright)',
                    border: icon === i ? '1px solid var(--v2-accent)' : '1px solid transparent',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    transition: 'all 0.2s ease',
                  }}
                  title={i}
                >
                  <span
                    className="material-symbols-outlined"
                    style={{
                      fontSize: 20,
                      color: icon === i ? 'var(--v2-accent)' : 'var(--v2-text-2)',
                    }}
                  >
                    {i}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {error && (
            <div
              style={{
                padding: '10px 12px',
                borderRadius: 8,
                background: 'rgba(239, 68, 68, 0.1)',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                color: '#EF4444',
                fontSize: 13,
              }}
            >
              {error}
            </div>
          )}

          <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: 8 }}>
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              style={{
                padding: '10px 20px',
                borderRadius: 8,
                border: '1px solid var(--v2-surface-bright)',
                background: 'var(--v2-surface-container)',
                color: 'var(--v2-text-2)',
                fontSize: 14,
                fontWeight: 500,
                cursor: loading ? 'not-allowed' : 'pointer',
                opacity: loading ? 0.5 : 1,
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || !name.trim()}
              style={{
                padding: '10px 20px',
                borderRadius: 8,
                border: 'none',
                background: 'var(--v2-accent)',
                color: 'white',
                fontSize: 14,
                fontWeight: 500,
                cursor: loading || !name.trim() ? 'not-allowed' : 'pointer',
                opacity: loading || !name.trim() ? 0.5 : 1,
              }}
            >
              {loading ? 'Creating...' : 'Create Collection'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

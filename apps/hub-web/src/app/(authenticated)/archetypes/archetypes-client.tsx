'use client';

import { useState, useCallback } from 'react';
import { Plus } from 'lucide-react';
import { V2Card, V2Button } from '../_components';
import { ArchetypeCard, type ArchetypeCardArchetype } from '@/components/archetypes/archetype-card';
import { ArchetypeEditDrawer } from '@/components/archetypes/archetype-edit-drawer';

interface ArchetypesClientProps {
  initialArchetypes: ArchetypeCardArchetype[];
}

export function ArchetypesClient({ initialArchetypes }: ArchetypesClientProps) {
  const [archetypes, setArchetypes] = useState<ArchetypeCardArchetype[]>(initialArchetypes);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingArchetype, setEditingArchetype] = useState<ArchetypeCardArchetype | null>(null);
  const [drawerMode, setDrawerMode] = useState<'create' | 'edit'>('create');

  const handleOpenCreate = useCallback(() => {
    setEditingArchetype(null);
    setDrawerMode('create');
    setDrawerOpen(true);
  }, []);

  const handleOpenEdit = useCallback((archetype: ArchetypeCardArchetype) => {
    setEditingArchetype(archetype);
    setDrawerMode('edit');
    setDrawerOpen(true);
  }, []);

  const handleClose = useCallback(() => {
    setDrawerOpen(false);
    setEditingArchetype(null);
  }, []);

  const handleSaved = useCallback((saved: ArchetypeCardArchetype) => {
    setArchetypes((prev) => {
      const idx = prev.findIndex((a) => a.id === saved.id);
      if (idx >= 0) {
        const updated = [...prev];
        updated[idx] = saved;
        return updated;
      }
      return [saved, ...prev];
    });
  }, []);

  return (
    <>
      {/* Page header actions */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <p style={{ fontSize: 11, color: 'var(--v2-text-3)', fontWeight: 600 }}>
          {archetypes.length} archetype{archetypes.length !== 1 ? 's' : ''}
        </p>
        <V2Button variant="accent" onClick={handleOpenCreate}>
          <Plus className="w-4 h-4" />
          New Archetype
        </V2Button>
      </div>

      {/* Grid */}
      {archetypes.length === 0 ? (
        <V2Card>
          <div style={{ textAlign: 'center', padding: '40px 20px' }}>
            <p style={{ fontSize: 13, color: 'var(--v2-text-2)', marginBottom: 16 }}>
              No archetypes yet.
            </p>
            <V2Button variant="accent" onClick={handleOpenCreate}>
              Create your first archetype
            </V2Button>
          </div>
        </V2Card>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 16 }}>
          {archetypes.map((archetype) => (
            <ArchetypeCard
              key={archetype.id}
              archetype={archetype}
              onEdit={handleOpenEdit}
            />
          ))}
        </div>
      )}

      {/* Drawer */}
      <ArchetypeEditDrawer
        mode={drawerMode}
        archetype={editingArchetype}
        open={drawerOpen}
        onClose={handleClose}
        onSaved={handleSaved}
      />
    </>
  );
}

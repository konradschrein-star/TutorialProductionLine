'use client';

import { useState, useCallback } from 'react';
import { Plus } from 'lucide-react';
import { ArchetypeCard, type ArchetypeCardArchetype } from './archetype-card';
import { ArchetypeEditDrawer } from './archetype-edit-drawer';

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
      <div className="flex items-center justify-between">
        <p className="text-[rgba(205,195,215,0.6)] text-sm">
          {archetypes.length} archetype{archetypes.length !== 1 ? 's' : ''}
        </p>
        <button
          onClick={handleOpenCreate}
          className="v2-btn-accent flex items-center gap-2 px-4 py-2"
        >
          <Plus className="w-4 h-4" />
          New Archetype
        </button>
      </div>

      {/* Grid */}
      {archetypes.length === 0 ? (
        <div className="bg-[rgba(255,255,255,0.04)] backdrop-blur-[20px] border border-[rgba(255,255,255,0.09)] rounded-xl p-12 text-center">
          <p className="text-[rgba(205,195,215,0.6)] mb-4">No archetypes yet.</p>
          <button
            onClick={handleOpenCreate}
            className="text-sm text-[#aaff00] hover:text-[rgba(170,255,0,0.8)] transition-colors"
          >
            Create your first archetype
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
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

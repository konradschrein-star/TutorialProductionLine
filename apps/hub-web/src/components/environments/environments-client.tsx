'use client';

import { useState, useCallback } from 'react';
import { Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { EnvironmentCard, type EnvironmentCardEnvironment } from './environment-card';
import { EnvironmentEditDrawer } from './environment-edit-drawer';

interface ArchetypeFilter {
  id: string;
  name: string;
}

interface BackgroundAsset {
  id: string;
  name: string;
}

interface EnvironmentsClientProps {
  initialEnvironments: EnvironmentCardEnvironment[];
  archetypes: ArchetypeFilter[];
  backgroundAssets: BackgroundAsset[];
}

export function EnvironmentsClient({
  initialEnvironments,
  archetypes,
  backgroundAssets,
}: EnvironmentsClientProps) {
  const [environments, setEnvironments] = useState<EnvironmentCardEnvironment[]>(initialEnvironments);
  const [archetypeFilter, setArchetypeFilter] = useState<string>('');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingEnv, setEditingEnv] = useState<EnvironmentCardEnvironment | null>(null);
  const [drawerMode, setDrawerMode] = useState<'create' | 'edit'>('create');

  const handleOpenCreate = useCallback(() => {
    setEditingEnv(null);
    setDrawerMode('create');
    setDrawerOpen(true);
  }, []);

  const handleOpenEdit = useCallback((env: EnvironmentCardEnvironment) => {
    setEditingEnv(env);
    setDrawerMode('edit');
    setDrawerOpen(true);
  }, []);

  const handleClose = useCallback(() => {
    setDrawerOpen(false);
    setEditingEnv(null);
  }, []);

  const handleSaved = useCallback((saved: EnvironmentCardEnvironment) => {
    setEnvironments((prev) => {
      const idx = prev.findIndex((e) => e.id === saved.id);
      if (idx >= 0) {
        const updated = [...prev];
        updated[idx] = saved;
        return updated;
      }
      return [saved, ...prev];
    });
  }, []);

  const filtered = archetypeFilter
    ? environments.filter((e) => e.archetype_id === archetypeFilter)
    : environments;

  return (
    <>
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-4">
        {/* Archetype filter pills */}
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setArchetypeFilter('')}
            className={cn(
              'px-3 py-1 rounded-full text-xs font-semibold transition-colors',
              archetypeFilter === ''
                ? 'bg-primary text-primary-foreground'
                : 'bg-surface-bright text-text-muted hover:text-text'
            )}
          >
            All
          </button>
          {archetypes.map((a) => (
            <button
              key={a.id}
              onClick={() => setArchetypeFilter(a.id)}
              className={cn(
                'px-3 py-1 rounded-full text-xs font-semibold transition-colors',
                archetypeFilter === a.id
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-surface-bright text-text-muted hover:text-text'
              )}
            >
              {a.name}
            </button>
          ))}
        </div>

        <button
          onClick={handleOpenCreate}
          className="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg text-sm font-semibold transition-colors flex-shrink-0"
        >
          <Plus className="w-4 h-4" />
          New Environment
        </button>
      </div>

      {/* Grid */}
      {filtered.length === 0 ? (
        <div className="glass-card rounded-xl p-12 text-center">
          <p className="text-text-muted mb-4">
            {archetypeFilter ? 'No environments for this archetype.' : 'No environments yet.'}
          </p>
          {!archetypeFilter && (
            <button
              onClick={handleOpenCreate}
              className="text-sm text-primary hover:text-primary/80 transition-colors"
            >
              Create your first environment
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((env) => (
            <EnvironmentCard
              key={env.id}
              environment={env}
              archetypes={archetypes}
              onEdit={handleOpenEdit}
            />
          ))}
        </div>
      )}

      {/* Drawer */}
      <EnvironmentEditDrawer
        mode={drawerMode}
        environment={editingEnv}
        archetypes={archetypes}
        backgroundAssets={backgroundAssets}
        open={drawerOpen}
        onClose={handleClose}
        onSaved={handleSaved}
      />
    </>
  );
}

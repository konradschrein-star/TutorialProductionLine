'use client';

import { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useTableState, type TableColumn } from '@/lib/hooks/use-table-state';
import type { DropZoneAsset } from './drop-zone-card';
import { calculateAssetProgress } from '@/lib/validation/job-validation';
import {
  fetchCharacterMetadata,
  fetchEnvironmentMetadata,
  suggestTopicFromAssets,
} from '@/lib/utils/asset-metadata';

/**
 * Format bytes to human-readable size
 */
function formatBytes(bytes: number | null): string {
  if (!bytes) return '—';
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  return `${(bytes / 1_000).toFixed(0)} KB`;
}

/**
 * Media Asset Reference
 * Tracks media assets (video/audio/image) dragged from asset library
 */
interface MediaAssetRef {
  zone_id: string;
  asset_id: string;
  asset_type: 'video' | 'audio' | 'image';
  name: string;
  size_bytes: number;
}

export interface StagedJob {
  id: string;
  topic: string;
  assets: Map<string, DropZoneAsset[]>; // zoneId -> file assets
  channel_id: string;
  subtitles: boolean;
  auto_start: boolean;
  skip_image_qc: boolean;
  skip_final_qc: boolean;
  language: string;
  production_version: 'V1' | 'V2' | 'V3';
  // Database asset references (dragged from asset browser)
  environment_id?: string | null;
  character_ids?: string[]; // For illustration formats with characters
  knowledge_refs?: string[]; // Research/reference material
  media_asset_refs?: MediaAssetRef[]; // Media files (video/audio/image)
  validation_status: 'valid' | 'warning' | 'error';
  validation_messages: string[];
  overrides: Set<string>;
}

interface Channel {
  id: string;
  name: string;
}

interface AdvancedStagingTableProps {
  jobs: StagedJob[];
  channels: Channel[];
  templateId: string;
  format: string; // Content format for progress calculation
  onUpdateJob: (id: string, updates: Partial<StagedJob>) => void;
  onDeleteJobs: (ids: string[]) => void;
  onDispatchJobs: (ids: string[]) => void;
  onCellDrop?: (jobId: string, zoneId: string, files: File[]) => void;
  dispatching?: boolean;
}

const DEFAULT_COLUMNS: TableColumn[] = [
  { id: 'select', label: '', visible: true, sortable: false, width: 50 },
  { id: 'topic', label: 'Topic', visible: true, sortable: true, filterable: true },
  { id: 'script', label: 'Script', visible: true, sortable: false },
  { id: 'narration', label: 'Narration Video', visible: true, sortable: false },
  { id: 'b-roll', label: 'B-Roll', visible: false, sortable: false },
  { id: 'channel', label: 'Channel', visible: true, sortable: true, filterable: true },
  { id: 'database-assets', label: 'Database Assets', visible: true, sortable: false },
  { id: 'subtitles', label: 'Subtitles', visible: true, sortable: false },
  { id: 'auto_start', label: 'Auto-start', visible: false, sortable: false },
  { id: 'language', label: 'Language', visible: false, sortable: true, filterable: true },
  { id: 'status', label: 'Status', visible: true, sortable: true, filterable: true },
  { id: 'actions', label: '', visible: true, sortable: false, width: 80 },
];

export function AdvancedStagingTable({
  jobs,
  channels,
  templateId,
  format,
  onUpdateJob,
  onDeleteJobs,
  onDispatchJobs,
  onCellDrop,
  dispatching = false,
}: AdvancedStagingTableProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const [showColumnManager, setShowColumnManager] = useState(false);

  const {
    state,
    visibleColumns,
    setColumnVisibility,
    toggleSort,
    setSearchQuery,
    setFilter,
    clearFilters,
    toggleRowSelection,
    selectAll,
    clearSelection,
  } = useTableState({
    defaultColumns: DEFAULT_COLUMNS,
    storageKey: 'job-staging-table',
    templateId,
  });

  // Filter and sort jobs
  const filteredJobs = useMemo(() => {
    let result = [...jobs];

    // Search
    if (state.searchQuery) {
      const query = state.searchQuery.toLowerCase();
      result = result.filter((job) =>
        job.topic.toLowerCase().includes(query)
      );
    }

    // Filters
    if (state.filters.channel) {
      result = result.filter((job) => job.channel_id === state.filters.channel);
    }
    if (state.filters.status) {
      result = result.filter((job) => job.validation_status === state.filters.status);
    }
    if (state.filters.language) {
      result = result.filter((job) => job.language === state.filters.language);
    }

    // Sort
    if (state.sortBy) {
      result.sort((a, b) => {
        let aVal: any;
        let bVal: any;

        switch (state.sortBy) {
          case 'topic':
            aVal = a.topic;
            bVal = b.topic;
            break;
          case 'channel':
            aVal = channels.find((c) => c.id === a.channel_id)?.name ?? '';
            bVal = channels.find((c) => c.id === b.channel_id)?.name ?? '';
            break;
          case 'language':
            aVal = a.language;
            bVal = b.language;
            break;
          case 'status':
            aVal = a.validation_status;
            bVal = b.validation_status;
            break;
          default:
            return 0;
        }

        if (aVal < bVal) return state.sortDirection === 'asc' ? -1 : 1;
        if (aVal > bVal) return state.sortDirection === 'asc' ? 1 : -1;
        return 0;
      });
    }

    return result;
  }, [jobs, state.searchQuery, state.filters, state.sortBy, state.sortDirection, channels]);

  // Virtualization (only enable for 50+ jobs)
  const enableVirtualization = filteredJobs.length >= 50;

  const rowVirtualizer = useVirtualizer({
    count: filteredJobs.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 60,
    enabled: enableVirtualization,
    overscan: 10,
  });

  const allSelected =
    state.selectedRows.size === filteredJobs.length && filteredJobs.length > 0;
  const someSelected =
    state.selectedRows.size > 0 && state.selectedRows.size < filteredJobs.length;

  const handleSelectAll = useCallback(() => {
    if (allSelected) {
      clearSelection();
    } else {
      selectAll(filteredJobs.map((j) => j.id));
    }
  }, [allSelected, filteredJobs, selectAll, clearSelection]);

  const handleDeleteSelected = useCallback(() => {
    onDeleteJobs(Array.from(state.selectedRows));
    clearSelection();
  }, [state.selectedRows, onDeleteJobs, clearSelection]);

  const handleDispatchSelected = useCallback(() => {
    const validIds = Array.from(state.selectedRows).filter((id) => {
      const job = jobs.find((j) => j.id === id);
      return job && job.validation_status !== 'error';
    });
    if (validIds.length > 0) {
      onDispatchJobs(validIds);
      clearSelection();
    }
  }, [state.selectedRows, jobs, onDispatchJobs, clearSelection]);

  if (jobs.length === 0) {
    return null;
  }

  const validCount = filteredJobs.filter((j) => j.validation_status !== 'error').length;
  const selectedValidCount = Array.from(state.selectedRows).filter((id) => {
    const job = jobs.find((j) => j.id === id);
    return job && job.validation_status !== 'error';
  }).length;

  return (
    <div
      style={{
        background: 'rgba(255,255,255,0.02)',
        border: '1px solid rgba(var(--v2-accent-rgb), 0.1)',
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
          gap: 12,
        }}
      >
        <span
          className="material-symbols-outlined"
          style={{ fontSize: 18, color: 'rgba(205,195,215,0.6)' }}
        >
          list_alt
        </span>
        <span style={{ fontSize: 12, fontWeight: 600, color: '#e5e2e1', flex: 1 }}>
          Staged Jobs ({filteredJobs.length})
          {state.selectedRows.size > 0 && ` · ${state.selectedRows.size} selected`}
        </span>

        {/* Search */}
        <div style={{ position: 'relative', width: 200 }}>
          <span
            className="material-symbols-outlined"
            style={{
              position: 'absolute',
              left: 10,
              top: '50%',
              transform: 'translateY(-50%)',
              fontSize: 14,
              color: 'rgba(205,195,215,0.5)',
              pointerEvents: 'none',
            }}
          >
            search
          </span>
          <input
            type="text"
            placeholder="Search..."
            value={state.searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              width: '100%',
              padding: '6px 10px 6px 32px',
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(var(--v2-accent-rgb), 0.2)',
              borderRadius: 6,
              color: '#e5e2e1',
              fontSize: 11,
              outline: 'none',
            }}
          />
        </div>

        {/* Column manager */}
        <button
          onClick={() => setShowColumnManager(!showColumnManager)}
          style={{
            padding: '6px 10px',
            background: 'rgba(255,255,255,0.05)',
            border: '1px solid rgba(var(--v2-accent-rgb), 0.2)',
            borderRadius: 6,
            color: '#e5e2e1',
            fontSize: 11,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 14 }}>
            view_column
          </span>
          Columns
        </button>
      </div>

      {/* Column manager dropdown */}
      {showColumnManager && (
        <div
          style={{
            padding: 12,
            background: 'rgba(0,0,0,0.3)',
            borderBottom: '1px solid rgba(255,255,255,0.05)',
          }}
        >
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
            {state.columns
              .filter((col) => col.id !== 'select' && col.id !== 'actions')
              .map((col) => (
                <label
                  key={col.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    fontSize: 11,
                    color: '#e5e2e1',
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={col.visible}
                    onChange={(e) => setColumnVisibility(col.id, e.target.checked)}
                    style={{ cursor: 'pointer' }}
                  />
                  {col.label}
                </label>
              ))}
          </div>
        </div>
      )}

      {/* Bulk actions bar */}
      {state.selectedRows.size > 0 && (
        <div
          style={{
            padding: '10px 16px',
            background: 'rgba(var(--v2-accent-rgb), 0.1)',
            borderBottom: '1px solid rgba(var(--v2-accent-rgb), 0.2)',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <span style={{ fontSize: 11, color: 'var(--v2-accent)', fontWeight: 600 }}>
            {state.selectedRows.size} selected
            {selectedValidCount > 0 && ` · ${selectedValidCount} dispatchable`}
          </span>
          <div style={{ flex: 1 }} />
          <button
            onClick={handleDeleteSelected}
            style={{
              padding: '6px 12px',
              background: 'rgba(255,80,80,0.15)',
              border: '1px solid rgba(255,80,80,0.3)',
              borderRadius: 6,
              color: '#ff8080',
              fontSize: 11,
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 14 }}>
              delete
            </span>
            Delete
          </button>
          {selectedValidCount > 0 && (
            <button
              onClick={handleDispatchSelected}
              disabled={dispatching}
              style={{
                padding: '6px 12px',
                background: 'var(--v2-accent)',
                border: 'none',
                borderRadius: 6,
                color: '#000',
                fontSize: 11,
                fontWeight: 700,
                cursor: dispatching ? 'not-allowed' : 'pointer',
                opacity: dispatching ? 0.5 : 1,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 14 }}>
                send
              </span>
              Dispatch ({selectedValidCount})
            </button>
          )}
        </div>
      )}

      {/* Table */}
      <div
        ref={parentRef}
        style={{
          maxHeight: enableVirtualization ? 600 : 'none',
          overflowY: enableVirtualization ? 'auto' : 'visible',
          overflowX: 'auto',
        }}
      >
        <table
          style={{
            width: '100%',
            borderCollapse: 'collapse',
            fontSize: 11,
          }}
        >
          <thead
            style={{
              position: 'sticky',
              top: 0,
              zIndex: 10,
              background: 'rgba(0,0,0,0.3)',
              borderBottom: '1px solid rgba(255,255,255,0.1)',
            }}
          >
            <tr>
              {visibleColumns.map((col) => (
                <TableHeader
                  key={col.id}
                  column={col}
                  sortBy={state.sortBy}
                  sortDirection={state.sortDirection}
                  onSort={toggleSort}
                  allSelected={allSelected}
                  someSelected={someSelected}
                  onSelectAll={handleSelectAll}
                />
              ))}
            </tr>
          </thead>
          <tbody
            style={{
              position: 'relative',
              height: enableVirtualization
                ? `${rowVirtualizer.getTotalSize()}px`
                : 'auto',
            }}
          >
            {enableVirtualization
              ? rowVirtualizer.getVirtualItems().map((virtualRow) => {
                  const job = filteredJobs[virtualRow.index];
                  return (
                    <TableRow
                      key={job.id}
                      job={job}
                      channels={channels}
                      format={format}
                      visibleColumns={visibleColumns}
                      selected={state.selectedRows.has(job.id)}
                      onToggleSelect={() => toggleRowSelection(job.id)}
                      onUpdate={(updates) => onUpdateJob(job.id, updates)}
                      onDelete={() => onDeleteJobs([job.id])}
                      onCellDrop={onCellDrop}
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        transform: `translateY(${virtualRow.start}px)`,
                      }}
                    />
                  );
                })
              : filteredJobs.map((job) => (
                  <TableRow
                    key={job.id}
                    job={job}
                    channels={channels}
                    format={format}
                    visibleColumns={visibleColumns}
                    selected={state.selectedRows.has(job.id)}
                    onToggleSelect={() => toggleRowSelection(job.id)}
                    onUpdate={(updates) => onUpdateJob(job.id, updates)}
                    onDelete={() => onDeleteJobs([job.id])}
                    onCellDrop={onCellDrop}
                  />
                ))}
          </tbody>
        </table>
      </div>

      {/* Footer actions */}
      <div
        style={{
          padding: '12px 16px',
          background: 'rgba(0,0,0,0.2)',
          borderTop: '1px solid rgba(255,255,255,0.05)',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
        }}
      >
        <span style={{ fontSize: 11, color: 'rgba(205,195,215,0.6)', flex: 1 }}>
          {validCount} valid job{validCount !== 1 ? 's' : ''} ready to dispatch
        </span>
        <button
          onClick={() => onDeleteJobs(jobs.map((j) => j.id))}
          style={{
            padding: '8px 14px',
            background: 'none',
            border: '1px solid rgba(255,80,80,0.3)',
            borderRadius: 6,
            color: '#ff8080',
            fontSize: 11,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Clear All
        </button>
        <button
          onClick={() => onDispatchJobs(jobs.filter((j) => j.validation_status !== 'error').map((j) => j.id))}
          disabled={dispatching || validCount === 0}
          style={{
            padding: '8px 14px',
            background: dispatching || validCount === 0 ? 'rgba(var(--v2-accent-rgb), 0.3)' : 'var(--v2-accent)',
            border: 'none',
            borderRadius: 6,
            color: '#000',
            fontSize: 11,
            fontWeight: 700,
            cursor: dispatching || validCount === 0 ? 'not-allowed' : 'pointer',
          }}
        >
          Dispatch All ({validCount})
        </button>
      </div>
    </div>
  );
}

// Table header component
function TableHeader({
  column,
  sortBy,
  sortDirection,
  onSort,
  allSelected,
  someSelected,
  onSelectAll,
}: {
  column: TableColumn;
  sortBy: string | null;
  sortDirection: 'asc' | 'desc';
  onSort: (columnId: string) => void;
  allSelected: boolean;
  someSelected: boolean;
  onSelectAll: () => void;
}) {
  if (column.id === 'select') {
    return (
      <th style={{ width: column.width, padding: '10px 12px', textAlign: 'left' }}>
        <input
          type="checkbox"
          checked={allSelected}
          ref={(el) => {
            if (el) el.indeterminate = someSelected;
          }}
          onChange={onSelectAll}
          style={{ cursor: 'pointer' }}
        />
      </th>
    );
  }

  const isSorted = sortBy === column.id;

  return (
    <th
      style={{
        width: column.width,
        padding: '10px 12px',
        textAlign: 'left',
        fontWeight: 600,
        color: 'rgba(205,195,215,0.8)',
        cursor: column.sortable ? 'pointer' : 'default',
        userSelect: 'none',
      }}
      onClick={() => column.sortable && onSort(column.id)}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {column.label}
        {column.sortable && isSorted && (
          <span className="material-symbols-outlined" style={{ fontSize: 14 }}>
            {sortDirection === 'asc' ? 'arrow_upward' : 'arrow_downward'}
          </span>
        )}
      </div>
    </th>
  );
}

// Table row component
function TableRow({
  job,
  channels,
  format,
  visibleColumns,
  selected,
  onToggleSelect,
  onUpdate,
  onDelete,
  onCellDrop,
  style,
}: {
  job: StagedJob;
  channels: Channel[];
  format: string;
  visibleColumns: TableColumn[];
  selected: boolean;
  onToggleSelect: () => void;
  onUpdate: (updates: Partial<StagedJob>) => void;
  onDelete: () => void;
  onCellDrop?: (jobId: string, zoneId: string, files: File[]) => void;
  style?: React.CSSProperties;
}) {
  const [isDraggingAsset, setIsDraggingAsset] = useState(false);

  // Calculate asset completion progress
  const progress = calculateAssetProgress({
    format,
    assets: job.assets,
    topic: job.topic,
    channel_id: job.channel_id,
    character_ids: job.character_ids,
    environment_id: job.environment_id,
    knowledge_refs: job.knowledge_refs,
  });

  const statusColor =
    job.validation_status === 'error'
      ? '#ff8080'
      : job.validation_status === 'warning'
        ? '#ffb400'
        : progress.isComplete
          ? 'var(--v2-accent)'
          : '#ffb400';

  function handleAssetDragOver(e: React.DragEvent) {
    // Check if it's an asset from the browser panel (has JSON data)
    if (e.dataTransfer.types.includes('application/json')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      setIsDraggingAsset(true);
    }
  }

  function handleAssetDragLeave() {
    setIsDraggingAsset(false);
  }

  async function handleAssetDrop(e: React.DragEvent) {
    setIsDraggingAsset(false);

    // Only handle JSON data (database assets)
    if (!e.dataTransfer.types.includes('application/json')) return;

    e.preventDefault();
    e.stopPropagation();

    try {
      const assetData = JSON.parse(e.dataTransfer.getData('application/json'));

      // Check if it's a media library asset
      if (assetData.source === 'media-library') {
        // Handle media asset drop
        const mediaRef: MediaAssetRef = {
          zone_id: 'media', // Generic zone for media assets
          asset_id: assetData.asset_id,
          asset_type: assetData.asset_type,
          name: assetData.name,
          size_bytes: assetData.size_bytes,
        };

        const updates: Partial<StagedJob> = {
          media_asset_refs: [...(job.media_asset_refs ?? []), mediaRef],
        };

        onUpdate(updates);
        return;
      }

      // Handle database asset drops (characters, environments, knowledge)
      const { id, type } = assetData;

      // Update job based on asset type
      const updates: Partial<StagedJob> = {};

      switch (type) {
        case 'characters':
          updates.character_ids = [...(job.character_ids ?? []), id];
          break;
        case 'environments':
          updates.environment_id = id;
          break;
        case 'knowledge':
          updates.knowledge_refs = [...(job.knowledge_refs ?? []), id];
          break;
      }

      if (Object.keys(updates).length > 0) {
        onUpdate(updates);

        // Auto-populate topic if empty
        if (!job.topic || job.topic.trim().length === 0) {
          const characterIds = type === 'characters' ? updates.character_ids : job.character_ids;
          const envId = type === 'environments' ? updates.environment_id : job.environment_id;

          // Fetch metadata asynchronously
          const characterNames: string[] = [];
          if (characterIds && characterIds.length > 0) {
            for (const charId of characterIds.slice(0, 3)) { // Limit to first 3
              const metadata = await fetchCharacterMetadata(charId);
              if (metadata) characterNames.push(metadata.name);
            }
          }

          let environmentName: string | undefined;
          if (envId) {
            const metadata = await fetchEnvironmentMetadata(envId);
            if (metadata) environmentName = metadata.name;
          }

          // Generate topic suggestion
          if (characterNames.length > 0 || environmentName) {
            const suggestedTopic = suggestTopicFromAssets(characterNames, environmentName);
            if (suggestedTopic) {
              onUpdate({ topic: suggestedTopic });
            }
          }
        }
      }
    } catch (err) {
      console.warn('Failed to parse dropped asset:', err);
    }
  }

  return (
    <tr
      onDragOver={handleAssetDragOver}
      onDragLeave={handleAssetDragLeave}
      onDrop={handleAssetDrop}
      style={{
        ...style,
        background: isDraggingAsset
          ? 'rgba(var(--v2-accent-rgb), 0.15)'
          : selected
            ? 'rgba(var(--v2-accent-rgb), 0.08)'
            : 'none',
        borderBottom: '1px solid rgba(255,255,255,0.05)',
        transition: 'background 0.15s ease',
      }}
    >
      {visibleColumns.map((col) => {
        switch (col.id) {
          case 'select':
            return (
              <td key={col.id} style={{ padding: '10px 12px' }}>
                <input
                  type="checkbox"
                  checked={selected}
                  onChange={onToggleSelect}
                  style={{ cursor: 'pointer' }}
                />
              </td>
            );

          case 'topic':
            return (
              <td key={col.id} style={{ padding: '10px 12px' }}>
                <input
                  type="text"
                  value={job.topic}
                  onChange={(e) => onUpdate({ topic: e.target.value })}
                  placeholder="Enter topic..."
                  style={{
                    width: '100%',
                    padding: '6px 8px',
                    background: 'rgba(255,255,255,0.03)',
                    border: '1px solid rgba(var(--v2-accent-rgb), 0.15)',
                    borderRadius: 4,
                    color: '#e5e2e1',
                    fontSize: 11,
                    outline: 'none',
                  }}
                />
              </td>
            );

          case 'channel':
            return (
              <td key={col.id} style={{ padding: '10px 12px' }}>
                <select
                  value={job.channel_id}
                  onChange={(e) => onUpdate({ channel_id: e.target.value })}
                  style={{
                    width: '100%',
                    padding: '6px 8px',
                    background: 'rgba(255,255,255,0.03)',
                    border: '1px solid rgba(var(--v2-accent-rgb), 0.15)',
                    borderRadius: 4,
                    color: '#e5e2e1',
                    fontSize: 11,
                    outline: 'none',
                  }}
                >
                  {channels.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </td>
            );

          case 'subtitles':
            return (
              <td key={col.id} style={{ padding: '10px 12px', textAlign: 'center' }}>
                <input
                  type="checkbox"
                  checked={job.subtitles}
                  onChange={(e) => onUpdate({ subtitles: e.target.checked })}
                  style={{ cursor: 'pointer' }}
                />
              </td>
            );

          case 'auto_start':
            return (
              <td key={col.id} style={{ padding: '10px 12px', textAlign: 'center' }}>
                <input
                  type="checkbox"
                  checked={job.auto_start}
                  onChange={(e) => onUpdate({ auto_start: e.target.checked })}
                  style={{ cursor: 'pointer' }}
                />
              </td>
            );

          case 'status':
            return (
              <td key={col.id} style={{ padding: '10px 12px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {/* Progress indicator */}
                  {progress.total > 0 && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <div
                        style={{
                          fontSize: 9,
                          color: statusColor,
                          fontWeight: 600,
                        }}
                      >
                        {progress.isComplete ? '✓ Ready' : `${progress.provided} / ${progress.total}`}
                      </div>
                      {!progress.isComplete && (
                        <div
                          style={{
                            flex: 1,
                            height: 4,
                            background: 'rgba(255,255,255,0.05)',
                            borderRadius: 2,
                            overflow: 'hidden',
                            maxWidth: 60,
                          }}
                        >
                          <div
                            style={{
                              width: `${progress.percentage}%`,
                              height: '100%',
                              background: statusColor,
                              transition: 'width 0.2s ease',
                            }}
                          />
                        </div>
                      )}
                    </div>
                  )}
                  {/* Validation status */}
                  {job.validation_status !== 'valid' && (
                    <span
                      style={{
                        fontSize: 9,
                        color: job.validation_status === 'error' ? '#ff8080' : '#ffb400',
                        fontWeight: 500,
                        textTransform: 'uppercase',
                      }}
                    >
                      {job.validation_status}
                    </span>
                  )}
                </div>
              </td>
            );

          case 'database-assets':
            return (
              <td key={col.id} style={{ padding: '10px 12px' }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {/* Character count badge */}
                  {job.character_ids && job.character_ids.length > 0 && (
                    <div
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 4,
                        padding: '3px 6px',
                        background: 'rgba(var(--v2-accent-rgb), 0.15)',
                        border: '1px solid rgba(var(--v2-accent-rgb), 0.3)',
                        borderRadius: 4,
                        fontSize: 10,
                        color: 'var(--v2-accent)',
                      }}
                      title={`${job.character_ids.length} character(s) attached`}
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: 12 }}>
                        person
                      </span>
                      <span>{job.character_ids.length}</span>
                    </div>
                  )}
                  {/* Environment indicator */}
                  {job.environment_id && (
                    <div
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 4,
                        padding: '3px 6px',
                        background: 'rgba(var(--v2-accent-rgb), 0.15)',
                        border: '1px solid rgba(var(--v2-accent-rgb), 0.3)',
                        borderRadius: 4,
                        fontSize: 10,
                        color: 'var(--v2-accent)',
                      }}
                      title="Environment attached"
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: 12 }}>
                        landscape
                      </span>
                      <span>Env</span>
                    </div>
                  )}
                  {/* Knowledge refs count */}
                  {job.knowledge_refs && job.knowledge_refs.length > 0 && (
                    <div
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 4,
                        padding: '3px 6px',
                        background: 'rgba(var(--v2-accent-rgb), 0.15)',
                        border: '1px solid rgba(var(--v2-accent-rgb), 0.3)',
                        borderRadius: 4,
                        fontSize: 10,
                        color: 'var(--v2-accent)',
                      }}
                      title={`${job.knowledge_refs.length} knowledge reference(s) attached`}
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: 12 }}>
                        school
                      </span>
                      <span>{job.knowledge_refs.length}</span>
                    </div>
                  )}
                  {/* Media Asset References */}
                  {job.media_asset_refs && job.media_asset_refs.length > 0 && (
                    job.media_asset_refs.map(ref => (
                      <div
                        key={ref.asset_id}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 4,
                          padding: '3px 6px',
                          background: 'rgba(var(--v2-accent-rgb), 0.15)',
                          border: '1px solid rgba(var(--v2-accent-rgb), 0.3)',
                          borderRadius: 4,
                          fontSize: 10,
                          color: 'var(--v2-accent)',
                        }}
                        title={`${ref.name} (${formatBytes(ref.size_bytes)})`}
                      >
                        <span className="material-symbols-outlined" style={{ fontSize: 12 }}>
                          {ref.asset_type === 'video' ? 'videocam' :
                           ref.asset_type === 'audio' ? 'audio_file' : 'image'}
                        </span>
                        <span>{ref.name}</span>
                      </div>
                    ))
                  )}
                  {/* Show empty state if no database assets */}
                  {(!job.character_ids || job.character_ids.length === 0) &&
                    !job.environment_id &&
                    (!job.knowledge_refs || job.knowledge_refs.length === 0) &&
                    (!job.media_asset_refs || job.media_asset_refs.length === 0) && (
                    <span style={{ fontSize: 10, color: 'rgba(205,195,215,0.3)', fontStyle: 'italic' }}>
                      None
                    </span>
                  )}
                </div>
              </td>
            );

          case 'actions':
            return (
              <td key={col.id} style={{ padding: '10px 12px', textAlign: 'right' }}>
                <button
                  onClick={onDelete}
                  style={{
                    padding: 6,
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: 4,
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
                    style={{ fontSize: 16, color: '#ff8080' }}
                  >
                    delete
                  </span>
                </button>
              </td>
            );

          default:
            // Asset columns (script, narration, etc.)
            return (
              <td key={col.id} style={{ padding: '10px 12px' }}>
                <CellDropZone
                  jobId={job.id}
                  zoneId={col.id}
                  assets={job.assets.get(col.id) ?? []}
                  onDrop={onCellDrop}
                />
              </td>
            );
        }
      })}
    </tr>
  );
}

// Cell-level drop zone
function CellDropZone({
  jobId,
  zoneId,
  assets,
  onDrop,
}: {
  jobId: string;
  zoneId: string;
  assets: DropZoneAsset[];
  onDrop?: (jobId: string, zoneId: string, files: File[]) => void;
}) {
  const [isDragging, setIsDragging] = useState(false);
  const counterRef = useRef(0);

  if (!onDrop) {
    return <div style={{ color: 'rgba(205,195,215,0.3)', fontSize: 10 }}>—</div>;
  }

  function handleDragEnter(e: React.DragEvent) {
    e.preventDefault();
    counterRef.current++;
    if (e.dataTransfer.types.includes('Files')) {
      setIsDragging(true);
    }
  }

  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault();
    counterRef.current--;
    if (counterRef.current <= 0) {
      counterRef.current = 0;
      setIsDragging(false);
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    counterRef.current = 0;
    setIsDragging(false);

    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0 && onDrop) {
      onDrop(jobId, zoneId, files);
    }
  }

  return (
    <div
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }}
      onDrop={handleDrop}
      style={{
        minHeight: 32,
        padding: 6,
        border: isDragging
          ? '1px dashed var(--v2-accent)'
          : '1px dashed rgba(var(--v2-accent-rgb), 0.15)',
        borderRadius: 4,
        background: isDragging ? 'rgba(var(--v2-accent-rgb), 0.1)' : 'rgba(255,255,255,0.02)',
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        fontSize: 10,
        color: 'rgba(205,195,215,0.5)',
        transition: 'all 0.15s ease',
      }}
    >
      {assets.length > 0 ? (
        <span style={{ color: 'var(--v2-accent)', fontWeight: 600 }}>
          {assets.length} file{assets.length !== 1 ? 's' : ''}
        </span>
      ) : isDragging ? (
        'Drop here'
      ) : (
        'Drop files'
      )}
    </div>
  );
}

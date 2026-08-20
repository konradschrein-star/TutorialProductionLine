import { useState, useCallback, useMemo, useEffect } from 'react';

export interface TableColumn {
  id: string;
  label: string;
  visible: boolean;
  width?: number;
  sortable?: boolean;
  filterable?: boolean;
}

export interface TableState {
  columns: TableColumn[];
  sortBy: string | null;
  sortDirection: 'asc' | 'desc';
  searchQuery: string;
  filters: Record<string, any>;
  selectedRows: Set<string>;
}

interface UseTableStateOptions {
  defaultColumns: TableColumn[];
  storageKey?: string;
  templateId?: string;
}

export function useTableState({
  defaultColumns,
  storageKey = 'table-state',
  templateId,
}: UseTableStateOptions) {
  const finalStorageKey = templateId ? `${storageKey}-${templateId}` : storageKey;

  // Load initial state from localStorage
  const [state, setState] = useState<TableState>(() => {
    if (typeof window === 'undefined') {
      return {
        columns: defaultColumns,
        sortBy: null,
        sortDirection: 'asc',
        searchQuery: '',
        filters: {},
        selectedRows: new Set(),
      };
    }

    try {
      const stored = localStorage.getItem(finalStorageKey);
      if (stored) {
        const parsed = JSON.parse(stored);
        // Merge stored columns with defaults (in case new columns were added)
        const storedColumnsMap = new Map<string, TableColumn>(
          parsed.columns?.map((c: TableColumn) => [c.id, c] as [string, TableColumn]) ?? []
        );
        const mergedColumns: TableColumn[] = defaultColumns.map((col) => {
          const stored = storedColumnsMap.get(col.id);
          return {
            id: col.id,
            label: col.label,
            visible: stored?.visible ?? col.visible,
            width: stored?.width ?? col.width,
            sortable: col.sortable,
            filterable: col.filterable,
          };
        });

        return {
          columns: mergedColumns,
          sortBy: parsed.sortBy ?? null,
          sortDirection: parsed.sortDirection ?? 'asc',
          searchQuery: '',
          filters: {},
          selectedRows: new Set(),
        };
      }
    } catch (err) {
      console.warn('Failed to load table state:', err);
    }

    return {
      columns: defaultColumns,
      sortBy: null,
      sortDirection: 'asc',
      searchQuery: '',
      filters: {},
      selectedRows: new Set(),
    };
  });

  // Persist columns, sort to localStorage
  useEffect(() => {
    if (typeof window === 'undefined') return;

    try {
      const toStore = {
        columns: state.columns,
        sortBy: state.sortBy,
        sortDirection: state.sortDirection,
      };
      localStorage.setItem(finalStorageKey, JSON.stringify(toStore));
    } catch (err) {
      console.warn('Failed to save table state:', err);
    }
  }, [state.columns, state.sortBy, state.sortDirection, finalStorageKey]);

  const setColumnVisibility = useCallback((columnId: string, visible: boolean) => {
    setState((prev) => ({
      ...prev,
      columns: prev.columns.map((col) =>
        col.id === columnId ? { ...col, visible } : col
      ),
    }));
  }, []);

  const setColumnWidth = useCallback((columnId: string, width: number) => {
    setState((prev) => ({
      ...prev,
      columns: prev.columns.map((col) =>
        col.id === columnId ? { ...col, width } : col
      ),
    }));
  }, []);

  const toggleSort = useCallback((columnId: string) => {
    setState((prev) => {
      if (prev.sortBy === columnId) {
        // Toggle direction
        return {
          ...prev,
          sortDirection: prev.sortDirection === 'asc' ? 'desc' : 'asc',
        };
      } else {
        // New sort column
        return {
          ...prev,
          sortBy: columnId,
          sortDirection: 'asc',
        };
      }
    });
  }, []);

  const setSearchQuery = useCallback((query: string) => {
    setState((prev) => ({ ...prev, searchQuery: query }));
  }, []);

  const setFilter = useCallback((key: string, value: any) => {
    setState((prev) => ({
      ...prev,
      filters: { ...prev.filters, [key]: value },
    }));
  }, []);

  const clearFilters = useCallback(() => {
    setState((prev) => ({ ...prev, filters: {}, searchQuery: '' }));
  }, []);

  const selectRow = useCallback((rowId: string) => {
    setState((prev) => {
      const next = new Set(prev.selectedRows);
      next.add(rowId);
      return { ...prev, selectedRows: next };
    });
  }, []);

  const deselectRow = useCallback((rowId: string) => {
    setState((prev) => {
      const next = new Set(prev.selectedRows);
      next.delete(rowId);
      return { ...prev, selectedRows: next };
    });
  }, []);

  const toggleRowSelection = useCallback((rowId: string) => {
    setState((prev) => {
      const next = new Set(prev.selectedRows);
      if (next.has(rowId)) {
        next.delete(rowId);
      } else {
        next.add(rowId);
      }
      return { ...prev, selectedRows: next };
    });
  }, []);

  const selectAll = useCallback((rowIds: string[]) => {
    setState((prev) => ({
      ...prev,
      selectedRows: new Set(rowIds),
    }));
  }, []);

  const clearSelection = useCallback(() => {
    setState((prev) => ({
      ...prev,
      selectedRows: new Set(),
    }));
  }, []);

  const visibleColumns = useMemo(
    () => state.columns.filter((col) => col.visible),
    [state.columns]
  );

  return {
    state,
    visibleColumns,
    setColumnVisibility,
    setColumnWidth,
    toggleSort,
    setSearchQuery,
    setFilter,
    clearFilters,
    selectRow,
    deselectRow,
    toggleRowSelection,
    selectAll,
    clearSelection,
  };
}

'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { UserPlus, AlertCircle } from 'lucide-react';
import { assignProductionVA, assignUploaderVA } from '@/app/actions/jobs';

interface VAAssignmentProps {
  jobId: string;
  currentVAId: string | null;
  availableVAs: Array<{
    id: string;
    name: string;
    email: string;
  }>;
  vaType?: 'production' | 'uploader';
}

export function VAAssignment({ jobId, currentVAId, availableVAs, vaType = 'production' }: VAAssignmentProps) {
  const router = useRouter();
  const [selectedVAId, setSelectedVAId] = useState(currentVAId || '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const label = vaType === 'uploader' ? 'Uploader VA' : 'Production VA';

  const handleAssign = async () => {
    if (!selectedVAId) return;
    setLoading(true);
    setError(null);
    const action = vaType === 'uploader' ? assignUploaderVA : assignProductionVA;
    const result = await action(jobId, selectedVAId);
    if (result.success) {
      router.refresh();
    } else {
      setError(result.error || `Failed to assign ${label}`);
    }
    setLoading(false);
  };

  if (availableVAs.length === 0) {
    return (
      <div className="p-4 bg-warning/10 border border-warning/20 rounded-lg">
        <p className="text-sm text-warning">
          No active {label}s found. Create a {label} account in Team Management first.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <label className="block text-sm font-medium text-text">
        Assign {label}
      </label>
      <div className="flex items-center space-x-3">
        <select
          value={selectedVAId}
          onChange={(e) => setSelectedVAId(e.target.value)}
          className="flex-1 px-3 py-2 bg-surface-container border border-surface-bright rounded-lg text-text text-sm focus:outline-none focus:ring-2 focus:ring-primary"
        >
          <option value="">Select a {label}...</option>
          {availableVAs.map((va) => (
            <option key={va.id} value={va.id}>
              {va.name} ({va.email})
            </option>
          ))}
        </select>
        <button
          onClick={handleAssign}
          disabled={loading || !selectedVAId || selectedVAId === currentVAId}
          className="flex items-center space-x-2 px-4 py-2 bg-primary hover:bg-primary/90 text-white rounded-lg transition-all disabled:opacity-50"
        >
          <UserPlus className="w-4 h-4" />
          <span>Assign</span>
        </button>
      </div>
      {error && (
        <div className="flex items-start space-x-3 p-3 bg-error/10 border border-error/20 rounded-lg">
          <AlertCircle className="w-4 h-4 text-error flex-shrink-0 mt-0.5" />
          <p className="text-sm text-error">{error}</p>
        </div>
      )}
    </div>
  );
}

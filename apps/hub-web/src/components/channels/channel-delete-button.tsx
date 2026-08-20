'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Trash2 } from 'lucide-react';
import { deleteChannel } from '@/app/actions/channels';

/**
 * Channel Delete Button Component
 *
 * Client-side button for deleting channels with confirmation.
 * Shows warning if channel has associated jobs.
 */

interface ChannelDeleteButtonProps {
  channelId: string;
  channelName: string;
  jobCount: number;
}

export function ChannelDeleteButton({
  channelId,
  channelName,
  jobCount,
}: ChannelDeleteButtonProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleDelete() {
    const hasJobs = jobCount > 0;
    const message = hasJobs
      ? `Are you sure you want to delete "${channelName}"? This channel has ${jobCount} associated job${
          jobCount !== 1 ? 's' : ''
        }. This action cannot be undone.`
      : `Are you sure you want to delete "${channelName}"?`;

    if (!confirm(message)) {
      return;
    }

    setLoading(true);
    const result = await deleteChannel(channelId);
    if (result.success) {
      router.refresh();
    } else {
      alert(result.error || 'Failed to delete channel');
      setLoading(false);
    }
  }

  return (
    <button
      onClick={handleDelete}
      disabled={loading}
      className="inline-flex items-center space-x-1 text-sm text-error hover:text-error/80 transition-colors disabled:opacity-50"
    >
      <Trash2 className="w-4 h-4" />
      <span>Delete</span>
    </button>
  );
}

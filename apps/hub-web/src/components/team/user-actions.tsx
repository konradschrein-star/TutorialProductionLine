'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Edit, Power, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { toggleUserActive, deleteUser } from '@/app/actions/team';
import type { User } from '@/lib/repositories/team-repository';

/**
 * User Actions Component
 *
 * Action buttons for user management (edit, toggle active, delete).
 */

interface UserActionsProps {
  user: User;
}

export function UserActions({ user }: UserActionsProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleToggleActive() {
    setLoading(true);
    const result = await toggleUserActive(user.id, !user.is_active);
    if (result.success) {
      router.refresh();
    } else {
      alert(result.error || 'Failed to update user status');
    }
    setLoading(false);
  }

  async function handleDelete() {
    if (
      !confirm(
        `Are you sure you want to delete user "${user.name}"? This action cannot be undone.`
      )
    ) {
      return;
    }

    setLoading(true);
    const result = await deleteUser(user.id);
    if (result.success) {
      router.refresh();
    } else {
      alert(result.error || 'Failed to delete user');
      setLoading(false);
    }
  }

  return (
    <div className="flex items-center space-x-2">
      <Link
        href={`/team/${user.id}`}
        className="inline-flex items-center space-x-1 px-2 py-1 text-xs text-primary hover:text-primary/80 transition-colors"
      >
        <Edit className="w-3 h-3" />
        <span>Edit</span>
      </Link>
      <button
        onClick={handleToggleActive}
        disabled={loading}
        className={`inline-flex items-center space-x-1 px-2 py-1 text-xs transition-colors disabled:opacity-50 ${
          user.is_active
            ? 'text-text-muted hover:text-text'
            : 'text-success hover:text-success/80'
        }`}
      >
        <Power className="w-3 h-3" />
        <span>{user.is_active ? 'Deactivate' : 'Activate'}</span>
      </button>
      <button
        onClick={handleDelete}
        disabled={loading}
        className="inline-flex items-center space-x-1 px-2 py-1 text-xs text-error hover:text-error/80 transition-colors disabled:opacity-50"
      >
        <Trash2 className="w-3 h-3" />
        <span>Delete</span>
      </button>
    </div>
  );
}

import React, { createContext, useContext } from 'react';
import { VAUser } from '../types';
import { useActiveUser } from '../hooks/useStore';

/**
 * Capability-based access control. The product promise is a clean split between
 * what a VA sees day-to-day and what the admin/owner can configure. Rather than
 * scatter `role === 'admin'` checks, everything routes through `can(permission)`.
 */
export type Permission =
  | 'produce'          // run the conveyor / studio, record & dispatch
  | 'keywords'         // browse & claim keywords
  | 'keywordsManage'   // import, screen, delete, source new keywords
  | 'thumbnails'       // use the thumbnail studio
  | 'viewOwnMetrics'   // see own productivity
  | 'viewAllMetrics'   // see the whole team's metrics
  | 'manageTeam'       // create/edit/delete VA accounts & targets
  | 'manageChannels'   // create/edit channels
  | 'manageConfig'     // edit Studio Config (filters, lengths, topics…)
  | 'manageApiKeys'    // view/rotate provider API keys, Drive credentials
  | 'factoryReset';    // wipe / restore the workstation

type Role = VAUser['role'];

const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  admin: [
    'produce', 'keywords', 'keywordsManage', 'thumbnails',
    'viewOwnMetrics', 'viewAllMetrics', 'manageTeam', 'manageChannels',
    'manageConfig', 'manageApiKeys', 'factoryReset',
  ],
  manager: [
    'produce', 'keywords', 'keywordsManage', 'thumbnails',
    'viewOwnMetrics', 'viewAllMetrics', 'manageTeam', 'manageChannels', 'manageConfig',
  ],
  va: [
    'produce', 'keywords', 'thumbnails', 'viewOwnMetrics',
  ],
  viewer: [
    'keywords', 'viewOwnMetrics',
  ],
};

interface RoleContextValue {
  user: VAUser;
  role: Role;
  isAdmin: boolean;
  isManager: boolean;
  isVA: boolean;
  isViewer: boolean;
  can: (perm: Permission) => boolean;
}

const RoleContext = createContext<RoleContextValue | null>(null);

export const RoleProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const user = useActiveUser();
  const role = user.role;
  const perms = ROLE_PERMISSIONS[role] || ROLE_PERMISSIONS.viewer;

  const value: RoleContextValue = {
    user,
    role,
    isAdmin: role === 'admin',
    isManager: role === 'manager',
    isVA: role === 'va',
    isViewer: role === 'viewer',
    can: (perm) => perms.includes(perm),
  };

  return <RoleContext.Provider value={value}>{children}</RoleContext.Provider>;
};

export function useRole(): RoleContextValue {
  const ctx = useContext(RoleContext);
  if (!ctx) throw new Error('useRole must be used within RoleProvider');
  return ctx;
}

/** Convenience guard: render children only when the permission is held. */
export const Gate: React.FC<{ perm: Permission; children: React.ReactNode; fallback?: React.ReactNode }> = ({
  perm,
  children,
  fallback = null,
}) => {
  const { can } = useRole();
  return <>{can(perm) ? children : fallback}</>;
};

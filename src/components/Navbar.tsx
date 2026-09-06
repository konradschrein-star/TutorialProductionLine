import React, { useState } from 'react';
import { NavLink } from 'react-router-dom';
import {
  Video,
  Palette,
  Search,
  CheckCircle2,
  Settings as SettingsIcon,
  Tv,
  UserCircle2,
  Sun,
  Moon,
  Workflow,
  BarChart3,
  Sliders,
  SlidersHorizontal,
  Sparkles,
  Globe,
  BookOpen,
  Menu,
  X,
} from 'lucide-react';
import { useTheme } from '../context/ThemeContext';
import { StorageService } from '../services/storageService';
import { useChannels, useUsers, useActiveUser, useActiveChannel, useConfig } from '../hooks/useStore';
import { useRole, Permission } from '../context/RoleContext';
import { Modal } from './ui/Modal';
import { useToast } from './ui/Feedback';
import { VAUser } from '../types';

interface NavbarProps {
  onOpenSetupWizard?: () => void;
  onOpenLocalization?: () => void;
}

interface NavItem {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  perm: Permission | null;
}

const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Produce', icon: Video, perm: 'produce' },
  { to: '/studio', label: 'Studio', icon: Sliders, perm: 'produce' },
  { to: '/keywords', label: 'Keywords', icon: Search, perm: 'keywords' },
  { to: '/thumbnails', label: 'Thumbnails', icon: Palette, perm: 'thumbnails' },
  { to: '/finished', label: 'Library', icon: CheckCircle2, perm: 'produce' },
  { to: '/metrics', label: 'Metrics', icon: BarChart3, perm: 'viewOwnMetrics' },
  { to: '/config', label: 'Config', icon: SlidersHorizontal, perm: 'manageConfig' },
  { to: '/settings', label: 'Settings', icon: SettingsIcon, perm: 'manageChannels' },
  { to: '/guide', label: 'Guide', icon: BookOpen, perm: null },
];

const ROLE_BADGE: Record<string, string> = {
  admin: 'badge-accent',
  manager: 'badge-info',
  va: 'badge-success',
  viewer: 'badge-neutral',
};

export const Navbar: React.FC<NavbarProps> = ({ onOpenSetupWizard, onOpenLocalization }) => {
  const { theme, toggleTheme } = useTheme();
  const { can, role } = useRole();
  const channels = useChannels();
  const users = useUsers();
  const activeUser = useActiveUser();
  const activeChannel = useActiveChannel();
  const config = useConfig();
  const toast = useToast();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [pendingUser, setPendingUser] = useState<VAUser | null>(null);
  const [pinDraft, setPinDraft] = useState('');

  const items = NAV_ITEMS.filter((it) => it.perm === null || can(it.perm));

  const isPrivileged = (u: VAUser) => u.role === 'admin' || u.role === 'manager';

  /**
   * Switch the active user. If an admin PIN is configured and we're ELEVATING
   * into a privileged account from a non-privileged one, require the PIN first.
   */
  const requestUserSwitch = (u: VAUser) => {
    const elevating = isPrivileged(u) && !isPrivileged(activeUser);
    if (config.adminPin && elevating) {
      setPinDraft('');
      setPendingUser(u);
      return;
    }
    StorageService.setActiveUser(u);
  };

  const confirmPin = () => {
    if (pendingUser && pinDraft === config.adminPin) {
      StorageService.setActiveUser(pendingUser);
      setPendingUser(null);
      setPinDraft('');
    } else {
      toast('Incorrect PIN.', 'error', 'Access denied');
    }
  };

  const tabClass = (isActive: boolean) =>
    `flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-semibold transition-all ${
      isActive
        ? 'bg-surface-100 text-foreground shadow-subtle border border-border'
        : 'text-muted hover:text-foreground'
    }`;

  return (
    <header className="sticky top-0 z-50 bg-surface-100/95 backdrop-blur-md border-b border-border transition-colors">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-14 gap-2">
          {/* Logo & product name */}
          <div className="flex items-center gap-3 min-w-0">
            <button
              className="md:hidden focus-ring rounded-md p-1.5 text-muted hover:text-foreground"
              onClick={() => setMobileOpen((v) => !v)}
              aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
              aria-expanded={mobileOpen}
            >
              {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
            <div className="w-8 h-8 rounded-lg bg-accent text-accent-foreground flex items-center justify-center shrink-0">
              <Workflow className="w-4 h-4" />
            </div>
            <div className="flex items-baseline gap-2 min-w-0">
              <span className="font-display font-bold text-sm tracking-tight text-foreground truncate">
                {config.productName || 'Tutorial Studio'}
              </span>
              <span className="text-[10px] uppercase font-mono font-medium text-muted tracking-wider hidden lg:inline">
                Production Suite
              </span>
            </div>
          </div>

          {/* Desktop tabs */}
          <nav className="hidden md:flex items-center gap-0.5 bg-surface-200 p-1 rounded-lg border border-border overflow-x-auto">
            {items.map(({ to, label, icon: Icon }) => (
              <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => tabClass(isActive)}>
                <Icon className="w-3.5 h-3.5" />
                <span className="whitespace-nowrap">{label}</span>
              </NavLink>
            ))}
          </nav>

          {/* Right controls */}
          <div className="flex items-center gap-2">
            {onOpenSetupWizard && can('manageConfig') && (
              <button
                type="button"
                onClick={onOpenSetupWizard}
                className="hidden xl:flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-surface-200 hover:bg-surface-300 border border-border text-foreground text-xs font-semibold transition-colors focus-ring"
                title="Open setup wizard"
              >
                <Sparkles className="w-3.5 h-3.5 text-warning" />
                <span>Setup</span>
              </button>
            )}

            {onOpenLocalization && can('produce') && (
              <button
                type="button"
                onClick={onOpenLocalization}
                className="hidden lg:flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-surface-200 hover:bg-surface-300 border border-border text-foreground text-xs font-semibold transition-colors focus-ring"
                title="Multi-language localization"
              >
                <Globe className="w-3.5 h-3.5 text-info" />
                <span>Translate</span>
              </button>
            )}

            {/* Channel switcher */}
            <div className="flex items-center gap-1.5 bg-surface-200 px-2.5 py-1.5 rounded-lg border border-border text-xs">
              <Tv className="w-3.5 h-3.5 text-muted" />
              <select
                value={activeChannel.id}
                onChange={(e) => {
                  const ch = channels.find((c) => c.id === e.target.value);
                  if (ch) StorageService.setActiveChannel(ch);
                }}
                className="bg-transparent text-xs font-semibold text-foreground outline-none cursor-pointer pr-1 max-w-[130px] truncate"
                aria-label="Active channel"
              >
                {channels.map((ch) => (
                  <option key={ch.id} value={ch.id} className="bg-surface-100 text-foreground">
                    {ch.name}
                  </option>
                ))}
              </select>
            </div>

            {/* User switcher + role badge */}
            <div className="hidden lg:flex items-center gap-1.5 bg-surface-200 px-2.5 py-1.5 rounded-lg border border-border text-xs">
              <UserCircle2 className="w-3.5 h-3.5 text-muted" />
              <select
                value={activeUser.id}
                onChange={(e) => {
                  const u = users.find((usr) => usr.id === e.target.value);
                  if (u) requestUserSwitch(u);
                }}
                className="bg-transparent text-xs font-semibold text-foreground outline-none cursor-pointer max-w-[110px] truncate"
                aria-label="Active user"
              >
                {users.map((u) => (
                  <option key={u.id} value={u.id} className="bg-surface-100 text-foreground">
                    {u.name}
                  </option>
                ))}
              </select>
              <span className={`badge ${ROLE_BADGE[role] || 'badge-neutral'} uppercase`}>{role}</span>
            </div>

            <button
              type="button"
              onClick={toggleTheme}
              className="p-1.5 rounded-lg bg-surface-200 hover:bg-surface-300 border border-border text-foreground transition-colors focus-ring"
              title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
              aria-label="Toggle theme"
            >
              {theme === 'dark' ? <Sun className="w-4 h-4 text-muted" /> : <Moon className="w-4 h-4 text-muted" />}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile drawer */}
      {mobileOpen && (
        <nav className="md:hidden border-t border-border bg-surface-100 px-4 py-3 animate-fadeIn">
          <div className="grid grid-cols-2 gap-1.5">
            {items.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                end={to === '/'}
                onClick={() => setMobileOpen(false)}
                className={({ isActive }) =>
                  `flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm font-semibold transition-all ${
                    isActive ? 'bg-surface-200 text-foreground border border-border' : 'text-muted hover:text-foreground'
                  }`
                }
              >
                <Icon className="w-4 h-4" />
                {label}
              </NavLink>
            ))}
          </div>
          <div className="mt-3 pt-3 border-t border-border flex items-center gap-2">
            <UserCircle2 className="w-4 h-4 text-muted" />
            <select
              value={activeUser.id}
              onChange={(e) => {
                const u = users.find((usr) => usr.id === e.target.value);
                if (u) StorageService.setActiveUser(u);
              }}
              className="pro-input rounded-md px-2 py-1.5 text-sm flex-1"
              aria-label="Active user"
            >
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
            <span className={`badge ${ROLE_BADGE[role] || 'badge-neutral'} uppercase`}>{role}</span>
          </div>
        </nav>
      )}

      {/* Admin PIN gate (workstation lock) */}
      <Modal
        isOpen={!!pendingUser}
        onClose={() => setPendingUser(null)}
        title="Admin access"
        subtitle={pendingUser ? `Enter the PIN to switch to ${pendingUser.name}` : undefined}
        size="sm"
        footer={
          <>
            <button className="btn-outline focus-ring rounded-md px-3.5 py-2 text-sm" onClick={() => setPendingUser(null)}>
              Cancel
            </button>
            <button className="btn-accent focus-ring rounded-md px-4 py-2 text-sm font-semibold" onClick={confirmPin}>
              Unlock
            </button>
          </>
        }
      >
        <input
          type="password"
          autoFocus
          value={pinDraft}
          onChange={(e) => setPinDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && confirmPin()}
          placeholder="Admin PIN"
          className="pro-input focus-ring rounded-md px-3 py-2 text-sm w-full"
          aria-label="Admin PIN"
        />
      </Modal>
    </header>
  );
};

import React from 'react';
import { NavLink } from 'react-router-dom';
import { 
  Video, 
  Palette, 
  Search, 
  CheckCircle2, 
  Settings, 
  Tv, 
  UserCircle2, 
  Sun, 
  Moon,
  Workflow,
  BarChart3,
  Sliders,
  Sparkles,
  Globe,
  BookOpen
} from 'lucide-react';
import { useTheme } from '../context/ThemeContext';
import { StorageService } from '../services/storageService';
import { Channel, VAUser } from '../types';

interface NavbarProps {
  activeChannel: Channel;
  onChannelChange: (c: Channel) => void;
  activeUser: VAUser;
  onUserChange: (u: VAUser) => void;
  onOpenSetupWizard?: () => void;
  onOpenLocalization?: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  activeChannel,
  onChannelChange,
  activeUser,
  onUserChange,
  onOpenSetupWizard,
  onOpenLocalization
}) => {
  const { theme, toggleTheme } = useTheme();
  const channels = StorageService.getChannels();
  const users = StorageService.getUsers();

  return (
    <header className="sticky top-0 z-50 bg-surface-100/95 backdrop-blur-md border-b border-border transition-colors">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-14">
          
          {/* Workstation Logo & Title */}
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-foreground text-background flex items-center justify-center font-black text-sm tracking-tighter">
              <Workflow className="w-4 h-4" />
            </div>
            <div className="flex items-baseline gap-2">
              <span className="font-display font-bold text-sm tracking-tight text-foreground">
                TUTORIAL LINE
              </span>
              <span className="text-[10px] uppercase font-mono font-medium text-muted tracking-wider hidden sm:inline">
                DaVinci Suite v1.0
              </span>
            </div>
          </div>

          {/* Linear / Notion Segmented Workspace Tabs */}
          <nav className="hidden md:flex items-center gap-0.5 bg-surface-200 p-1 rounded-lg border border-border">
            <NavLink
              to="/"
              className={({ isActive }) =>
                `flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-semibold transition-all ${
                  isActive
                    ? 'bg-surface-100 text-foreground shadow-subtle border border-border'
                    : 'text-muted hover:text-foreground'
                }`
              }
            >
              <Video className="w-3.5 h-3.5" />
              Conveyor
            </NavLink>

            <NavLink
              to="/studio"
              className={({ isActive }) =>
                `flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-semibold transition-all ${
                  isActive
                    ? 'bg-surface-100 text-foreground shadow-subtle border border-border'
                    : 'text-muted hover:text-foreground'
                }`
              }
            >
              <Sliders className="w-3.5 h-3.5" />
              Studio Pipeline
            </NavLink>

            <NavLink
              to="/thumbnails"
              className={({ isActive }) =>
                `flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-semibold transition-all ${
                  isActive
                    ? 'bg-surface-100 text-foreground shadow-subtle border border-border'
                    : 'text-muted hover:text-foreground'
                }`
              }
            >
              <Palette className="w-3.5 h-3.5" />
              Thumbnails
            </NavLink>

            <NavLink
              to="/keywords"
              className={({ isActive }) =>
                `flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-semibold transition-all ${
                  isActive
                    ? 'bg-surface-100 text-foreground shadow-subtle border border-border'
                    : 'text-muted hover:text-foreground'
                }`
              }
            >
              <Search className="w-3.5 h-3.5" />
              Keywords
            </NavLink>

            <NavLink
              to="/metrics"
              className={({ isActive }) =>
                `flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-semibold transition-all ${
                  isActive
                    ? 'bg-surface-100 text-foreground shadow-subtle border border-border'
                    : 'text-muted hover:text-foreground'
                }`
              }
            >
              <BarChart3 className="w-3.5 h-3.5" />
              Metrics
            </NavLink>

            <NavLink
              to="/finished"
              className={({ isActive }) =>
                `flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-semibold transition-all ${
                  isActive
                    ? 'bg-surface-100 text-foreground shadow-subtle border border-border'
                    : 'text-muted hover:text-foreground'
                }`
              }
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              Queue
            </NavLink>

            <NavLink
              to="/settings"
              className={({ isActive }) =>
                `flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-semibold transition-all ${
                  isActive
                    ? 'bg-surface-100 text-foreground shadow-subtle border border-border'
                    : 'text-muted hover:text-foreground'
                }`
              }
            >
              <Settings className="w-3.5 h-3.5" />
              Settings
            </NavLink>

            <NavLink
              to="/guide"
              className={({ isActive }) =>
                `flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-semibold transition-all ${
                  isActive
                    ? 'bg-surface-100 text-foreground shadow-subtle border border-border'
                    : 'text-muted hover:text-foreground'
                }`
              }
            >
              <BookOpen className="w-3.5 h-3.5" />
              Guide
            </NavLink>
          </nav>

          {/* Right Controls: Setup Wizard, Channel, User, Theme Toggle */}
          <div className="flex items-center gap-2">
            
            {/* Quick Setup Wizard Button */}
            {onOpenSetupWizard && (
              <button
                type="button"
                onClick={onOpenSetupWizard}
                className="hidden xl:flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-surface-200 hover:bg-surface-300 border border-border text-foreground text-xs font-semibold transition-colors"
                title="Open Setup & Account Onboarding Wizard"
              >
                <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                <span>Quick Setup</span>
              </button>
            )}

            {/* Localization Modal Launcher */}
            {onOpenLocalization && (
              <button
                type="button"
                onClick={onOpenLocalization}
                className="hidden lg:flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-surface-200 hover:bg-surface-300 border border-border text-foreground text-xs font-semibold transition-colors"
                title="Multi-Language Localization Factory"
              >
                <Globe className="w-3.5 h-3.5 text-blue-500" />
                <span>Translate</span>
              </button>
            )}

            {/* Dynamic Channel Switcher */}
            <div className="flex items-center gap-1.5 bg-surface-200 px-2.5 py-1.5 rounded-lg border border-border text-xs">
              <Tv className="w-3.5 h-3.5 text-muted" />
              <select
                value={activeChannel.id}
                onChange={(e) => {
                  const ch = channels.find(c => c.id === e.target.value);
                  if (ch) {
                    onChannelChange(ch);
                    StorageService.setActiveChannel(ch);
                  }
                }}
                className="bg-transparent text-xs font-semibold text-foreground outline-none cursor-pointer pr-1 max-w-[130px] truncate"
              >
                {channels.map(ch => (
                  <option key={ch.id} value={ch.id} className="bg-surface-100 text-foreground">
                    {ch.name}
                  </option>
                ))}
              </select>
            </div>

            {/* VA Profile Switcher */}
            <div className="hidden lg:flex items-center gap-1.5 bg-surface-200 px-2.5 py-1.5 rounded-lg border border-border text-xs">
              <UserCircle2 className="w-3.5 h-3.5 text-muted" />
              <select
                value={activeUser.id}
                onChange={(e) => {
                  const u = users.find(usr => usr.id === e.target.value);
                  if (u) {
                    onUserChange(u);
                    StorageService.setActiveUser(u);
                  }
                }}
                className="bg-transparent text-xs font-semibold text-foreground outline-none cursor-pointer max-w-[110px] truncate"
              >
                {users.map(u => (
                  <option key={u.id} value={u.id} className="bg-surface-100 text-foreground">
                    {u.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Dark / Light Theme Toggle */}
            <button
              type="button"
              onClick={toggleTheme}
              className="p-1.5 rounded-lg bg-surface-200 hover:bg-surface-300 border border-border text-foreground transition-colors"
              title={`Switch to ${theme === 'dark' ? 'Light' : 'Dark'} mode`}
            >
              {theme === 'dark' ? (
                <Sun className="w-4 h-4 text-muted hover:text-foreground" />
              ) : (
                <Moon className="w-4 h-4 text-muted hover:text-foreground" />
              )}
            </button>

          </div>

        </div>
      </div>
    </header>
  );
};

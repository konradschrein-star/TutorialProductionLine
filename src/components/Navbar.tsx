import React from 'react';
import { NavLink } from 'react-router-dom';
import { 
  Sparkles, 
  Video, 
  Palette, 
  Search, 
  CheckCircle2, 
  Settings, 
  Tv, 
  UserCircle2, 
  Activity,
  Layers
} from 'lucide-react';
import { StorageService, DEFAULT_CHANNELS, DEFAULT_USERS } from '../services/storageService';
import { Channel, VAUser } from '../types';

interface NavbarProps {
  activeChannel: Channel;
  onChannelChange: (c: Channel) => void;
  activeUser: VAUser;
  onUserChange: (u: VAUser) => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  activeChannel,
  onChannelChange,
  activeUser,
  onUserChange
}) => {
  return (
    <header className="sticky top-0 z-50 bg-surface/90 backdrop-blur-xl border-b border-border">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          
          {/* Logo & Title */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-accent-purple to-accent-cyan p-0.5 shadow-glow flex items-center justify-center">
              <div className="w-full h-full bg-background rounded-[10px] flex items-center justify-center">
                <Sparkles className="w-5 h-5 text-accent-purple animate-pulse" />
              </div>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-display font-black text-lg tracking-tight text-white">
                  TUTORIAL <span className="text-accent-purple">LINE</span>
                </span>
                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-accent-purple/20 text-accent-purple border border-accent-purple/30">
                  PRO
                </span>
              </div>
              <p className="text-[11px] text-slate-400 font-medium">Enterprise Creator Conveyor</p>
            </div>
          </div>

          {/* Navigation Links */}
          <nav className="hidden md:flex items-center gap-1 bg-surface-200/60 p-1 rounded-xl border border-border">
            <NavLink
              to="/"
              className={({ isActive }) =>
                `flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  isActive
                    ? 'bg-accent-purple text-white shadow-glow'
                    : 'text-slate-400 hover:text-white hover:bg-white/5'
                }`
              }
            >
              <Video className="w-3.5 h-3.5" />
              Production Wizard
            </NavLink>

            <NavLink
              to="/thumbnails"
              className={({ isActive }) =>
                `flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  isActive
                    ? 'bg-accent-purple text-white shadow-glow'
                    : 'text-slate-400 hover:text-white hover:bg-white/5'
                }`
              }
            >
              <Palette className="w-3.5 h-3.5" />
              Thumbnail Studio
            </NavLink>

            <NavLink
              to="/keywords"
              className={({ isActive }) =>
                `flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  isActive
                    ? 'bg-accent-purple text-white shadow-glow'
                    : 'text-slate-400 hover:text-white hover:bg-white/5'
                }`
              }
            >
              <Search className="w-3.5 h-3.5" />
              Keyword Hub
            </NavLink>

            <NavLink
              to="/finished"
              className={({ isActive }) =>
                `flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  isActive
                    ? 'bg-accent-purple text-white shadow-glow'
                    : 'text-slate-400 hover:text-white hover:bg-white/5'
                }`
              }
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              Finished Queue
            </NavLink>

            <NavLink
              to="/settings"
              className={({ isActive }) =>
                `flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  isActive
                    ? 'bg-accent-purple text-white shadow-glow'
                    : 'text-slate-400 hover:text-white hover:bg-white/5'
                }`
              }
            >
              <Settings className="w-3.5 h-3.5" />
              Settings
            </NavLink>
          </nav>

          {/* Channel Selector & Active VA */}
          <div className="flex items-center gap-3">
            
            {/* Channel dropdown */}
            <div className="relative flex items-center gap-1.5 bg-surface-100 px-3 py-1.5 rounded-xl border border-border hover:border-accent-purple/40 transition-colors">
              <Tv className="w-3.5 h-3.5" style={{ color: activeChannel.badgeColor }} />
              <select
                value={activeChannel.id}
                onChange={(e) => {
                  const ch = DEFAULT_CHANNELS.find(c => c.id === e.target.value);
                  if (ch) {
                    onChannelChange(ch);
                    StorageService.setActiveChannel(ch);
                  }
                }}
                className="bg-transparent text-xs font-bold text-white outline-none cursor-pointer pr-2"
              >
                {DEFAULT_CHANNELS.map(ch => (
                  <option key={ch.id} value={ch.id} className="bg-surface-100 text-white">
                    {ch.name}
                  </option>
                ))}
              </select>
            </div>

            {/* VA Profile */}
            <div className="flex items-center gap-2 bg-surface-100 px-3 py-1.5 rounded-xl border border-border">
              <UserCircle2 className="w-4 h-4 text-accent-cyan" />
              <select
                value={activeUser.id}
                onChange={(e) => {
                  const u = DEFAULT_USERS.find(usr => usr.id === e.target.value);
                  if (u) {
                    onUserChange(u);
                    StorageService.setActiveUser(u);
                  }
                }}
                className="bg-transparent text-xs font-semibold text-slate-300 outline-none cursor-pointer"
              >
                {DEFAULT_USERS.map(u => (
                  <option key={u.id} value={u.id} className="bg-surface-100 text-white">
                    {u.name} ({u.role})
                  </option>
                ))}
              </select>
            </div>

            {/* Live Indicator */}
            <div className="hidden lg:flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-accent-emerald/10 border border-accent-emerald/30 text-accent-emerald text-[11px] font-semibold">
              <span className="w-1.5 h-1.5 rounded-full bg-accent-emerald animate-ping" />
              <span>Engine Live</span>
            </div>

          </div>

        </div>
      </div>
    </header>
  );
};

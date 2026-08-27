import React, { useState } from 'react';
import { 
  BarChart3, 
  Video, 
  Clock, 
  FolderCheck, 
  Users, 
  Tv, 
  TrendingUp, 
  ExternalLink,
  RefreshCw,
  HardDrive,
  CheckCircle2
} from 'lucide-react';
import { MetricsService } from '../services/metricsService';
import { StorageService } from '../services/storageService';
import { ProductionMetrics, DriveDeliveryItem } from '../types';

export const MetricsDashboard: React.FC = () => {
  const [metrics, setMetrics] = useState<ProductionMetrics>(() => MetricsService.getMetrics());
  const [deliveries, setDeliveries] = useState<DriveDeliveryItem[]>(() => StorageService.getDriveDeliveries());

  const handleRefresh = () => {
    setMetrics(MetricsService.getMetrics());
    setDeliveries(StorageService.getDriveDeliveries());
  };

  const deliveryRate = metrics.totalProduced > 0 
    ? Math.min(100, Math.round((metrics.deliveredToDriveCount / metrics.totalProduced) * 100))
    : 100;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-4 animate-fadeIn">
      
      {/* Header */}
      <div className="pro-panel p-4 rounded-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-foreground" />
            <h1 className="text-sm font-bold font-display text-foreground">
              Production Velocity &amp; Delivery Metrics
            </h1>
          </div>
          <p className="text-[11px] text-muted mt-0.5">
            Real-time tracking of tutorial generation output, operator throughput, and Google Drive cloud delivery sync.
          </p>
        </div>

        <button
          onClick={handleRefresh}
          className="btn-outline px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Refresh Stats
        </button>
      </div>

      {/* KPI Hero Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        
        {/* Total Tutorials */}
        <div className="pro-panel p-4 rounded-xl space-y-1">
          <div className="flex items-center justify-between text-muted">
            <span className="text-[10px] font-mono font-bold uppercase">Total Produced</span>
            <Video className="w-4 h-4 text-foreground" />
          </div>
          <div className="text-2xl font-bold font-mono text-foreground">
            {metrics.totalProduced}
          </div>
          <div className="text-[11px] text-muted flex items-center gap-1">
            <TrendingUp className="w-3 h-3 text-emerald-500" />
            <span>High-throughput conveyor</span>
          </div>
        </div>

        {/* Total Duration Generated */}
        <div className="pro-panel p-4 rounded-xl space-y-1">
          <div className="flex items-center justify-between text-muted">
            <span className="text-[10px] font-mono font-bold uppercase">Generated Watch Time</span>
            <Clock className="w-4 h-4 text-amber-500" />
          </div>
          <div className="text-2xl font-bold font-mono text-foreground">
            {metrics.totalDurationMinutes} <span className="text-sm font-normal text-muted">mins</span>
          </div>
          <div className="text-[11px] text-muted">
            ~{(metrics.totalDurationMinutes / 60).toFixed(1)} hours of tutorial content
          </div>
        </div>

        {/* Google Drive Deliveries */}
        <div className="pro-panel p-4 rounded-xl space-y-1">
          <div className="flex items-center justify-between text-muted">
            <span className="text-[10px] font-mono font-bold uppercase">Google Drive Sync</span>
            <FolderCheck className="w-4 h-4 text-emerald-500" />
          </div>
          <div className="text-2xl font-bold font-mono text-emerald-500">
            {metrics.deliveredToDriveCount}
          </div>
          <div className="text-[11px] text-muted">
            {deliveryRate}% automatic cloud delivery rate
          </div>
        </div>

        {/* In Pipeline */}
        <div className="pro-panel p-4 rounded-xl space-y-1">
          <div className="flex items-center justify-between text-muted">
            <span className="text-[10px] font-mono font-bold uppercase">Active In Pipeline</span>
            <HardDrive className="w-4 h-4 text-blue-500" />
          </div>
          <div className="text-2xl font-bold font-mono text-foreground">
            {metrics.inProductionCount}
          </div>
          <div className="text-[11px] text-muted">
            {metrics.queuedCount} topics ready in pool
          </div>
        </div>

      </div>

      {/* Middle Grid: Daily Velocity + Channel Distribution */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        
        {/* Left (7 cols): Daily Velocity Bar Chart */}
        <div className="lg:col-span-7 pro-panel p-4 rounded-xl space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold font-mono text-foreground uppercase tracking-wider">
              7-Day Production Velocity
            </h3>
            <span className="text-[10px] font-mono text-muted">Tutorials Completed per Day</span>
          </div>

          <div className="h-44 flex items-end justify-between gap-3 pt-6 pb-2 px-2 border-b border-border">
            {metrics.dailyVelocity.map((day, idx) => {
              const maxVal = Math.max(...metrics.dailyVelocity.map(d => d.count), 10);
              const heightPct = Math.max(15, Math.round((day.count / maxVal) * 100));

              return (
                <div key={idx} className="flex-1 flex flex-col items-center gap-1.5 h-full justify-end group">
                  <span className="text-[10px] font-mono font-bold text-foreground opacity-0 group-hover:opacity-100 transition-opacity">
                    {day.count}
                  </span>
                  <div
                    className="w-full max-w-[36px] bg-foreground/90 group-hover:bg-emerald-500 rounded-t transition-all"
                    style={{ height: `${heightPct}%` }}
                  />
                  <span className="text-[10px] font-mono text-muted mt-1">
                    {day.date}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right (5 cols): Channels & VA Breakdown */}
        <div className="lg:col-span-5 pro-panel p-4 rounded-xl space-y-3">
          <h3 className="text-xs font-bold font-mono text-foreground uppercase tracking-wider">
            Channel Distribution &amp; VA Activity
          </h3>

          <div className="space-y-2.5">
            {Object.entries(metrics.channelCounts).map(([chName, count]) => (
              <div key={chName} className="p-2.5 rounded-lg bg-surface-200 border border-border flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <Tv className="w-3.5 h-3.5 text-muted" />
                  <span className="font-semibold text-foreground">{chName}</span>
                </div>
                <span className="font-mono font-bold text-foreground px-2 py-0.5 rounded bg-surface-100 border border-border">
                  {count} videos
                </span>
              </div>
            ))}
          </div>

          <div className="pt-2 border-t border-border space-y-2">
            <div className="text-[10px] font-mono uppercase text-muted font-bold">
              VA Leaderboard Output
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {Object.entries(metrics.vaActivityCounts).map(([name, count]) => (
                <div key={name} className="p-2.5 rounded-lg bg-surface-200 text-xs flex items-center justify-between border border-border">
                  <div className="flex items-center gap-1.5 truncate">
                    <Users className="w-3.5 h-3.5 text-muted flex-shrink-0" />
                    <span className="text-foreground font-semibold truncate text-[11px]">{name}</span>
                  </div>
                  <span className="font-mono font-bold text-foreground text-[11px] px-1.5 py-0.5 rounded bg-surface-100 border border-border">
                    {count} vids
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

      </div>

      {/* Virtual Assistant Productivity & Efficiency Suite */}
      {metrics.vaProductivityList && metrics.vaProductivityList.length > 0 && (
        <div className="pro-panel rounded-xl overflow-hidden shadow-card space-y-3 p-4">
          <div className="flex items-center justify-between border-b border-border pb-3">
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-foreground" />
              <h3 className="text-xs font-bold font-mono text-foreground uppercase tracking-wider">
                Virtual Assistant &amp; Operator Productivity Audit
              </h3>
            </div>
            <span className="text-[10px] font-mono text-muted">
              {metrics.vaProductivityList.length} Active Operators
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-foreground">
              <thead className="bg-surface-200/50 text-[10px] uppercase font-mono font-bold text-muted border-b border-border">
                <tr>
                  <th className="py-2.5 px-3">Operator</th>
                  <th className="py-2.5 px-3">Role</th>
                  <th className="py-2.5 px-3">Assigned Channels</th>
                  <th className="py-2.5 px-3 text-center">Completed</th>
                  <th className="py-2.5 px-3 text-center">In Production</th>
                  <th className="py-2.5 px-3">Watch Time</th>
                  <th className="py-2.5 px-3 text-right">Throughput Rate</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border font-mono text-[11px]">
                {metrics.vaProductivityList.map(va => (
                  <tr key={va.userId} className="hover:bg-surface-200/40 transition-colors">
                    <td className="py-3 px-3">
                      <div className="font-bold font-sans text-foreground">{va.name}</div>
                      <div className="text-[10px] text-muted">{va.email}</div>
                    </td>
                    <td className="py-3 px-3">
                      <span className={`text-[9px] uppercase px-1.5 py-0.5 rounded border font-bold ${
                        va.role === 'admin' 
                          ? 'bg-purple-500/10 text-purple-400 border-purple-500/30'
                          : va.role === 'manager'
                            ? 'bg-blue-500/10 text-blue-400 border-blue-500/30'
                            : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                      }`}>
                        {va.role}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-muted">
                      {va.assignedChannels.length > 0 ? (
                        <div className="flex gap-1 flex-wrap">
                          {va.assignedChannels.map(ch => (
                            <span key={ch} className="px-1 py-0.2 rounded bg-surface-200 text-[10px] text-foreground">
                              {ch}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span>All Channels</span>
                      )}
                    </td>
                    <td className="py-3 px-3 text-center font-bold text-foreground">
                      {va.completedCount}
                    </td>
                    <td className="py-3 px-3 text-center text-amber-500 font-bold">
                      {va.inProductionCount}
                    </td>
                    <td className="py-3 px-3 text-muted">
                      {va.watchTimeMinutes}m (~{(va.watchTimeMinutes / 60).toFixed(1)}h)
                    </td>
                    <td className="py-3 px-3 text-right">
                      <span className="inline-flex items-center gap-1 text-emerald-400 font-bold">
                        <TrendingUp className="w-3 h-3" />
                        {va.efficiencyRating}%
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Google Drive Delivery Log Table */}
      <div className="pro-panel rounded-xl overflow-hidden shadow-card">
        <div className="p-3.5 bg-surface-200/60 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FolderCheck className="w-4 h-4 text-emerald-500" />
            <h3 className="text-xs font-bold font-mono text-foreground uppercase tracking-wider">
              Google Drive Cloud Delivery Stream
            </h3>
          </div>
          <span className="text-[10px] font-mono text-muted">
            {deliveries.length} files synced
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-foreground">
            <thead className="bg-surface-200/40 text-[10px] uppercase font-mono font-bold text-muted border-b border-border">
              <tr>
                <th className="py-2.5 px-4">Title / Video</th>
                <th className="py-2.5 px-3">Channel</th>
                <th className="py-2.5 px-3">Destination Drive Path</th>
                <th className="py-2.5 px-3">File Size</th>
                <th className="py-2.5 px-3">Delivered At</th>
                <th className="py-2.5 px-4 text-right">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {deliveries.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-8 text-xs text-muted">
                    No files delivered to Google Drive yet.
                  </td>
                </tr>
              ) : (
                deliveries.map(del => (
                  <tr key={del.id} className="hover:bg-surface-200/40 transition-colors">
                    <td className="py-2.5 px-4 font-medium text-foreground max-w-xs truncate">
                      {del.title}
                    </td>
                    <td className="py-2.5 px-3 font-mono text-muted text-[11px]">
                      {del.channel}
                    </td>
                    <td className="py-2.5 px-3 font-mono text-emerald-400 text-[11px] max-w-sm truncate">
                      {del.drivePath}
                    </td>
                    <td className="py-2.5 px-3 font-mono text-muted text-[11px]">
                      {(del.fileSize / (1024 * 1024)).toFixed(1)} MB
                    </td>
                    <td className="py-2.5 px-3 font-mono text-muted text-[10px]">
                      {del.uploadedAt}
                    </td>
                    <td className="py-2.5 px-4 text-right">
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                        <CheckCircle2 className="w-3 h-3" /> Synced
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  );
};

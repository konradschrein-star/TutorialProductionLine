import React, { useSyncExternalStore, useState } from 'react';
import { CloudUpload, ChevronUp, ChevronDown, CheckCircle2, AlertCircle, RefreshCw, X } from 'lucide-react';
import { uploadManager } from '../services/uploadManager';
import { UploadQueueItem } from '../types';

export const RecordingUploadQueue: React.FC = () => {
  const uploads = useSyncExternalStore(
    uploadManager.subscribe.bind(uploadManager),
    uploadManager.getSnapshot.bind(uploadManager)
  );

  const [collapsed, setCollapsed] = useState(false);

  if (uploads.length === 0) return null;

  const active = uploads.filter(u => u.state === 'uploading' || u.state === 'finalizing').length;
  const failed = uploads.filter(u => u.state === 'error').length;
  const done = uploads.filter(u => u.state === 'done').length;

  const totalBytes = uploads.reduce((acc, u) => acc + u.fileSize, 0);
  const doneBytes = uploads.reduce((acc, u) => acc + u.uploadedBytes, 0);
  const overallPct = totalBytes > 0 ? Math.min(100, (doneBytes / totalBytes) * 100) : 0;

  return (
    <div className="fixed bottom-6 right-6 w-96 z-50 bg-surface/95 backdrop-blur-2xl border border-white/15 rounded-2xl shadow-glass overflow-hidden transition-all duration-300">
      
      {/* Header Bar */}
      <button
        type="button"
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center justify-between p-3.5 bg-white/5 hover:bg-white/10 transition-colors text-left"
      >
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-accent-purple/20 border border-accent-purple/40 flex items-center justify-center text-accent-purple">
            <CloudUpload className="w-4 h-4 animate-bounce" />
          </div>
          <div>
            <div className="text-xs font-bold text-white flex items-center gap-2">
              <span>Stealth Upload Queue</span>
              {active > 0 && (
                <span className="px-1.5 py-0.5 rounded bg-accent-cyan/20 text-accent-cyan text-[10px] font-extrabold">
                  {overallPct.toFixed(0)}%
                </span>
              )}
            </div>
            <p className="text-[11px] text-slate-400">
              {active > 0
                ? `Uploading ${active} video${active > 1 ? 's' : ''}...`
                : failed > 0
                ? `${failed} need attention`
                : `${done} video${done > 1 ? 's' : ''} staged & ready`}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 text-slate-400">
          {collapsed ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </div>
      </button>

      {/* Upload Item Rows */}
      {!collapsed && (
        <div className="max-h-72 overflow-y-auto divide-y divide-white/5 p-2">
          {uploads.map(item => {
            const pct = item.fileSize > 0 ? (item.uploadedBytes / item.fileSize) * 100 : 0;

            return (
              <div key={item.jobId} className="p-3 hover:bg-white/[0.02] rounded-xl transition-colors">
                <div className="flex items-start justify-between gap-2 mb-1.5">
                  <div className="min-w-0 flex-1">
                    <h5 className="text-xs font-semibold text-white truncate" title={item.jobTitle}>
                      {item.jobTitle}
                    </h5>
                    <span className="text-[10px] text-accent-purple font-medium">
                      {item.channelName}
                    </span>
                  </div>

                  <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${
                    item.state === 'done'
                      ? 'bg-accent-emerald/20 text-accent-emerald'
                      : item.state === 'error'
                      ? 'bg-accent-rose/20 text-accent-rose'
                      : 'bg-accent-cyan/20 text-accent-cyan'
                  }`}>
                    {item.state}
                  </span>
                </div>

                {/* Progress bar */}
                <div className="w-full bg-white/10 h-1.5 rounded-full overflow-hidden my-2">
                  <div
                    className="h-full bg-gradient-to-r from-accent-purple to-accent-cyan transition-all duration-300 rounded-full"
                    style={{ width: `${pct}%` }}
                  />
                </div>

                <div className="flex items-center justify-between text-[10px] text-slate-400 font-mono">
                  <span>
                    {(item.uploadedBytes / (1024 * 1024)).toFixed(1)}MB / {(item.fileSize / (1024 * 1024)).toFixed(1)}MB
                  </span>
                  <span>
                    {item.state === 'uploading' && item.etaSeconds ? `${item.etaSeconds}s remaining` : ''}
                  </span>
                </div>

                {/* Action buttons */}
                <div className="flex items-center justify-end gap-2 mt-2">
                  {item.state === 'error' && (
                    <button
                      onClick={() => uploadManager.retry(item.jobId)}
                      className="px-2 py-1 rounded bg-accent-purple text-white text-[10px] font-bold flex items-center gap-1"
                    >
                      <RefreshCw className="w-2.5 h-2.5" /> Retry
                    </button>
                  )}
                  <button
                    onClick={() => uploadManager.dismiss(item.jobId)}
                    className="text-slate-400 hover:text-white p-1"
                    title="Dismiss"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Footer advice */}
      {!collapsed && (
        <div className="p-2.5 bg-black/40 border-t border-white/5 text-[10px] text-slate-400 text-center">
          Uploads persist across tabs. Feel free to start the next video.
        </div>
      )}

    </div>
  );
};

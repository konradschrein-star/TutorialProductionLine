import React, { useSyncExternalStore, useState } from 'react';
import { CloudUpload, ChevronUp, ChevronDown, RefreshCw, X } from 'lucide-react';
import { uploadManager } from '../services/uploadManager';

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
    <div className="fixed bottom-5 right-5 w-88 z-50 bg-surface-100 border border-border rounded-xl shadow-elevation overflow-hidden transition-all duration-200">
      
      {/* Header Bar */}
      <button
        type="button"
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center justify-between p-3 bg-surface-200/60 hover:bg-surface-200 transition-colors text-left border-b border-border"
      >
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-md bg-foreground text-background flex items-center justify-center">
            <CloudUpload className="w-3.5 h-3.5" />
          </div>
          <div>
            <div className="text-xs font-bold text-foreground flex items-center gap-1.5">
              <span>Background Dispatch</span>
              {active > 0 && (
                <span className="px-1.5 py-0.2 rounded bg-surface-300 text-foreground text-[10px] font-mono font-bold">
                  {overallPct.toFixed(0)}%
                </span>
              )}
            </div>
            <p className="text-[11px] text-muted font-mono">
              {active > 0
                ? `${active} stream${active > 1 ? 's' : ''} active`
                : failed > 0
                ? `${failed} failed`
                : `${done} job${done > 1 ? 's' : ''} staged`}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 text-muted">
          {collapsed ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </div>
      </button>

      {/* Upload Item Rows */}
      {!collapsed && (
        <div className="max-h-64 overflow-y-auto divide-y divide-border p-1">
          {uploads.map(item => {
            const pct = item.fileSize > 0 ? (item.uploadedBytes / item.fileSize) * 100 : 0;

            return (
              <div key={item.jobId} className="p-2.5 hover:bg-surface-200/50 rounded-lg transition-colors">
                <div className="flex items-start justify-between gap-2 mb-1">
                  <div className="min-w-0 flex-1">
                    <h5 className="text-xs font-semibold text-foreground truncate" title={item.jobTitle}>
                      {item.jobTitle}
                    </h5>
                    <span className="text-[10px] text-muted font-mono">
                      {item.channelName}
                    </span>
                  </div>

                  <span className="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded bg-surface-300 text-foreground font-bold">
                    {item.state}
                  </span>
                </div>

                {/* Linear Style Monochrome Progress Bar */}
                <div className="w-full bg-surface-300 h-1 rounded-full overflow-hidden my-1.5">
                  <div
                    className="h-full bg-foreground transition-all duration-200 rounded-full"
                    style={{ width: `${pct}%` }}
                  />
                </div>

                <div className="flex items-center justify-between text-[10px] text-muted font-mono">
                  <span>
                    {(item.uploadedBytes / (1024 * 1024)).toFixed(1)}MB / {(item.fileSize / (1024 * 1024)).toFixed(1)}MB
                  </span>
                  <span>
                    {item.state === 'uploading' && item.etaSeconds ? `${item.etaSeconds}s remaining` : ''}
                  </span>
                </div>

                {/* Actions */}
                <div className="flex items-center justify-end gap-1.5 mt-1.5">
                  {item.state === 'error' && (
                    <button
                      onClick={() => uploadManager.retry(item.jobId)}
                      className="btn-outline px-2 py-0.5 rounded text-[10px] font-bold flex items-center gap-1"
                    >
                      <RefreshCw className="w-2.5 h-2.5" /> Retry
                    </button>
                  )}
                  <button
                    onClick={() => uploadManager.dismiss(item.jobId)}
                    className="text-muted hover:text-foreground p-0.5"
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
        <div className="p-2 bg-surface-200 text-[10px] text-muted text-center border-t border-border font-mono">
          Uploads persist in background.
        </div>
      )}

    </div>
  );
};

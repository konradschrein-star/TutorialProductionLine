'use client';

import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';

interface ComparisonResearchUploadProps {
  jobId: string;
  productAName: string;
  productBName: string;
  researchPrompts: string[];
}

export function ComparisonResearchUpload({
  jobId,
  productAName,
  productBName,
  researchPrompts,
}: ComparisonResearchUploadProps) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function uploadFiles(fileList: FileList) {
    if (fileList.length === 0 || uploading) return;
    setUploading(true);
    setError(null);

    try {
      const fd = new FormData();
      fd.append('job_id', jobId);
      const names: string[] = [];
      for (const f of Array.from(fileList)) {
        fd.append('research_files', f);
        names.push(f.name);
      }

      const res = await fetch('/api/jobs/comparison-upload', {
        method: 'POST',
        body: fd,
        credentials: 'same-origin',
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? `Upload failed (${res.status})`);
        return;
      }

      setUploadedFiles(names);
      setDone(true);
      // Delay refresh slightly so user sees the success state
      setTimeout(() => router.refresh(), 1200);
    } catch (err) {
      setError(String(err));
    } finally {
      setUploading(false);
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setDragging(false);
    if (e.dataTransfer.files.length > 0) {
      uploadFiles(e.dataTransfer.files);
    }
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setDragging(true);
  }

  function handleDragLeave(e: React.DragEvent) {
    // Only fire if leaving the container entirely (not entering a child)
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setDragging(false);
    }
  }

  function handleBrowse(e: React.MouseEvent) {
    e.stopPropagation();
    fileInputRef.current?.click();
  }

  function handleFileInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files && e.target.files.length > 0) {
      uploadFiles(e.target.files);
    }
  }

  // Success state
  if (done) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '16px 20px',
          background: 'rgba(52,211,153,0.06)',
          border: '1px solid rgba(52,211,153,0.2)',
          borderRadius: 10,
        }}>
          <span className="material-symbols-outlined" style={{ fontSize: 20, color: '#34d399' }}>check_circle</span>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#34d399' }}>Research uploaded</div>
            <div style={{ fontSize: 11, color: 'rgba(205,195,215,0.5)', marginTop: 2 }}>
              {uploadedFiles.join(', ')} — script generation started
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>

      {/* VS header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{
          flex: 1, padding: '9px 14px',
          background: 'rgba(255,107,107,0.06)', border: '1px solid rgba(255,107,107,0.2)',
          borderRadius: 8, fontSize: 14, fontWeight: 700, color: '#e5e2e1', textAlign: 'center',
        }}>
          {productAName || 'Product A'}
        </div>
        <span style={{ fontSize: 13, fontWeight: 900, color: 'var(--v2-accent)', flexShrink: 0 }}>VS</span>
        <div style={{
          flex: 1, padding: '9px 14px',
          background: 'rgba(72,219,251,0.06)', border: '1px solid rgba(72,219,251,0.2)',
          borderRadius: 8, fontSize: 14, fontWeight: 700, color: '#e5e2e1', textAlign: 'center',
        }}>
          {productBName || 'Product B'}
        </div>
      </div>

      {/* Research prompts */}
      {researchPrompts.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="material-symbols-outlined" style={{ fontSize: 13, color: 'var(--v2-accent)' }}>psychology</span>
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(205,195,215,0.45)' }}>
              Research Prompts
            </span>
            <span style={{ fontSize: 10, color: 'rgba(205,195,215,0.25)' }}>— use these to guide your research</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {researchPrompts.map((prompt, i) => (
              <div key={i} style={{
                display: 'flex', gap: 10, alignItems: 'flex-start',
                padding: '9px 13px',
                background: 'rgba(255,255,255,0.02)',
                border: '1px solid rgba(170,255,0,0.07)',
                borderRadius: 7,
              }}>
                <span style={{
                  fontSize: 10, fontWeight: 800, color: 'var(--v2-accent)',
                  background: 'rgba(170,255,0,0.1)', borderRadius: 4,
                  padding: '2px 6px', flexShrink: 0, marginTop: 1, lineHeight: '14px',
                }}>
                  {i + 1}
                </span>
                <span style={{ fontSize: 12, color: 'rgba(205,195,215,0.7)', lineHeight: 1.5 }}>
                  {prompt}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div style={{
          display: 'flex', gap: 10, alignItems: 'flex-start',
          padding: '12px 14px',
          background: 'rgba(248,113,113,0.06)',
          border: '1px solid rgba(248,113,113,0.25)',
          borderRadius: 8,
        }}>
          <span className="material-symbols-outlined" style={{ fontSize: 16, color: '#f87171', flexShrink: 0, marginTop: 1 }}>error</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#f87171', marginBottom: 3 }}>Upload failed</div>
            <div style={{ fontSize: 11, color: 'rgba(248,113,113,0.7)', lineHeight: 1.4 }}>{error}</div>
          </div>
          <button
            type="button"
            onClick={() => setError(null)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(248,113,113,0.5)', padding: 2, lineHeight: 1, flexShrink: 0 }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 14 }}>close</span>
          </button>
        </div>
      )}

      {/* Drop zone — auto-uploads on drop */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        style={{
          border: `2px dashed ${dragging ? 'rgba(170,255,0,0.6)' : uploading ? 'rgba(170,255,0,0.3)' : 'rgba(170,255,0,0.2)'}`,
          borderRadius: 10,
          padding: uploading ? '32px 24px' : '28px 24px',
          textAlign: 'center',
          background: dragging ? 'rgba(170,255,0,0.05)' : 'rgba(255,255,255,0.01)',
          transition: 'all 0.15s ease',
          pointerEvents: uploading ? 'none' : 'auto',
        }}
      >
        {uploading ? (
          <>
            <span className="material-symbols-outlined" style={{ fontSize: 28, color: 'var(--v2-accent)', display: 'block', marginBottom: 10, animation: 'spin 1s linear infinite' }}>
              progress_activity
            </span>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'rgba(205,195,215,0.6)' }}>
              Uploading research files…
            </div>
          </>
        ) : dragging ? (
          <>
            <span className="material-symbols-outlined" style={{ fontSize: 32, color: 'var(--v2-accent)', display: 'block', marginBottom: 10 }}>
              file_download
            </span>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--v2-accent)' }}>Drop to upload</div>
          </>
        ) : (
          <>
            <span className="material-symbols-outlined" style={{ fontSize: 28, color: 'rgba(170,255,0,0.35)', display: 'block', marginBottom: 10 }}>
              upload_file
            </span>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'rgba(205,195,215,0.55)', marginBottom: 6 }}>
              Drag research files here to upload instantly
            </div>
            <div style={{ fontSize: 11, color: 'rgba(205,195,215,0.3)', marginBottom: 14 }}>
              .txt, .md, .pdf — Perplexity exports, notes, specs
            </div>
            <button
              type="button"
              onClick={handleBrowse}
              style={{
                padding: '7px 16px', borderRadius: 7, fontSize: 12, fontWeight: 600,
                border: '1px solid rgba(170,255,0,0.25)',
                background: 'rgba(170,255,0,0.05)',
                color: 'var(--v2-accent)', cursor: 'pointer',
              }}
            >
              Browse files
            </button>
          </>
        )}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".txt,.md,.pdf,.docx,.json,.csv"
          style={{ display: 'none' }}
          onChange={handleFileInputChange}
        />
      </div>

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

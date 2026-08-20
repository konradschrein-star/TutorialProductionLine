'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { GlassCard } from '@/app/(authenticated)/_components';

interface ComparisonDataGridEditorProps {
  jobId: string;
  productAName: string;
  productBName: string;
  initialDataGrid: {
    dimensions: string[];
    scores: Record<string, Record<string, number>>;
    raw_specs: Record<string, Record<string, string>>;
    pricing: Record<string, string>;
    facts_sources: string[];
    audited_at: string | null;
    audited_by_va_id: string | null;
  } | null;
  currentUserId: string | null;
}

export function ComparisonDataGridEditor({
  jobId,
  productAName,
  productBName,
  initialDataGrid,
  currentUserId,
}: ComparisonDataGridEditorProps) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Initialize state from initial data or defaults
  const [dimensions, setDimensions] = useState<string[]>(
    initialDataGrid?.dimensions ?? ['Features', 'Performance', 'Price', 'UX', 'Support']
  );
  const [scoresA, setScoresA] = useState<Record<string, number>>(
    initialDataGrid?.scores?.[productAName] ?? {}
  );
  const [scoresB, setScoresB] = useState<Record<string, number>>(
    initialDataGrid?.scores?.[productBName] ?? {}
  );
  const [pricingA, setPricingA] = useState(
    initialDataGrid?.pricing?.[productAName] ?? ''
  );
  const [pricingB, setPricingB] = useState(
    initialDataGrid?.pricing?.[productBName] ?? ''
  );
  const [sources, setSources] = useState<string[]>(
    initialDataGrid?.facts_sources ?? ['']
  );

  const isAudited = !!initialDataGrid?.audited_at;

  function addDimension() {
    setDimensions([...dimensions, `Dimension ${dimensions.length + 1}`]);
  }

  function removeDimension(index: number) {
    const newDims = dimensions.filter((_, i) => i !== index);
    setDimensions(newDims);
    // Remove scores for deleted dimension
    const dim = dimensions[index];
    const newScoresA = { ...scoresA };
    const newScoresB = { ...scoresB };
    delete newScoresA[dim];
    delete newScoresB[dim];
    setScoresA(newScoresA);
    setScoresB(newScoresB);
  }

  function updateDimension(index: number, value: string) {
    const oldDim = dimensions[index];
    const newDims = [...dimensions];
    newDims[index] = value;
    setDimensions(newDims);

    // Update scores to use new dimension name
    if (oldDim !== value) {
      const newScoresA = { ...scoresA };
      const newScoresB = { ...scoresB };
      if (newScoresA[oldDim] !== undefined) {
        newScoresA[value] = newScoresA[oldDim];
        delete newScoresA[oldDim];
      }
      if (newScoresB[oldDim] !== undefined) {
        newScoresB[value] = newScoresB[oldDim];
        delete newScoresB[oldDim];
      }
      setScoresA(newScoresA);
      setScoresB(newScoresB);
    }
  }

  function updateScore(product: 'A' | 'B', dimension: string, value: number) {
    if (product === 'A') {
      setScoresA({ ...scoresA, [dimension]: value });
    } else {
      setScoresB({ ...scoresB, [dimension]: value });
    }
  }

  function addSource() {
    setSources([...sources, '']);
  }

  function removeSource(index: number) {
    setSources(sources.filter((_, i) => i !== index));
  }

  function updateSource(index: number, value: string) {
    const newSources = [...sources];
    newSources[index] = value;
    setSources(newSources);
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSuccess(false);

    try {
      // Build data grid payload
      const dataGrid = {
        dimensions,
        scores: {
          [productAName]: scoresA,
          [productBName]: scoresB,
        },
        raw_specs: initialDataGrid?.raw_specs ?? {},
        pricing: {
          [productAName]: pricingA,
          [productBName]: pricingB,
        },
        facts_sources: sources.filter((s) => s.trim() !== ''),
        audited_at: initialDataGrid?.audited_at,
        audited_by_va_id: initialDataGrid?.audited_by_va_id,
      };

      const res = await fetch('/api/jobs/comparison-metadata', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ job_id: jobId, data_grid: dataGrid }),
        credentials: 'same-origin',
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? `Save failed (${res.status})`);
        return;
      }

      setSuccess(true);
      setTimeout(() => {
        setSuccess(false);
        router.refresh();
      }, 1500);
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleAudit() {
    setSaving(true);
    setError(null);

    try {
      const dataGrid = {
        dimensions,
        scores: {
          [productAName]: scoresA,
          [productBName]: scoresB,
        },
        raw_specs: initialDataGrid?.raw_specs ?? {},
        pricing: {
          [productAName]: pricingA,
          [productBName]: pricingB,
        },
        facts_sources: sources.filter((s) => s.trim() !== ''),
        audited_at: new Date().toISOString(),
        audited_by_va_id: currentUserId,
      };

      const res = await fetch('/api/jobs/comparison-metadata', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ job_id: jobId, data_grid: dataGrid }),
        credentials: 'same-origin',
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? `Audit failed (${res.status})`);
        return;
      }

      router.refresh();
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h3 style={{ fontSize: 15, fontWeight: 700, color: '#e5e2e1', margin: '0 0 4px 0' }}>
            Comparison Data Grid
          </h3>
          <p style={{ fontSize: 11, color: '#cdc3d7', margin: 0 }}>
            Edit scores, pricing, and source URLs for this comparison
          </p>
        </div>
        {isAudited && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '6px 12px',
            background: 'rgba(52,211,153,0.08)',
            border: '1px solid rgba(52,211,153,0.2)',
            borderRadius: 8,
          }}>
            <span className="material-symbols-outlined" style={{ fontSize: 14, color: '#34d399' }}>
              verified
            </span>
            <span style={{ fontSize: 11, fontWeight: 600, color: '#34d399' }}>Audited</span>
          </div>
        )}
      </div>

      {/* Product Names Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{
          flex: 1, padding: '10px 14px',
          background: 'rgba(255,107,107,0.06)', border: '1px solid rgba(255,107,107,0.2)',
          borderRadius: 8, fontSize: 14, fontWeight: 700, color: '#e5e2e1', textAlign: 'center',
        }}>
          {productAName}
        </div>
        <span style={{ fontSize: 13, fontWeight: 900, color: 'var(--v2-accent)', flexShrink: 0 }}>VS</span>
        <div style={{
          flex: 1, padding: '10px 14px',
          background: 'rgba(72,219,251,0.06)', border: '1px solid rgba(72,219,251,0.2)',
          borderRadius: 8, fontSize: 14, fontWeight: 700, color: '#e5e2e1', textAlign: 'center',
        }}>
          {productBName}
        </div>
      </div>

      {/* Dimensions & Scores */}
      <GlassCard style={{ padding: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="material-symbols-outlined" style={{ fontSize: 14, color: 'var(--v2-accent)' }}>
              grid_on
            </span>
            <span style={{ fontSize: 12, fontWeight: 700, color: '#e5e2e1' }}>
              Dimensions & Scores
            </span>
          </div>
          <button
            type="button"
            onClick={addDimension}
            style={{
              padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600,
              border: '1px solid rgba(var(--v2-accent-rgb), 0.25)',
              background: 'rgba(var(--v2-accent-rgb), 0.05)',
              color: 'var(--v2-accent)', cursor: 'pointer',
            }}
          >
            + Add Dimension
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {dimensions.map((dim, i) => (
            <div key={i} style={{
              display: 'grid', gridTemplateColumns: '1fr auto auto auto', gap: 10, alignItems: 'center',
              padding: 12,
              background: 'rgba(255,255,255,0.02)',
              border: '1px solid rgba(var(--v2-accent-rgb), 0.1)',
              borderRadius: 8,
            }}>
              <input
                type="text"
                value={dim}
                onChange={(e) => updateDimension(i, e.target.value)}
                style={{
                  padding: '6px 10px', borderRadius: 6, fontSize: 12,
                  border: '1px solid rgba(var(--v2-accent-rgb), 0.15)',
                  background: 'rgba(255,255,255,0.03)',
                  color: '#e5e2e1',
                }}
              />
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 80 }}>
                <span style={{ fontSize: 10, color: '#ff6b6b', fontWeight: 600 }}>A:</span>
                <input
                  type="number"
                  min="0"
                  max="10"
                  value={scoresA[dim] ?? 5}
                  onChange={(e) => updateScore('A', dim, parseFloat(e.target.value))}
                  style={{
                    width: 50, padding: '4px 6px', borderRadius: 5, fontSize: 11,
                    border: '1px solid rgba(255,107,107,0.25)',
                    background: 'rgba(255,107,107,0.05)',
                    color: '#e5e2e1',
                  }}
                />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 80 }}>
                <span style={{ fontSize: 10, color: '#48dbfb', fontWeight: 600 }}>B:</span>
                <input
                  type="number"
                  min="0"
                  max="10"
                  value={scoresB[dim] ?? 5}
                  onChange={(e) => updateScore('B', dim, parseFloat(e.target.value))}
                  style={{
                    width: 50, padding: '4px 6px', borderRadius: 5, fontSize: 11,
                    border: '1px solid rgba(72,219,251,0.25)',
                    background: 'rgba(72,219,251,0.05)',
                    color: '#e5e2e1',
                  }}
                />
              </div>
              <button
                type="button"
                onClick={() => removeDimension(i)}
                style={{
                  padding: 4, borderRadius: 5, border: 'none',
                  background: 'rgba(248,113,113,0.08)',
                  cursor: 'pointer',
                }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 14, color: '#f87171' }}>
                  close
                </span>
              </button>
            </div>
          ))}
        </div>
      </GlassCard>

      {/* Pricing */}
      <GlassCard style={{ padding: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
          <span className="material-symbols-outlined" style={{ fontSize: 14, color: 'var(--v2-accent)' }}>
            payments
          </span>
          <span style={{ fontSize: 12, fontWeight: 700, color: '#e5e2e1' }}>
            Pricing
          </span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <label style={{ fontSize: 10, color: '#cdc3d7', marginBottom: 6, display: 'block' }}>
              {productAName}
            </label>
            <input
              type="text"
              value={pricingA}
              onChange={(e) => setPricingA(e.target.value)}
              placeholder="e.g., Free (Open Source)"
              style={{
                width: '100%', padding: '8px 12px', borderRadius: 6, fontSize: 12,
                border: '1px solid rgba(var(--v2-accent-rgb), 0.15)',
                background: 'rgba(255,255,255,0.03)',
                color: '#e5e2e1',
              }}
            />
          </div>
          <div>
            <label style={{ fontSize: 10, color: '#cdc3d7', marginBottom: 6, display: 'block' }}>
              {productBName}
            </label>
            <input
              type="text"
              value={pricingB}
              onChange={(e) => setPricingB(e.target.value)}
              placeholder="e.g., $8.90/mo · Free trial"
              style={{
                width: '100%', padding: '8px 12px', borderRadius: 6, fontSize: 12,
                border: '1px solid rgba(var(--v2-accent-rgb), 0.15)',
                background: 'rgba(255,255,255,0.03)',
                color: '#e5e2e1',
              }}
            />
          </div>
        </div>
      </GlassCard>

      {/* Source URLs */}
      <GlassCard style={{ padding: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="material-symbols-outlined" style={{ fontSize: 14, color: 'var(--v2-accent)' }}>
              link
            </span>
            <span style={{ fontSize: 12, fontWeight: 700, color: '#e5e2e1' }}>
              Source URLs
            </span>
          </div>
          <button
            type="button"
            onClick={addSource}
            style={{
              padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600,
              border: '1px solid rgba(var(--v2-accent-rgb), 0.25)',
              background: 'rgba(var(--v2-accent-rgb), 0.05)',
              color: 'var(--v2-accent)', cursor: 'pointer',
            }}
          >
            + Add Source
          </button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {sources.map((url, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                type="url"
                value={url}
                onChange={(e) => updateSource(i, e.target.value)}
                placeholder="https://..."
                style={{
                  flex: 1, padding: '8px 12px', borderRadius: 6, fontSize: 11,
                  border: '1px solid rgba(var(--v2-accent-rgb), 0.15)',
                  background: 'rgba(255,255,255,0.03)',
                  color: '#e5e2e1',
                }}
              />
              <button
                type="button"
                onClick={() => removeSource(i)}
                style={{
                  padding: 6, borderRadius: 5, border: 'none',
                  background: 'rgba(248,113,113,0.08)',
                  cursor: 'pointer',
                }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 14, color: '#f87171' }}>
                  close
                </span>
              </button>
            </div>
          ))}
        </div>
      </GlassCard>

      {/* Error */}
      {error && (
        <div style={{
          display: 'flex', gap: 10, alignItems: 'flex-start',
          padding: '12px 14px',
          background: 'rgba(248,113,113,0.06)',
          border: '1px solid rgba(248,113,113,0.25)',
          borderRadius: 8,
        }}>
          <span className="material-symbols-outlined" style={{ fontSize: 16, color: '#f87171', flexShrink: 0 }}>
            error
          </span>
          <div style={{ flex: 1, fontSize: 11, color: '#f87171' }}>{error}</div>
          <button
            type="button"
            onClick={() => setError(null)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(248,113,113,0.5)', padding: 2 }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 14 }}>close</span>
          </button>
        </div>
      )}

      {/* Success */}
      {success && (
        <div style={{
          display: 'flex', gap: 10, alignItems: 'center',
          padding: '12px 14px',
          background: 'rgba(52,211,153,0.06)',
          border: '1px solid rgba(52,211,153,0.2)',
          borderRadius: 8,
        }}>
          <span className="material-symbols-outlined" style={{ fontSize: 16, color: '#34d399' }}>
            check_circle
          </span>
          <span style={{ fontSize: 12, fontWeight: 600, color: '#34d399' }}>
            Data grid saved successfully
          </span>
        </div>
      )}

      {/* Actions */}
      <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          style={{
            padding: '10px 20px', borderRadius: 8, fontSize: 12, fontWeight: 600,
            border: '1px solid rgba(var(--v2-accent-rgb), 0.25)',
            background: 'rgba(var(--v2-accent-rgb), 0.08)',
            color: 'var(--v2-accent)', cursor: saving ? 'not-allowed' : 'pointer',
            opacity: saving ? 0.5 : 1,
          }}
        >
          {saving ? 'Saving...' : 'Save Changes'}
        </button>
        {!isAudited && (
          <button
            type="button"
            onClick={handleAudit}
            disabled={saving}
            style={{
              padding: '10px 20px', borderRadius: 8, fontSize: 12, fontWeight: 600,
              border: '1px solid rgba(52,211,153,0.3)',
              background: 'rgba(52,211,153,0.1)',
              color: '#34d399', cursor: saving ? 'not-allowed' : 'pointer',
              opacity: saving ? 0.5 : 1,
            }}
          >
            {saving ? 'Auditing...' : 'Confirm Audit ✓'}
          </button>
        )}
      </div>
    </div>
  );
}

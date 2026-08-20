'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { updateChannel } from '@/app/actions/channels';
import type { Channel } from '@/lib/repositories/channel-repository';

interface Props {
  channel: Channel;
}

export function V2ChannelEditForm({ channel }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState(channel.name);
  const [youtubeChannelId, setYoutubeChannelId] = useState(channel.youtube_channel_id);
  const [errors, setErrors] = useState<Record<string, string>>({});

  function validate(): boolean {
    const next: Record<string, string> = {};
    if (!name.trim()) next.name = 'Name is required';
    if (!youtubeChannelId.trim()) {
      next.ytid = 'YouTube Channel ID is required';
    } else if (!/^UC[a-zA-Z0-9_-]{22}$/.test(youtubeChannelId)) {
      next.ytid = 'Must start with UC and be 24 characters total';
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    setLoading(true);
    const result = await updateChannel(channel.id, { name, youtube_channel_id: youtubeChannelId });
    if (result.success) {
      router.push('/channels');
    } else {
      setErrors({ form: result.error || 'Failed to update channel' });
      setLoading(false);
    }
  }

  const inputStyle = (hasError?: boolean): React.CSSProperties => ({
    width: '100%',
    padding: '10px 14px',
    background: '#111',
    border: `1px solid ${hasError ? 'rgba(255,180,171,0.5)' : 'rgba(75,68,85,0.4)'}`,
    borderRadius: 8,
    color: '#e5e2e1',
    fontSize: 13,
    outline: 'none',
    boxSizing: 'border-box',
  });

  const labelStyle: React.CSSProperties = {
    fontSize: 10,
    fontWeight: 700,
    color: '#cdc3d7',
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
  };

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <label style={labelStyle}>Channel Name</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          style={inputStyle(!!errors.name)}
        />
        {errors.name && <span style={{ fontSize: 11, color: '#ffb4ab' }}>{errors.name}</span>}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <label style={labelStyle}>YouTube Channel ID</label>
        <input
          type="text"
          value={youtubeChannelId}
          onChange={(e) => setYoutubeChannelId(e.target.value)}
          style={{ ...inputStyle(!!errors.ytid), fontFamily: 'monospace' }}
        />
        {errors.ytid ? (
          <span style={{ fontSize: 11, color: '#ffb4ab' }}>{errors.ytid}</span>
        ) : (
          <span style={{ fontSize: 10, color: 'rgba(205,195,215,0.4)' }}>
            Found on your YouTube channel page URL (starts with UC, 24 chars)
          </span>
        )}
      </div>

      {errors.form && <span style={{ fontSize: 12, color: '#ffb4ab' }}>{errors.form}</span>}

      <div style={{ display: 'flex', gap: 10, paddingTop: 4 }}>
        <button type="submit" disabled={loading} className="v2-btn-accent" style={{ opacity: loading ? 0.6 : 1 }}>
          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>save</span>
          {loading ? 'Saving…' : 'Save Changes'}
        </button>
        <Link href="/channels" className="v2-btn">Cancel</Link>
      </div>
    </form>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { V2Button, V2Card } from "../../../_components";
import { V2Listbox } from "@/components/thumbnails/v2-listbox";

/**
 * The channel's narration voice.
 *
 * `channels.voice_id` shipped in migration 0060 with no screen able to set it,
 * so the only way to bind a voice was SQL — and all three live tutorial
 * channels ended up silently sharing one hardcoded voice. Every video on every
 * channel sounded like the same person. That is invisible until someone
 * notices, and obvious forever after.
 *
 * The unset option is deliberate and stays: null means "use the pipeline
 * default", and removing it from the UI would make a real state unreachable.
 */

const UNSET = "__unset__";

interface Voice {
  id: string;
  name: string;
  provider: string;
  voiceId: string;
  language: string | null;
  isActive: boolean;
  isDefault: boolean;
  selectable: boolean;
}

interface Payload {
  channel: {
    id: string;
    name: string;
    language: string | null;
    voiceId: string | null;
  };
  voices: Voice[];
}

/**
 * The channel's public YouTube identity, when we can see it.
 *
 * Shown here because the Voice tab is where someone thinks about "who is this
 * channel", and because a channel page with no sense of the real channel is
 * abstract. When the API is not configured it SAYS so — it does not render a
 * blank avatar and an empty number as though the channel had no audience.
 */
function YouTubeIdentity({ channelId }: { channelId: string }) {
  const [state, setState] = useState<{
    configured?: boolean;
    reason?: string;
    title?: string | null;
    avatarUrl?: string | null;
    subscriberCount?: number | null;
    stale?: boolean;
  } | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch(`/api/channels/${channelId}/youtube-stats`);
        setState(await res.json());
      } catch {
        /* cosmetic — never block the page on it */
      }
    })();
  }, [channelId]);

  if (!state) return null;

  return (
    <V2Card style={{ padding: 14, maxWidth: 620, marginBottom: 16 }}>
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        {state.avatarUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={state.avatarUrl}
            alt=""
            style={{ width: 44, height: 44, borderRadius: "50%" }}
          />
        )}
        <div style={{ fontSize: 12 }}>
          {state.title && <div style={{ fontWeight: 700 }}>{state.title}</div>}
          {state.subscriberCount != null && (
            <div style={{ opacity: 0.8 }}>
              {state.subscriberCount.toLocaleString()} subscribers
              {state.stale ? " (cached, may be out of date)" : ""}
            </div>
          )}
          {state.configured === false && (
            <div style={{ opacity: 0.7 }}>
              YouTube channel stats unavailable — {state.reason}
            </div>
          )}
          {state.configured === true && state.reason && (
            <div style={{ opacity: 0.7 }}>{state.reason}</div>
          )}
        </div>
      </div>
    </V2Card>
  );
}

export function ChannelVoicePicker({
  channelId,
  canManage,
}: {
  channelId: string;
  canManage: boolean;
}) {
  const [data, setData] = useState<Payload | null>(null);
  const [selected, setSelected] = useState<string>(UNSET);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/channels/${channelId}/voice`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as Payload;
      setData(body);
      setSelected(body.channel.voiceId ?? UNSET);
    } catch (err) {
      toast.error(
        `Could not load voices: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }, [channelId]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = useCallback(async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/channels/${channelId}/voice`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          voiceId: selected === UNSET ? null : selected,
        }),
      });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      toast.success(
        selected === UNSET
          ? "Cleared — this channel will use the pipeline default voice"
          : "Voice saved for this channel",
      );
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [channelId, selected, load]);

  if (!data) {
    return <V2Card style={{ padding: 20 }}>Loading voices…</V2Card>;
  }

  const options = [
    {
      value: UNSET,
      label: "No channel voice (use pipeline default)",
      hint: "Every channel without its own voice sounds identical",
    },
    ...data.voices.map((v) => ({
      value: v.id,
      label: v.name,
      hint: `${v.provider}${v.language ? ` · ${v.language}` : ""}${
        v.isActive ? "" : " · inactive"
      }`,
      disabled: !v.selectable && v.id !== data.channel.voiceId,
    })),
  ];

  const current = data.voices.find((v) => v.id === data.channel.voiceId);
  const dirty = selected !== (data.channel.voiceId ?? UNSET);

  return (
    <>
      <YouTubeIdentity channelId={channelId} />
      <V2Card style={{ padding: 20, maxWidth: 620 }}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>
          Narration voice
        </div>
        <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 16 }}>
          Which TTS voice narrates this channel&apos;s videos. Without one the
          channel falls back to the pipeline default — which is how all three
          live channels ended up sharing a single voice.
        </div>

        <div style={{ fontSize: 12, marginBottom: 8 }}>
          Currently:{" "}
          <strong>
            {current
              ? `${current.name} (${current.provider})`
              : "pipeline default — not set for this channel"}
          </strong>
        </div>

        <V2Listbox
          value={selected}
          onChange={setSelected}
          options={options}
          disabled={!canManage}
        />

        {canManage && (
          <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
            <V2Button
              variant="accent"
              disabled={!dirty || saving}
              onClick={save}
            >
              {saving ? "Saving…" : "Save voice"}
            </V2Button>
            {dirty && (
              <V2Button
                variant="ghost"
                disabled={saving}
                onClick={() => setSelected(data.channel.voiceId ?? UNSET)}
              >
                Cancel
              </V2Button>
            )}
          </div>
        )}

        {!canManage && (
          <div style={{ marginTop: 12, fontSize: 11, opacity: 0.6 }}>
            You can see this binding but not change it.
          </div>
        )}
      </V2Card>
    </>
  );
}

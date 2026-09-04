"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Save } from "lucide-react";
import { AUTOMATIC_TUTORIAL_LANGUAGE_CODES } from "@repo/contracts";
import { createChannel, updateChannel } from "@/app/actions/channels";
import type { Channel } from "@/lib/repositories/channel-repository";

const CHANNEL_LANGUAGE_NAMES: Record<string, string> = {
  en: "English",
  de: "German",
  fr: "French",
  es: "Spanish",
  ja: "Japanese",
  ko: "Korean",
};
const CHANNEL_LANGUAGES = ["en", ...AUTOMATIC_TUTORIAL_LANGUAGE_CODES].map(
  (code) => ({
    code,
    name: CHANNEL_LANGUAGE_NAMES[code] ?? code.toUpperCase(),
  }),
);

/**
 * Channel Form Component
 *
 * Form for creating or editing YouTube channels.
 * Validates YouTube channel ID format.
 */

interface ChannelFormProps {
  channel?: Channel;
}

export function ChannelForm({ channel }: ChannelFormProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const [name, setName] = useState(channel?.name || "");
  const [youtubeChannelId, setYoutubeChannelId] = useState(
    channel?.youtube_channel_id || "",
  );
  const [language, setLanguage] = useState(channel?.language || "en");
  const [uploaderChannelKey, setUploaderChannelKey] = useState(
    channel?.uploader_channel_key || "",
  );
  const [errors, setErrors] = useState<Record<string, string>>({});

  const isEdit = !!channel;

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!name.trim()) {
      newErrors.name = "Name is required";
    }

    if (!youtubeChannelId.trim()) {
      newErrors.youtube_channel_id = "YouTube Channel ID is required";
    } else if (!/^UC[a-zA-Z0-9_-]{22}$/.test(youtubeChannelId)) {
      newErrors.youtube_channel_id =
        "Invalid YouTube Channel ID format (must start with UC and be 24 characters)";
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validate()) {
      return;
    }

    setLoading(true);

    const result = isEdit
      ? await updateChannel(channel.id, {
          name,
          youtube_channel_id: youtubeChannelId,
          language,
          uploader_channel_key: uploaderChannelKey,
        })
      : await createChannel({
          name,
          youtube_channel_id: youtubeChannelId,
          language,
          uploader_channel_key: uploaderChannelKey,
        });

    if (result.success) {
      router.push("/channels");
      router.refresh();
    } else {
      alert(
        result.error || `Failed to ${isEdit ? "update" : "create"} channel`,
      );
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="max-w-2xl">
      <div className="glass rounded-lg p-6 border border-surface-bright space-y-6">
        <div>
          <label className="block text-sm font-medium text-text mb-1">
            Channel Name
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full px-3 py-2 bg-surface-container border border-surface-bright rounded-lg text-text focus:outline-none focus:ring-2 focus:ring-primary"
            placeholder="My YouTube Channel"
          />
          {errors.name && (
            <p className="mt-1 text-sm text-error">{errors.name}</p>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-text mb-1">
            YouTube Channel ID
          </label>
          <input
            type="text"
            value={youtubeChannelId}
            onChange={(e) => setYoutubeChannelId(e.target.value)}
            className="w-full px-3 py-2 bg-surface-container border border-surface-bright rounded-lg text-text font-mono focus:outline-none focus:ring-2 focus:ring-primary"
            placeholder="UC1234567890123456789012"
          />
          {errors.youtube_channel_id && (
            <p className="mt-1 text-sm text-error">
              {errors.youtube_channel_id}
            </p>
          )}
          <p className="mt-1 text-xs text-text-muted">
            Find this on your YouTube channel page URL (starts with UC)
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-text mb-1">
            Uploader Channel Key
          </label>
          <input
            type="text"
            value={uploaderChannelKey}
            onChange={(e) => setUploaderChannelKey(e.target.value)}
            className="w-full px-3 py-2 bg-surface-container border border-surface-bright rounded-lg text-text font-mono focus:outline-none focus:ring-2 focus:ring-primary"
            placeholder="tutorial_usa"
          />
          <p className="mt-1 text-xs text-text-muted">
            Exact profile key configured in the uploader. Leave blank to block
            automated dispatch for this channel.
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-text mb-1">
            Channel Language
          </label>
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            className="w-full px-3 py-2 bg-surface-container border border-surface-bright rounded-lg text-text focus:outline-none focus:ring-2 focus:ring-primary"
          >
            {CHANNEL_LANGUAGES.map((item) => (
              <option key={item.code} value={item.code}>
                {item.name}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-text-muted">
            Default language for jobs created on this channel
          </p>
        </div>

        <div className="flex items-center space-x-3">
          <button
            type="submit"
            disabled={loading}
            className="flex items-center space-x-2 px-4 py-2 bg-primary hover:bg-primary/90 text-white rounded-lg transition-all disabled:opacity-50"
          >
            <Save className="w-4 h-4" />
            <span>{isEdit ? "Save Changes" : "Create Channel"}</span>
          </button>
          <button
            type="button"
            onClick={() => router.push("/channels")}
            disabled={loading}
            className="px-4 py-2 bg-surface-container hover:bg-surface-bright text-text rounded-lg transition-all disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      </div>
    </form>
  );
}

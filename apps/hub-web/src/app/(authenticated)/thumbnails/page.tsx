import {
  listArchetypes,
  getChannelPersona,
  getChannelProfile,
  getChannelArchetypeIds,
} from "@/lib/repositories/thumbnail-studio-repository";
import { listChannels } from "@/lib/repositories/channel-repository";
import { getActiveFormats } from "@/lib/formats";
import { ThumbnailStudioClient } from "./_components/studio-client";
import type { ChannelBrandingData } from "./_components/branding-form";

export const metadata = {
  title: "Thumbnail Studio",
};

export default async function ThumbnailsPage() {
  const [archetypes, channels, formats] = await Promise.all([
    listArchetypes(),
    listChannels(),
    getActiveFormats(),
  ]);

  const channelData: Record<string, ChannelBrandingData> = {};
  await Promise.all(
    channels.map(async (channel) => {
      const [persona, profile, archetypeIds] = await Promise.all([
        getChannelPersona(channel.id),
        getChannelProfile(channel.id),
        getChannelArchetypeIds(channel.id),
      ]);
      channelData[channel.id] = {
        persona: persona ?? null,
        profile: profile ?? null,
        archetypeIds,
      };
    }),
  );

  return (
    <ThumbnailStudioClient
      archetypes={archetypes}
      channels={channels.map((c) => ({ id: c.id, name: c.name }))}
      formats={formats}
      channelData={channelData}
    />
  );
}

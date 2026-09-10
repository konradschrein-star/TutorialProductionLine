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
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import type { ThumbnailStudioTabId } from "./_components/studio-client";

export const metadata = {
  title: "Thumbnail Studio",
};

const tabs = new Set<ThumbnailStudioTabId>(["videos", "composer", "archetypes", "generate", "library", "branding"]);

export default async function ThumbnailsPage({ searchParams }: { searchParams: Promise<{ jobId?: string; tab?: string }> }) {
  const { jobId, tab } = await searchParams;
  const session = await getSession();
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
      initialJobId={jobId ?? null}
      initialTab={tabs.has(tab as ThumbnailStudioTabId) ? tab as ThumbnailStudioTabId : "videos"}
      canConfigure={hasPermission(session, "view:settings")}
    />
  );
}

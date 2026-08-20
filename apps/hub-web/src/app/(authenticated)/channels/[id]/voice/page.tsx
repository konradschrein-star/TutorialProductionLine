import { redirect, notFound } from "next/navigation";
import { getSession } from "../../../_lib/v2-auth";
import { hasPermission } from "@/lib/auth/rbac";
import { getChannelById } from "@/lib/repositories/channel-repository";
import { ChannelVoicePicker } from "./voice-picker";

interface ChannelVoicePageProps {
  params: Promise<{ id: string }>;
}

export default async function ChannelVoicePage({
  params,
}: ChannelVoicePageProps) {
  const { id } = await params;
  const session = await getSession();

  if (!session || !hasPermission(session, "view:settings")) {
    redirect("/dashboard");
  }

  const channel = await getChannelById(id);
  if (!channel) notFound();

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div>
        <h1
          style={{
            fontSize: 20,
            fontWeight: 800,
            color: "var(--v2-text-1)",
            margin: "0 0 6px 0",
          }}
        >
          {channel.name} — Voice
        </h1>
        <p style={{ fontSize: 13, color: "var(--v2-text-2)", margin: 0 }}>
          The TTS voice this channel&apos;s narration is generated with.
        </p>
      </div>

      <ChannelVoicePicker
        channelId={id}
        canManage={hasPermission(session, "edit:settings")}
      />
    </div>
  );
}

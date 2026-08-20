"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ReactNode } from "react";

interface ChannelLayoutProps {
  children: ReactNode;
  params: Promise<{ id: string }>;
}

export default function ChannelLayout({
  children,
  params,
}: ChannelLayoutProps) {
  const pathname = usePathname();

  // Extract channel ID from pathname since params is async
  const channelId = pathname.split("/")[2];

  const tabs = [
    { label: "Details", href: `/channels/${channelId}`, exact: true },
    {
      label: "Characters",
      href: `/channels/${channelId}/characters`,
      exact: false,
    },
    {
      label: "Narrators",
      href: `/channels/${channelId}/narrators`,
      exact: false,
    },
    // Voice = the TTS voice narration is generated with. Distinct from
    // Narrators, which is PNG character art. `channels.voice_id` shipped in
    // 0060 with no screen able to set it, so all three live channels silently
    // shared one hardcoded voice.
    { label: "Voice", href: `/channels/${channelId}/voice`, exact: false },
  ];

  const isActiveTab = (tab: (typeof tabs)[number]) => {
    if (tab.exact) {
      return pathname === tab.href;
    }
    return pathname.startsWith(tab.href);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {/* Back Link */}
      <Link
        href="/channels"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          fontSize: 11,
          color: "rgba(205,195,215,0.5)",
          textDecoration: "none",
          width: "fit-content",
        }}
      >
        <span className="material-symbols-outlined" style={{ fontSize: 14 }}>
          arrow_back
        </span>
        Back to Channels
      </Link>

      {/* Tab Navigation */}
      <div
        style={{
          display: "flex",
          gap: 4,
          borderBottom: "1px solid rgba(var(--v2-accent-rgb), 0.1)",
          paddingBottom: 0,
        }}
      >
        {tabs.map((tab) => {
          const active = isActiveTab(tab);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              style={{
                padding: "10px 20px",
                fontSize: 12,
                fontWeight: active ? 700 : 600,
                color: active ? "var(--v2-accent)" : "rgba(205,195,215,0.6)",
                textDecoration: "none",
                borderBottom: active
                  ? "2px solid var(--v2-accent)"
                  : "2px solid transparent",
                marginBottom: "-1px",
                transition: "all 0.2s",
              }}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>

      {/* Tab Content */}
      {children}
    </div>
  );
}

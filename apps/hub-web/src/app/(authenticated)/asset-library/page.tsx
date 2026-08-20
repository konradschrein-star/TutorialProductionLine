import { notFound } from "next/navigation";
import Link from "next/link";
import { Network } from "lucide-react";
import { hasPermission } from "@/lib/auth/rbac";
import { getSession } from "../_lib/v2-auth";
import { listAssets } from "@/lib/repositories/asset-repository";
import { listArchetypes } from "@/lib/repositories/archetype-repository";
import { listCharacters } from "@/lib/repositories/character-repository";
import { AssetLibraryClient } from "@/components/asset-library/asset-library-client";
import { db, channels } from "@/lib/db";
import { V2Button } from "../_components";

/**
 * V2 Asset Library Page
 *
 * Unified browser for all visual/audio assets in the system:
 * characters, backgrounds, style guides, objects, prompt templates, etc.
 *
 * Loads initial data server-side in parallel, then hands off to the
 * client component for interactive filtering.
 *
 * Admin / Manager only (view:settings).
 */
export default async function V2AssetLibraryPage() {
  const session = await getSession();

  if (!hasPermission(session, "view:settings")) {
    notFound();
  }

  const [assetsResult, archetypesResult, charactersResult, channelsResult] =
    await Promise.allSettled([
      listAssets({}),
      listArchetypes(true),
      listCharacters({}),
      db.select({ id: channels.id, name: channels.name }).from(channels),
    ]);

  const initialAssets =
    assetsResult.status === "fulfilled" ? assetsResult.value : [];
  const initialArchetypes =
    archetypesResult.status === "fulfilled" ? archetypesResult.value : [];
  const initialCharacters =
    charactersResult.status === "fulfilled" ? charactersResult.value : [];
  const initialChannels =
    channelsResult.status === "fulfilled" ? channelsResult.value : [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
        }}
      >
        <div>
          <h1
            style={{
              fontSize: 20,
              fontWeight: 800,
              color: "var(--v2-text-1)",
              margin: "0 0 6px 0",
            }}
          >
            Asset Library
          </h1>
          <p style={{ fontSize: 13, color: "var(--v2-text-2)", margin: 0 }}>
            Browse, upload, and manage all production assets — characters,
            backgrounds, style guides, objects, and prompt templates.
          </p>
        </div>
        <Link href="/asset-library/graph">
          <V2Button variant="outline">
            <Network className="w-4 h-4" />
            View Graph
          </V2Button>
        </Link>
      </div>

      {/* Client Browser */}
      <AssetLibraryClient
        initialAssets={initialAssets as any[]}
        initialArchetypes={initialArchetypes as any[]}
        initialCharacters={initialCharacters as any[]}
        initialChannels={initialChannels}
      />
    </div>
  );
}

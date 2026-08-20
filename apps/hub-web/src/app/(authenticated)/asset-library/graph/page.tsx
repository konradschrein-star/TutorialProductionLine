import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { hasPermission } from "@/lib/auth/rbac";
import { getSession } from "../../_lib/v2-auth";
import { listAssets } from "@/lib/repositories/asset-repository";
import { listArchetypes } from "@/lib/repositories/archetype-repository";
import { listCharacters } from "@/lib/repositories/character-repository";
import { listEnvironments } from "@/lib/repositories/environment-repository";
import {
  AssetGraphClient,
  type AssetGraphData,
} from "@/components/asset-library/asset-graph-client";
import { V2Button } from "../../_components";

/**
 * V2 Asset Graph Page
 *
 * Interactive node graph showing asset relationships:
 * - Character → Archetype connections
 * - Environment → Background/Prop connections
 * - Character → Environment usage
 *
 * Admin / Manager only (view:settings).
 */
export default async function V2AssetGraphPage() {
  const session = await getSession();

  if (!hasPermission(session, "view:settings")) {
    notFound();
  }

  const [
    archetypesResult,
    charactersResult,
    styleGuidesResult,
    characterAssetsResult,
    environmentsResult,
    backgroundAssetsResult,
  ] = await Promise.allSettled([
    listArchetypes(false),
    listCharacters({}),
    listAssets({ asset_type: "style_guide", status: "approved" }),
    listAssets({ asset_type: "character", status: "approved" }),
    listEnvironments(),
    listAssets({ asset_type: "background" }),
  ]);

  const graphData: AssetGraphData = {
    archetypes: (archetypesResult.status === "fulfilled"
      ? archetypesResult.value
      : []
    ).map((a) => ({
      id: a.id,
      name: a.name,
      description: (a as any).description ?? null,
      image_style: (a as any).image_style ?? null,
    })),
    characters: (charactersResult.status === "fulfilled"
      ? charactersResult.value
      : []
    ).map((c) => ({
      id: c.id,
      name: c.name,
      description: (c as any).description ?? "",
      archetype_id: (c as any).archetype_id ?? null,
      reference_sheet_asset_id: (c as any).reference_sheet_asset_id ?? null,
    })),
    styleGuides: (styleGuidesResult.status === "fulfilled"
      ? styleGuidesResult.value
      : []
    ).map((a) => ({
      id: a.id,
      name: a.name,
      archetype_id: (a as any).archetype_id ?? null,
    })),
    characterAssets: (characterAssetsResult.status === "fulfilled"
      ? characterAssetsResult.value
      : []
    ).map((a) => ({
      id: a.id,
      name: a.name,
      character_id: (a as any).character_id ?? null,
    })),
    environments: (environmentsResult.status === "fulfilled"
      ? environmentsResult.value
      : []
    ).map((e) => ({
      id: e.id,
      name: e.name,
      archetype_id: (e as any).archetype_id ?? null,
      background_asset_id: (e as any).background_asset_id ?? "",
    })),
    backgroundAssets: (backgroundAssetsResult.status === "fulfilled"
      ? backgroundAssetsResult.value
      : []
    ).map((a) => ({
      id: a.id,
      name: a.name,
    })),
  };

  const totalNodes =
    graphData.archetypes.length +
    graphData.characters.length +
    graphData.styleGuides.length +
    graphData.characterAssets.length +
    graphData.environments.length +
    graphData.backgroundAssets.length;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 24,
        height: "calc(100vh - 120px)",
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 16 }}>
        <Link href="/asset-library">
          <V2Button variant="outline" size="sm">
            <ArrowLeft className="w-4 h-4" />
          </V2Button>
        </Link>
        <div>
          <h1
            style={{
              fontSize: 20,
              fontWeight: 800,
              color: "var(--v2-text-1)",
              margin: "0 0 6px 0",
            }}
          >
            Asset Graph
          </h1>
          <p style={{ fontSize: 13, color: "var(--v2-text-2)", margin: 0 }}>
            {totalNodes} entities — click a node to inspect connections
          </p>
        </div>
      </div>

      {/* Graph Canvas */}
      <AssetGraphClient data={graphData} />
    </div>
  );
}

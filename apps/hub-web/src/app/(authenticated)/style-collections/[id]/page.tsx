import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "../../_lib/v2-auth";
import { hasPermission } from "@/lib/auth/rbac";
import { getStyleCollectionById } from "@/lib/repositories/style-library-repository";
import { GlassCard } from "../../_components/glass-card";

interface StyleCollectionDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function StyleCollectionDetailPage({
  params,
}: StyleCollectionDetailPageProps) {
  const { id } = await params;
  const session = await getSession();

  if (!hasPermission(session, "view:settings")) {
    redirect("/style-collections");
  }

  const collection = await getStyleCollectionById(id);
  if (!collection) notFound();

  const canManage = hasPermission(session, "edit:settings");

  // Determine scope badge
  const getScopeBadge = () => {
    if (collection.channel_id && collection.archetype_id && collection.format) {
      return "Channel + Archetype + Format";
    }
    if (collection.channel_id && collection.archetype_id) {
      return "Channel + Archetype";
    }
    if (collection.archetype_id && collection.format) {
      return "Archetype + Format";
    }
    if (collection.channel_id) {
      return "Channel-Scoped";
    }
    if (collection.archetype_id) {
      return "Archetype-Scoped";
    }
    if (collection.format) {
      return "Format-Scoped";
    }
    return "Universal";
  };

  // Group assets by ref_type
  const groupedAssets = collection.reference_assets.reduce(
    (acc, asset) => {
      if (!acc[asset.ref_type]) {
        acc[asset.ref_type] = [];
      }
      acc[asset.ref_type].push(asset);
      return acc;
    },
    {} as Record<string, typeof collection.reference_assets>,
  );

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 24,
        maxWidth: 1200,
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
        }}
      >
        <div>
          <Link
            href="/style-collections"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontSize: 11,
              color: "rgba(205,195,215,0.5)",
              textDecoration: "none",
              marginBottom: 12,
            }}
          >
            <span
              className="material-symbols-outlined"
              style={{ fontSize: 14 }}
            >
              arrow_back
            </span>
            Style Collections
          </Link>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              marginBottom: 8,
            }}
          >
            <h1
              style={{
                fontSize: 20,
                fontWeight: 800,
                color: "#e5e2e1",
                margin: 0,
              }}
            >
              {collection.name}
            </h1>
            <span
              style={{
                fontSize: 9,
                fontWeight: 700,
                color: "var(--v2-accent)",
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                padding: "3px 8px",
                borderRadius: 4,
                background: "rgba(var(--v2-accent-rgb), 0.15)",
              }}
            >
              {getScopeBadge()}
            </span>
          </div>

          <p style={{ fontSize: 12, color: "#cdc3d7", margin: 0 }}>
            {collection.description}
          </p>
        </div>

        {canManage && (
          <Link
            href={`/style-collections/${collection.id}/edit`}
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: "var(--v2-accent)",
              textDecoration: "none",
              padding: "8px 16px",
              borderRadius: 6,
              background: "rgba(var(--v2-accent-rgb), 0.1)",
              border: "1px solid rgba(var(--v2-accent-rgb), 0.2)",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <span
              className="material-symbols-outlined"
              style={{ fontSize: 16 }}
            >
              edit
            </span>
            Edit Collection
          </Link>
        )}
      </div>

      {/* Text Guidelines */}
      {collection.text_guidelines && (
        <GlassCard style={{ padding: 24 }}>
          <h3
            style={{
              fontSize: 14,
              fontWeight: 700,
              color: "#e5e2e1",
              margin: "0 0 12px 0",
            }}
          >
            Text Guidelines
          </h3>
          <pre
            style={{
              fontSize: 11,
              color: "rgba(205,195,215,0.8)",
              margin: 0,
              lineHeight: 1.6,
              fontFamily: "monospace",
              whiteSpace: "pre-wrap",
              wordWrap: "break-word",
            }}
          >
            {collection.text_guidelines}
          </pre>
        </GlassCard>
      )}

      {/* Reference Assets */}
      <GlassCard style={{ padding: 24 }}>
        <h3
          style={{
            fontSize: 14,
            fontWeight: 700,
            color: "#e5e2e1",
            margin: "0 0 16px 0",
          }}
        >
          Reference Assets
        </h3>

        {collection.reference_assets.length === 0 ? (
          <p
            style={{ fontSize: 12, color: "rgba(205,195,215,0.5)", margin: 0 }}
          >
            No reference assets linked to this collection yet.
          </p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
            {Object.entries(groupedAssets).map(([refType, assets]) => (
              <div key={refType}>
                <h4
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: "#cdc3d7",
                    textTransform: "uppercase",
                    letterSpacing: "0.08em",
                    marginBottom: 12,
                  }}
                >
                  {refType.replace(/_/g, " ")}
                </h4>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns:
                      "repeat(auto-fill, minmax(200px, 1fr))",
                    gap: 12,
                  }}
                >
                  {assets.map((asset) => (
                    <div
                      key={asset.asset_id}
                      style={{
                        borderRadius: 8,
                        overflow: "hidden",
                        background: "rgba(0,0,0,0.3)",
                        border: "1px solid rgba(var(--v2-accent-rgb), 0.1)",
                      }}
                    >
                      {asset.file_path ? (
                        <img
                          src={`/api/assets/${asset.asset_id}`}
                          alt={asset.file_name}
                          style={{
                            width: "100%",
                            height: 150,
                            objectFit: "cover",
                            display: "block",
                          }}
                        />
                      ) : (
                        <div
                          style={{
                            width: "100%",
                            height: 150,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            background: "rgba(0,0,0,0.5)",
                          }}
                        >
                          <span
                            className="material-symbols-outlined"
                            style={{
                              fontSize: 32,
                              color: "rgba(205,195,215,0.3)",
                            }}
                          >
                            broken_image
                          </span>
                        </div>
                      )}
                      <div style={{ padding: 8 }}>
                        <p
                          style={{
                            fontSize: 10,
                            color: "rgba(205,195,215,0.6)",
                            margin: 0,
                            wordBreak: "break-all",
                          }}
                        >
                          {asset.file_name}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </GlassCard>

      {/* Metadata */}
      <GlassCard style={{ padding: 24 }}>
        <h3
          style={{
            fontSize: 14,
            fontWeight: 700,
            color: "#e5e2e1",
            margin: "0 0 16px 0",
          }}
        >
          Collection Metadata
        </h3>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 16,
            fontSize: 11,
          }}
        >
          <div>
            <div
              style={{
                color: "rgba(205,195,215,0.5)",
                marginBottom: 4,
                fontSize: 10,
                textTransform: "uppercase",
                letterSpacing: "0.08em",
              }}
            >
              Created
            </div>
            <div style={{ color: "#e5e2e1" }}>
              {new Date(collection.created_at).toLocaleString()}
            </div>
          </div>
          <div>
            <div
              style={{
                color: "rgba(205,195,215,0.5)",
                marginBottom: 4,
                fontSize: 10,
                textTransform: "uppercase",
                letterSpacing: "0.08em",
              }}
            >
              Last Updated
            </div>
            <div style={{ color: "#e5e2e1" }}>
              {new Date(collection.updated_at).toLocaleString()}
            </div>
          </div>
          <div>
            <div
              style={{
                color: "rgba(205,195,215,0.5)",
                marginBottom: 4,
                fontSize: 10,
                textTransform: "uppercase",
                letterSpacing: "0.08em",
              }}
            >
              Status
            </div>
            <div
              style={{ color: collection.is_active ? "#10b981" : "#f87171" }}
            >
              {collection.is_active ? "Active" : "Inactive"}
            </div>
          </div>
          <div>
            <div
              style={{
                color: "rgba(205,195,215,0.5)",
                marginBottom: 4,
                fontSize: 10,
                textTransform: "uppercase",
                letterSpacing: "0.08em",
              }}
            >
              Reference Assets
            </div>
            <div style={{ color: "#e5e2e1" }}>
              {collection.reference_assets.length} linked
            </div>
          </div>
        </div>
      </GlassCard>
    </div>
  );
}

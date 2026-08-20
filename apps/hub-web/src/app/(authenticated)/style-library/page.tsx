import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "../_lib/v2-auth";
import { GlassCard } from "../_components/glass-card";
import { hasPermission } from "@/lib/auth/rbac";
import { listStyleCollections } from "@/lib/repositories/style-library-repository";
import { StyleCollectionCard } from "@/components/style-collections/style-collection-card";

/**
 * Style Library Page
 *
 * This page now displays Style Collections, which is the canonical style reference system.
 * The old "Style Assets" system has been deprecated and removed.
 *
 * Style Collections provide multi-vector association (channel + archetype + format),
 * tiered resolution, and reference image libraries with text guidelines.
 */
export default async function V2StyleLibraryPage() {
  const session = await getSession();

  // Style library is accessible to anyone who can create jobs or view settings
  if (
    !hasPermission(session, "create:job") &&
    !hasPermission(session, "view:settings")
  ) {
    redirect("/dashboard");
  }

  const canManage = hasPermission(session, "edit:settings");
  const collections = await listStyleCollections({ is_active: true });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
        }}
      >
        <div>
          <h1
            style={{
              fontSize: 20,
              fontWeight: 800,
              color: "#e5e2e1",
              margin: 0,
              marginBottom: 4,
            }}
          >
            Style Library
          </h1>
          <p style={{ fontSize: 12, color: "#cdc3d7", margin: 0 }}>
            {collections.length} collection{collections.length !== 1 ? "s" : ""}{" "}
            configured • Visual consistency bundles for procedural content
          </p>
        </div>

        {canManage && (
          <Link
            href="/style-collections/create"
            className="v2-btn-accent"
            style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
          >
            <span
              className="material-symbols-outlined"
              style={{ fontSize: 16 }}
            >
              add
            </span>
            Create Collection
          </Link>
        )}
      </div>

      {/* Info Banner */}
      <GlassCard
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 12,
          background: "rgba(var(--v2-accent-rgb), 0.04)",
          border: "1px solid rgba(var(--v2-accent-rgb), 0.15)",
          padding: 16,
        }}
      >
        <span
          className="material-symbols-outlined"
          style={{
            fontSize: 18,
            color: "var(--v2-accent)",
            flexShrink: 0,
            marginTop: 1,
          }}
        >
          info
        </span>
        <div>
          <p
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: "#e5e2e1",
              margin: 0,
              marginBottom: 4,
            }}
          >
            Style Collections
          </p>
          <p
            style={{
              fontSize: 11,
              color: "rgba(205,195,215,0.55)",
              margin: 0,
              lineHeight: 1.5,
            }}
          >
            Style Collections are reusable visual reference bundles that ensure
            consistent styling across your content. Each collection includes
            text guidelines and reference images that are provided to Claude
            during scene composition. Collections can be scoped to specific
            channels, archetypes, or formats using tiered resolution.
          </p>
        </div>
      </GlassCard>

      {/* Collections Grid */}
      {collections.length === 0 ? (
        <GlassCard style={{ padding: "48px 24px", textAlign: "center" }}>
          <p
            style={{ color: "rgba(205,195,215,0.4)", fontSize: 12, margin: 0 }}
          >
            No style collections found.
          </p>
          {canManage && (
            <div style={{ marginTop: 12 }}>
              <Link
                href="/style-collections/create"
                style={{
                  fontSize: 12,
                  color: "var(--v2-accent)",
                  textDecoration: "none",
                }}
              >
                Create your first collection →
              </Link>
            </div>
          )}
        </GlassCard>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
            gap: 16,
          }}
        >
          {collections.map((collection) => (
            <StyleCollectionCard
              key={collection.id}
              collection={collection}
              canManage={canManage}
            />
          ))}
        </div>
      )}
    </div>
  );
}

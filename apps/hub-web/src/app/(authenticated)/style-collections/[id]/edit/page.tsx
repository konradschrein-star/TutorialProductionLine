import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "../../../_lib/v2-auth";
import { hasPermission } from "@/lib/auth/rbac";
import { getStyleCollectionById } from "@/lib/repositories/style-library-repository";
import { listChannels } from "@/lib/repositories/channel-repository";
import { listArchetypes } from "@/lib/repositories/archetype-repository";
import { StyleCollectionForm } from "@/components/style-collections/style-collection-form";

interface StyleCollectionEditPageProps {
  params: Promise<{ id: string }>;
}

export default async function StyleCollectionEditPage({
  params,
}: StyleCollectionEditPageProps) {
  const { id } = await params;
  const session = await getSession();

  if (!hasPermission(session, "edit:settings")) {
    redirect("/style-collections");
  }

  const [collection, channels, archetypes] = await Promise.all([
    getStyleCollectionById(id),
    listChannels(),
    listArchetypes(),
  ]);

  if (!collection) notFound();

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 24,
        maxWidth: 800,
      }}
    >
      {/* Back */}
      <Link
        href={`/style-collections/${id}`}
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
        Back to Collection
      </Link>

      {/* Header */}
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
          Edit Style Collection
        </h1>
        <p style={{ fontSize: 12, color: "#cdc3d7", margin: 0 }}>
          {collection.name}
        </p>
      </div>

      {/* Form */}
      <StyleCollectionForm
        channels={channels}
        archetypes={archetypes}
        initialData={{
          id: collection.id,
          name: collection.name,
          description: collection.description,
          channel_id: collection.channel_id,
          archetype_id: collection.archetype_id,
          format: collection.format,
          text_guidelines: collection.text_guidelines,
        }}
      />
    </div>
  );
}

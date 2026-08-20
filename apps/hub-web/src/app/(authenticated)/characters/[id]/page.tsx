import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getSession } from "../../_lib/v2-auth";
import { hasPermission } from "@/lib/auth/rbac";
import { getCharacterWithStates } from "@/lib/repositories/character-repository";
import { listArchetypes } from "@/lib/repositories/archetype-repository";
import { CharacterDetailClient } from "@/components/characters/character-detail-client";
import { V2Button } from "../../_components";

/**
 * V2 Character Detail Page
 *
 * Shows the character reference sheet, description, and 12-state grid.
 * ADMIN only (view:settings permission).
 */
export default async function V2CharacterDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getSession();

  if (!hasPermission(session, "view:settings")) {
    notFound();
  }

  const { id } = await params;

  const [character, archetypes] = await Promise.all([
    getCharacterWithStates(id),
    listArchetypes(true),
  ]);

  if (!character) {
    notFound();
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 16 }}>
        <Link href="/characters">
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
            {character.name}
          </h1>
          <p style={{ fontSize: 13, color: "var(--v2-text-2)", margin: 0 }}>
            Character reference sheet and state variations
          </p>
        </div>
      </div>

      <CharacterDetailClient character={character} archetypes={archetypes} />
    </div>
  );
}

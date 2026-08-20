import { notFound } from "next/navigation";
import { getSession } from "../_lib/v2-auth";
import { hasPermission } from "@/lib/auth/rbac";
import { listCharacterLibrary } from "@/lib/repositories/character-library-repository";
import { db, channels } from "@/lib/db";
import { asc } from "drizzle-orm";
import {
  CharacterLibraryClient,
  type LibraryCharacter,
} from "@/components/characters/character-library-client";

/**
 * Character Library.
 *
 * The single home for "who is the human on this channel". A character is an
 * identity — a name, a physical description, and MANY images — bound to one or
 * more channels. Thumbnail generation cycles through a bound character's images
 * so the channel keeps one recognisable face with per-video variation.
 *
 * Characters are deliberately separate from styles: a style is a treatment, an
 * identity is a person. Merging them would make it impossible to render the
 * same character in two styles.
 */
export default async function CharactersPage() {
  const session = await getSession();
  if (!hasPermission(session, "view:settings")) notFound();

  const [library, channelRows] = await Promise.all([
    listCharacterLibrary(),
    db
      .select({ id: channels.id, name: channels.name })
      .from(channels)
      .orderBy(asc(channels.name)),
  ]);

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
          Character Library
        </h1>
        <p
          style={{
            fontSize: 13,
            color: "var(--v2-text-2)",
            margin: 0,
            maxWidth: 760,
            lineHeight: 1.55,
          }}
        >
          The recurring human faces of your channels. Bind a character to a
          channel as its <strong>host</strong> and every thumbnail generated for
          that channel cycles through the character&apos;s images — same person,
          different pose, per video. Output thumbnails are always exactly
          1280&times;720.
        </p>
      </div>

      <CharacterLibraryClient
        initialCharacters={library as unknown as LibraryCharacter[]}
        channels={channelRows}
      />
    </div>
  );
}

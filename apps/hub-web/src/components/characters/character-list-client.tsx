"use client";

import { useState, useCallback } from "react";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { CharacterCard } from "./character-card";
import { CreateCharacterModal } from "./create-character-modal";
import type { Character } from "@/lib/repositories/character-repository";
import type { Archetype } from "@/lib/repositories/archetype-repository";

interface CharacterListClientProps {
  initialCharacters: Character[];
  archetypes: Archetype[];
  /** Scopes newly-created characters to this channel instead of leaving them universal. */
  channelId?: string;
}

export function CharacterListClient({
  initialCharacters,
  archetypes,
  channelId,
}: CharacterListClientProps) {
  const [characters, setCharacters] = useState<Character[]>(initialCharacters);
  const [filterArchetypeId, setFilterArchetypeId] = useState<string | null>(
    null,
  );
  const [showCreate, setShowCreate] = useState(false);

  const handleCreated = useCallback((newCharacter: Character) => {
    setCharacters((prev) => [newCharacter, ...prev]);
    setShowCreate(false);
  }, []);

  const filtered = filterArchetypeId
    ? characters.filter((c) => c.archetype_id === filterArchetypeId)
    : characters;

  const archetypeMap = new Map(archetypes.map((a) => [a.id, a.name]));

  return (
    <>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-[#e5e2e1] mb-1">Characters</h1>
          <p className="text-[rgba(205,195,215,0.6)] text-sm">
            {characters.length} character{characters.length !== 1 ? "s" : ""} —
            manage reference sheets and emotional states
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="v2-btn-accent flex items-center gap-2 px-4 py-2"
        >
          <Plus className="w-4 h-4" />
          New Character
        </button>
      </div>

      {/* Filter pills */}
      {archetypes.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setFilterArchetypeId(null)}
            className={cn(
              "px-3 py-1.5 rounded-full text-xs font-medium transition-colors",
              filterArchetypeId === null
                ? "bg-[#aaff00] text-[#000]"
                : "bg-[#1c1c1c] text-[rgba(205,195,215,0.6)] hover:text-[#e5e2e1]",
            )}
          >
            All
          </button>
          {archetypes.map((a) => (
            <button
              key={a.id}
              onClick={() =>
                setFilterArchetypeId(a.id === filterArchetypeId ? null : a.id)
              }
              className={cn(
                "px-3 py-1.5 rounded-full text-xs font-medium transition-colors",
                filterArchetypeId === a.id
                  ? "bg-[#aaff00] text-[#000]"
                  : "bg-[#1c1c1c] text-[rgba(205,195,215,0.6)] hover:text-[#e5e2e1]",
              )}
            >
              {a.name}
            </button>
          ))}
        </div>
      )}

      {/* Grid */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-[rgba(205,195,215,0.6)]">
          <p className="text-sm">
            {characters.length === 0
              ? "No characters yet — create your first one."
              : "No characters match the selected filter."}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {filtered.map((character) => (
            <CharacterCard
              key={character.id}
              character={character}
              archetypeName={
                character.archetype_id
                  ? (archetypeMap.get(character.archetype_id) ?? null)
                  : null
              }
            />
          ))}
        </div>
      )}

      {showCreate && (
        <CreateCharacterModal
          archetypes={archetypes}
          channelId={channelId}
          onCreated={handleCreated}
          onClose={() => setShowCreate(false)}
        />
      )}
    </>
  );
}

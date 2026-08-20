"use client";

import { useState } from "react";
import { MusicLibraryManager } from "@/components/settings/music-library-manager";

interface MusicTrack {
  id: string;
  name: string;
  original_filename: string;
  mood: string[] | null;
  bpm: number | null;
  genre: string | null;
  duration_seconds: number | null;
  created_at: Date;
}

interface MusicClientProps {
  initialTracks: MusicTrack[];
}

export function MusicClient({ initialTracks }: MusicClientProps) {
  const [tracks, setTracks] = useState(
    initialTracks.map((t) => ({
      ...t,
      created_at: t.created_at.toISOString(),
    })),
  );

  const handleRefresh = async () => {
    try {
      const res = await fetch("/api/music-library");
      if (!res.ok) throw new Error("Failed to refresh");
      const data = await res.json();
      setTracks(data.tracks || []);
    } catch (error) {
      console.error("Failed to refresh tracks:", error);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
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
          Music Library
        </h1>
        <p style={{ fontSize: 12, color: "#cdc3d7", margin: 0 }}>
          Manage background music tracks for your videos
        </p>
      </div>

      <MusicLibraryManager tracks={tracks} onRefresh={handleRefresh} />
    </div>
  );
}

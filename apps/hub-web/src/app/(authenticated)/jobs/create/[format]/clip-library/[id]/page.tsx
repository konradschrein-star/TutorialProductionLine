import { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import {
  getClipLibraryById,
  listReferenceScripts,
} from "@repo/db/repositories";
import ClipLibraryDetailClient from "./_components/clip-library-detail-client";

export const metadata: Metadata = {
  title: "Clip Library",
};

interface PageProps {
  params: Promise<{ format: string; id: string }>;
}

export default async function ClipLibraryDetailPage({ params }: PageProps) {
  const { format, id } = await params;
  if (format !== "long-form-drama") {
    redirect(`/jobs/create/${format}`);
  }
  const lib = await getClipLibraryById(id);
  if (!lib) notFound();
  const references = await listReferenceScripts(lib.id);

  return (
    <ClipLibraryDetailClient
      libraryId={lib.id}
      initialLibrary={{
        id: lib.id,
        name: lib.name,
        character_block: lib.character_block,
        script_prompt: lib.script_prompt,
        music_mode: lib.music_mode,
        music_volume_db: lib.music_volume_db,
        use_reference_scripts: lib.use_reference_scripts,
      }}
      initialReferenceScripts={references.map((r) => ({
        id: r.id,
        name: r.name,
        word_count: r.word_count,
        last_used_at: r.last_used_at ? r.last_used_at.toISOString() : null,
        preview: r.content.slice(0, 280),
      }))}
      format={format}
    />
  );
}

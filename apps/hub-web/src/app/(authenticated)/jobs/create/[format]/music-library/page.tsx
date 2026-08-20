import { Metadata } from "next";
import { redirect } from "next/navigation";
import MusicLibraryClient from "./music-library-client";

export const metadata: Metadata = {
  title: "Drama music library",
};

interface PageProps {
  params: Promise<{ format: string }>;
}

const FORMAT_LABEL: Record<string, string> = {
  "long-form-drama": "LONG_FORM_DRAMA",
};

export default async function MusicLibraryPage({ params }: PageProps) {
  const { format } = await params;
  const formatId = FORMAT_LABEL[format];
  if (!formatId) redirect(`/jobs/create/${format}`);
  return <MusicLibraryClient format={formatId} formatSlug={format} />;
}

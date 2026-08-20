import { Metadata } from "next";
import BatchProgressClient from "./batch-progress-client";

export const metadata: Metadata = {
  title: "Drama batch progress",
};

interface PageProps {
  searchParams: Promise<{ ids?: string }>;
}

export default async function JobsBatchPage({ searchParams }: PageProps) {
  const { ids: idsParam } = await searchParams;
  const ids = (idsParam ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => /^[0-9a-f-]{36}$/.test(s));

  return <BatchProgressClient initialIds={ids} />;
}

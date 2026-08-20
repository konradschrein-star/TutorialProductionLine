import { getSession } from "../../../_lib/v2-auth";
import { RankingDetailClient } from "./page-client";

/**
 * Detail page for one ranking video.
 *
 * Auth only, then straight to the client — every fact on this page (does the
 * file exist, did it reach Drive, what is blocking it) is resolved by
 * `/api/production/ranking/jobs/[id]`, and duplicating that resolution here
 * would give two answers that could disagree.
 */
export default async function RankingDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await getSession();
  const { id } = await params;
  return <RankingDetailClient jobId={id} />;
}

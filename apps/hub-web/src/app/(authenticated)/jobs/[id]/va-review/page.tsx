import { getSession } from "../../../_lib/v2-auth";
import { BRollStudioClient } from "./broll-studio-client";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string }>;
}

/**
 * B-Roll Selection Studio page.
 *
 * Server component — validates the session and renders the client studio,
 * which fetches everything it needs from GET /api/jobs/[id]/va-review.
 */
export default async function VaReviewPage({ params }: Props) {
  await getSession();
  const { id } = await params;

  return <BRollStudioClient jobId={id} />;
}

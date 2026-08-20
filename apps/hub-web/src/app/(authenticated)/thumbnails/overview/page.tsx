import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { ThumbnailOverviewClient } from "./_components/overview-client";

export const metadata = {
  title: "Thumbnail Overview",
};

/**
 * Thumbnail Overview — a sub-page of the Thumbnail Studio config surface.
 *
 * "having an overview for the thumbnails that the virtual assistants generated
 * would be quite nice for me to have somewhere, like as a sub page in the
 * settings or something like that" — the owner. This is that page.
 *
 * ADMIN/MANAGER only, guarded here as well as in the API. `/thumbnails` itself
 * is gated on `view:settings`, which PRODUCTION_VA also holds — so inheriting
 * the parent route's guard would NOT be admin/manager-only, and this page is a
 * cross-assistant report. The check is deliberately on the role rather than on
 * a permission because no existing permission means "may see everyone's work",
 * and minting one would widen a grant this task must not widen.
 */
export default async function ThumbnailOverviewPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "ADMIN" && session.role !== "MANAGER") {
    redirect("/thumbnails");
  }
  return <ThumbnailOverviewClient />;
}

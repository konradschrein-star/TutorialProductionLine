import { getSession } from "../../_lib/v2-auth";
import { redirect } from "next/navigation";
import { MusicLibraryClient } from "@/components/music/MusicLibraryClient";

/**
 * Global music library.
 *
 * Data is fetched client-side through /api/music-library so filtering, editing
 * and uploading all refresh from one place. The server component only guards
 * the route.
 */
export default async function MusicPage() {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  return <MusicLibraryClient />;
}

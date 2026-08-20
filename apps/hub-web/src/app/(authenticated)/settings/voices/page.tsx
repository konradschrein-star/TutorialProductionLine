import { redirect } from "next/navigation";
import { listTTSVoices } from "@repo/db/repositories";
import { db } from "@/lib/db";
import { getSession } from "../../_lib/v2-auth";
import { hasPermission } from "@/lib/auth/rbac";
import { VoicesClient } from "./voices-client";

export const dynamic = "force-dynamic";

export default async function VoicesPage() {
  const session = await getSession();

  if (!hasPermission(session, "view:settings")) {
    redirect("/dashboard");
  }

  // Every voice, not just the active ones — otherwise a deactivated voice is
  // invisible and can never be switched back on.
  const voices = await listTTSVoices(db);

  return (
    <VoicesClient
      initialVoices={voices}
      canEdit={hasPermission(session, "edit:settings")}
    />
  );
}

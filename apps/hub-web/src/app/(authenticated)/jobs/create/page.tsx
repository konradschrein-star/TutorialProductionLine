import { redirect } from "next/navigation";
import { getSession } from "../../_lib/v2-auth";
import { hasPermission } from "@/lib/auth/rbac";
import { listTemplates } from "@/lib/repositories/template-repository";
import { getAvailableFormats } from "@/app/actions/formats";
import { FormatSelector } from "./format-selector";

export default async function CreateJobPage() {
  const session = await getSession();
  if (!hasPermission(session, "create:job")) redirect("/dashboard");

  const templates = await listTemplates();
  const activeTemplates = templates.filter((t) => t.is_active);

  // Get available formats from plugin registry
  const availableFormats = await getAvailableFormats();

  return (
    <div style={{ maxWidth: 1600, margin: "0 auto", padding: "0 24px" }}>
      <FormatSelector
        templates={activeTemplates}
        availableFormats={availableFormats}
      />
    </div>
  );
}

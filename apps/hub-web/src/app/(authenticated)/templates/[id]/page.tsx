import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "../../_lib/v2-auth";
import { hasPermission } from "@/lib/auth/rbac";
import { getTemplateById } from "@/lib/repositories/template-repository";
import { TemplateEditor } from "@/components/templates/template-editor";

interface TemplateEditorPageProps {
  params: Promise<{ id: string }>;
}

export default async function V2TemplateEditorPage({
  params,
}: TemplateEditorPageProps) {
  const { id } = await params;
  const session = await getSession();

  if (!hasPermission(session, "manage:templates")) {
    redirect("/templates");
  }

  const template = await getTemplateById(id);
  if (!template) notFound();

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {/* Back */}
      <Link
        href="/templates"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          fontSize: 11,
          color: "rgba(205,195,215,0.5)",
          textDecoration: "none",
          width: "fit-content",
        }}
      >
        <span className="material-symbols-outlined" style={{ fontSize: 14 }}>
          arrow_back
        </span>
        Templates
      </Link>

      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
        }}
      >
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
            Edit Template
          </h1>
          <p style={{ fontSize: 12, color: "#cdc3d7", margin: 0 }}>
            {template.name}
          </p>
        </div>

        {/* Active badge */}
        <div
          style={{
            padding: "5px 12px",
            borderRadius: 20,
            fontSize: 10,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            ...(template.is_active
              ? {
                  background: "rgba(35,222,203,0.1)",
                  border: "1px solid rgba(35,222,203,0.25)",
                  color: "#23decb",
                }
              : {
                  background: "rgba(75,68,85,0.2)",
                  border: "1px solid rgba(75,68,85,0.3)",
                  color: "rgba(205,195,215,0.4)",
                }),
          }}
        >
          {template.is_active ? "Active" : "Inactive"}
        </div>
      </div>

      <TemplateEditor template={template} />
    </div>
  );
}

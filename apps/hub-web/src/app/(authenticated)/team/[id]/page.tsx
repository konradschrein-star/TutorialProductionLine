import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "../../_lib/v2-auth";
import { hasPermission } from "@/lib/auth/rbac";
import { getUserById } from "@/lib/repositories/team-repository";
import { V2EditUserForm } from "./edit-form";

interface EditUserPageProps {
  params: Promise<{ id: string }>;
}

export default async function V2EditUserPage({ params }: EditUserPageProps) {
  const { id } = await params;
  const session = await getSession();

  if (!hasPermission(session, "edit:user")) {
    redirect("/team");
  }

  const user = await getUserById(id);
  if (!user) notFound();

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 24,
        maxWidth: 520,
      }}
    >
      {/* Back */}
      <Link
        href="/team"
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
        Team
      </Link>

      {/* Header */}
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
          Edit User
        </h1>
        <p style={{ fontSize: 12, color: "#cdc3d7", margin: 0 }}>
          {user.email}
        </p>
      </div>

      <V2EditUserForm user={user} />
    </div>
  );
}

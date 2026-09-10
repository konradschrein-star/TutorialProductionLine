"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { updateUser } from "@/app/actions/team";
import type { User } from "@/lib/repositories/team-repository";

const ROLES = [
  { value: "ADMIN", label: "Admin" },
  { value: "MANAGER", label: "Manager" },
  { value: "PRODUCTION_VA", label: "Production VA" },
  { value: "UPLOADER_VA", label: "Uploader VA" },
  { value: "VIEWER", label: "Viewer" },
];

interface Props {
  user: User;
}

export function V2EditUserForm({ user }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "10px 14px",
    background: "#111",
    border: "1px solid rgba(75,68,85,0.4)",
    borderRadius: 8,
    color: "#e5e2e1",
    fontSize: 13,
    outline: "none",
    boxSizing: "border-box",
  };

  const labelStyle: React.CSSProperties = {
    fontSize: 10,
    fontWeight: 700,
    color: "#cdc3d7",
    textTransform: "uppercase",
    letterSpacing: "0.08em",
  };

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const formData = new FormData(e.currentTarget);
    const result = await updateUser(user.id, {
      email: formData.get("email") as string,
      name: formData.get("name") as string,
      role: formData.get("role") as string,
      password: formData.get("password") as string,
    });
    if (result.success) {
      router.push("/team");
    } else {
      setError(result.error || "Failed to update user");
      setLoading(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      style={{ display: "flex", flexDirection: "column", gap: 18 }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <label style={labelStyle}>Full Name</label>
        <input
          name="name"
          type="text"
          required
          defaultValue={user.name}
          style={inputStyle}
        />
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <label style={labelStyle} htmlFor="replacement-password">Replacement password</label>
        <input id="replacement-password" name="password" type="password" minLength={12} autoComplete="new-password" placeholder="Leave blank to keep the current password" style={inputStyle} />
        <span style={{ fontSize: 11, color: "var(--v2-text-2)" }}>Existing passwords are securely hashed and cannot be displayed. An Admin can set a replacement here and share it directly with the user.</span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <label style={labelStyle}>Email</label>
        <input
          name="email"
          type="email"
          required
          defaultValue={user.email}
          style={inputStyle}
        />
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <label style={labelStyle}>Role</label>
        <select
          name="role"
          required
          defaultValue={user.role}
          style={{ ...inputStyle, appearance: "none" }}
        >
          {ROLES.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
      </div>

      {error && <span style={{ fontSize: 12, color: "#ffb4ab" }}>{error}</span>}

      <div style={{ display: "flex", gap: 10, paddingTop: 4 }}>
        <button
          type="submit"
          disabled={loading}
          className="v2-btn-accent"
          style={{ opacity: loading ? 0.6 : 1 }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
            save
          </span>
          {loading ? "Saving…" : "Save Changes"}
        </button>
        <Link href="/team" className="v2-btn">
          Cancel
        </Link>
      </div>
    </form>
  );
}

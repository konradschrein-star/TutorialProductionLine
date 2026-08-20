"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createUser } from "@/app/actions/team";

const ROLES = [
  { value: "ADMIN", label: "Admin" },
  { value: "MANAGER", label: "Manager" },
  { value: "PRODUCTION_VA", label: "Production VA" },
  { value: "UPLOADER_VA", label: "Uploader VA" },
  { value: "VIEWER", label: "Viewer" },
];

const inputStyle = (hasError?: boolean): React.CSSProperties => ({
  width: "100%",
  padding: "10px 14px",
  background: "#111",
  border: `1px solid ${hasError ? "rgba(255,180,171,0.5)" : "rgba(75,68,85,0.4)"}`,
  borderRadius: 8,
  color: "#e5e2e1",
  fontSize: 13,
  outline: "none",
  boxSizing: "border-box",
});

const labelStyle: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  color: "#cdc3d7",
  textTransform: "uppercase",
  letterSpacing: "0.08em",
};

export default function V2CreateUserPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const formData = new FormData(e.currentTarget);
    const result = await createUser({
      email: formData.get("email") as string,
      name: formData.get("name") as string,
      role: formData.get("role") as string,
      password: formData.get("password") as string,
    });
    if (result.success) {
      router.push("/team");
    } else {
      setError(result.error || "Failed to create user");
      setLoading(false);
    }
  }

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
          Add User
        </h1>
        <p style={{ fontSize: 12, color: "#cdc3d7", margin: 0 }}>
          Create a new team member account
        </p>
      </div>

      {/* Form */}
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
            placeholder="Jane Smith"
            style={inputStyle()}
          />
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <label style={labelStyle}>Email</label>
          <input
            name="email"
            type="email"
            required
            placeholder="jane@example.com"
            style={inputStyle()}
          />
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <label style={labelStyle}>Role</label>
          <select
            name="role"
            required
            defaultValue=""
            style={{ ...inputStyle(), appearance: "none" }}
          >
            <option value="" disabled>
              Select a role
            </option>
            {ROLES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <label style={labelStyle}>Password</label>
          <input
            name="password"
            type="password"
            required
            minLength={8}
            placeholder="Minimum 8 characters"
            style={inputStyle()}
          />
        </div>

        {error && (
          <span style={{ fontSize: 12, color: "#ffb4ab" }}>{error}</span>
        )}

        <div style={{ display: "flex", gap: 10, paddingTop: 4 }}>
          <button
            type="submit"
            disabled={loading}
            className="v2-btn-accent"
            style={{ opacity: loading ? 0.6 : 1 }}
          >
            <span
              className="material-symbols-outlined"
              style={{ fontSize: 16 }}
            >
              person_add
            </span>
            {loading ? "Creating…" : "Create User"}
          </button>
          <Link href="/team" className="v2-btn">
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}

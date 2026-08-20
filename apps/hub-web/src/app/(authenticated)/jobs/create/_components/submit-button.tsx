// apps/hub-web/src/app/(authenticated)/jobs/create/_components/submit-button.tsx
"use client";

interface SubmitButtonProps {
  loading: boolean;
  disabled?: boolean;
  label?: string;
}

export function SubmitButton({
  loading,
  disabled,
  label = "Create Job",
}: SubmitButtonProps) {
  return (
    <button
      type="submit"
      disabled={loading || disabled}
      style={{
        width: "100%",
        padding: "14px 24px",
        background:
          loading || disabled
            ? "rgba(var(--v2-accent-rgb), 0.3)"
            : "linear-gradient(to right, var(--v2-accent), var(--v2-accent-dim))",
        border: "none",
        borderRadius: 8,
        color: "#000",
        fontSize: 12,
        fontWeight: 700,
        textTransform: "uppercase",
        letterSpacing: "0.08em",
        cursor: loading || disabled ? "not-allowed" : "pointer",
        boxShadow:
          loading || disabled
            ? "none"
            : "0 4px 15px rgba(var(--v2-accent-rgb), 0.3)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        marginTop: 24,
      }}
    >
      {loading ? (
        <>
          <span
            style={{
              width: 14,
              height: 14,
              border: "2px solid rgba(0,0,0,0.3)",
              borderTopColor: "#000",
              borderRadius: "50%",
              animation: "spin 0.7s linear infinite",
            }}
          />
          Creating...
        </>
      ) : (
        <>
          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
            add
          </span>
          {label}
        </>
      )}
    </button>
  );
}

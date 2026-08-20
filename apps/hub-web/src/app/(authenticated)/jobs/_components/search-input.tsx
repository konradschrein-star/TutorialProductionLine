"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useState, useTransition } from "react";

interface SearchInputProps {
  defaultValue?: string;
  placeholder?: string;
}

export function SearchInput({
  defaultValue = "",
  placeholder = "Search jobs...",
}: SearchInputProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [value, setValue] = useState(defaultValue);
  const [, startTransition] = useTransition();

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const newValue = e.target.value;
      setValue(newValue);

      startTransition(() => {
        const params = new URLSearchParams(searchParams.toString());
        if (newValue.trim()) {
          params.set("search", newValue.trim());
        } else {
          params.delete("search");
        }
        params.delete("page");
        router.push(`/jobs?${params.toString()}`);
      });
    },
    [router, searchParams],
  );

  return (
    <div style={{ position: "relative", flex: 1, maxWidth: 320 }}>
      <span
        className="material-symbols-outlined"
        style={{
          position: "absolute",
          left: 10,
          top: "50%",
          transform: "translateY(-50%)",
          fontSize: 16,
          color: "rgba(205,195,215,0.4)",
          pointerEvents: "none",
        }}
      >
        search
      </span>
      <input
        type="text"
        value={value}
        onChange={handleChange}
        placeholder={placeholder}
        style={{
          width: "100%",
          padding: "8px 12px 8px 34px",
          background: "rgba(255,255,255,0.03)",
          border: "1px solid rgba(var(--v2-accent-rgb), 0.15)",
          borderRadius: 8,
          color: "#e5e2e1",
          fontSize: 12,
          outline: "none",
          boxSizing: "border-box",
        }}
        onFocus={(e) => {
          e.currentTarget.style.borderColor = "rgba(var(--v2-accent-rgb), 0.4)";
        }}
        onBlur={(e) => {
          e.currentTarget.style.borderColor =
            "rgba(var(--v2-accent-rgb), 0.15)";
        }}
      />
    </div>
  );
}

"use client";

import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  sectionName?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * Keeps one broken settings card from taking down the whole page.
 */
export class SettingsErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error) {
    console.error(
      `[settings] Error in ${this.props.sectionName || "section"}:`,
      error,
    );
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            padding: 16,
            borderRadius: 12,
            background: "rgba(255,180,171,0.05)",
            border: "1px solid rgba(255,180,171,0.25)",
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span
              className="material-symbols-outlined"
              style={{ fontSize: 18, color: "#ffb4ab" }}
            >
              error
            </span>
            <p
              style={{
                fontSize: 13,
                fontWeight: 700,
                color: "#ffb4ab",
                margin: 0,
              }}
            >
              {this.props.sectionName || "This section"} failed to render
            </p>
          </div>
          <p
            style={{ fontSize: 11, color: "rgba(205,195,215,0.6)", margin: 0 }}
          >
            {this.state.error?.message || "An unexpected error occurred"}
          </p>
          <div>
            <button
              type="button"
              onClick={() => this.setState({ hasError: false, error: null })}
              style={{
                padding: "6px 12px",
                fontSize: 11,
                fontWeight: 700,
                borderRadius: 7,
                cursor: "pointer",
                background: "rgba(var(--v2-accent-rgb), 0.1)",
                border: "1px solid rgba(var(--v2-accent-rgb), 0.3)",
                color: "var(--v2-accent)",
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
              }}
            >
              <span
                className="material-symbols-outlined"
                style={{ fontSize: 14 }}
              >
                refresh
              </span>
              Retry
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

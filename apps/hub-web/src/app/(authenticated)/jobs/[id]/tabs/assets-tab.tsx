import { Download } from "lucide-react";
import { V2Card } from "../../../_components";
import type { JobMediaAsset } from "@/lib/job-media-view";

interface AssetsTabProps {
  assets: JobMediaAsset[];
  jobId: string;
}

function isImage(type: string, name: string): boolean {
  return type.startsWith("image") || /\.(png|jpe?g|webp|gif)$/i.test(name);
}

export function AssetsTab({ assets }: AssetsTabProps) {
  if (assets.length === 0) {
    return (
      <V2Card>
        <div style={{ textAlign: "center", padding: "40px 20px" }}>
          <p style={{ fontSize: 13, color: "var(--v2-text-2)" }}>
            No assets in manifest yet.
          </p>
        </div>
      </V2Card>
    );
  }

  const totalSize = assets.reduce((sum, a) => sum + a.sizeBytes, 0);
  const totalSizeMB = (totalSize / 1024 / 1024).toFixed(2);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <p style={{ fontSize: 11, color: "var(--v2-text-3)", fontWeight: 600 }}>
          {assets.length} asset{assets.length !== 1 ? "s" : ""} · {totalSizeMB}{" "}
          MB total
        </p>
      </div>

      <V2Card noPadding>
        <div style={{ display: "flex", flexDirection: "column" }}>
          {assets.map((asset, i) => {
            const sizeMB =
              asset.sizeBytes > 0
                ? (asset.sizeBytes / 1024 / 1024).toFixed(2)
                : null;
            const img = isImage(asset.type, asset.name);

            return (
              <div
                key={i}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "16px 20px",
                  borderBottom:
                    i < assets.length - 1
                      ? "1px solid var(--v2-border-1)"
                      : "none",
                  gap: 16,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    flex: 1,
                    minWidth: 0,
                  }}
                >
                  {img && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={asset.url}
                      alt={asset.name}
                      loading="lazy"
                      style={{
                        width: 56,
                        height: 40,
                        objectFit: "cover",
                        borderRadius: 6,
                        border: "1px solid var(--v2-border-1)",
                        flexShrink: 0,
                        background: "rgba(255,255,255,0.03)",
                      }}
                    />
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p
                      style={{
                        fontSize: 12,
                        fontWeight: 500,
                        color: "#e5e2e1",
                        margin: "0 0 4px 0",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {asset.name}
                    </p>
                    <p
                      style={{
                        fontSize: 10,
                        color: "rgba(205,195,215,0.4)",
                        margin: 0,
                      }}
                    >
                      {asset.type}
                      {sizeMB && ` · ${sizeMB} MB`}
                    </p>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                  <a
                    href={asset.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="v2-btn-outline"
                    style={{ padding: "6px 12px", fontSize: 10 }}
                  >
                    Open
                  </a>
                  <a
                    href={asset.url}
                    download={asset.name}
                    className="v2-btn-outline"
                    style={{ padding: "6px 12px", fontSize: 10 }}
                  >
                    <Download size={12} />
                    DL
                  </a>
                </div>
              </div>
            );
          })}
        </div>
      </V2Card>
    </div>
  );
}

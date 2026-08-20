"use client";

import { useState } from "react";
import { FileText, Images, Package, Activity } from "lucide-react";
import { V2TabNav, type V2Tab } from "../../_components";
import { OverviewTab } from "./tabs/overview-tab";
import { ScenesTab } from "./tabs/scenes-tab";
import { AssetsTab } from "./tabs/assets-tab";
import { LogsTab } from "./tabs/logs-tab";
import { ComparisonDataGridEditor } from "@/components/jobs/comparison-data-grid-editor";
import { ComparisonHeroUpload } from "@/components/jobs/comparison-hero-upload";
import { HITLNavigation } from "@/components/hitl-navigation";
import type { Job } from "@/lib/repositories/job-repository";
import type { JobMediaView } from "@/lib/job-media-view";

interface JobDetailTabsClientProps {
  job: Job;
  canPause: boolean;
  canDelete: boolean;
  canReviewQC: boolean;
  canAssign: boolean;
  canEdit: boolean;
  currentUserId: string | null;
  productionVAs: Array<{ id: string; name: string; email: string }>;
  uploaderVAs: Array<{ id: string; name: string; email: string }>;
  finalVideoAssetKey: string | null;
  mediaView: JobMediaView;
}

export function JobDetailTabsClient({
  job,
  canPause,
  canDelete,
  canReviewQC,
  canAssign,
  canEdit,
  currentUserId,
  productionVAs,
  uploaderVAs,
  finalVideoAssetKey,
  mediaView,
}: JobDetailTabsClientProps) {
  const [activeTab, setActiveTab] = useState<string>("overview");

  // Normalized, format-agnostic scenes + assets (see buildJobMediaView).
  const sceneImages = mediaView.scenes;
  const filteredAssets = mediaView.assets;

  // Extract generation log
  const generationLog = (job.generation_log as any[]) ?? [];

  // Extract comparison metadata
  const comparisonMeta =
    job.format === "TECH_COMPARISON" ? (job.metadata as any)?.comparison : null;
  const isComparisonJob = !!comparisonMeta;

  const tabs: V2Tab[] = [
    {
      id: "overview",
      label: "Overview",
      icon: <FileText size={14} />,
    },
    ...(isComparisonJob
      ? [
          {
            id: "comparison",
            label: "Comparison Data",
            icon: (
              <span
                className="material-symbols-outlined"
                style={{ fontSize: 14 }}
              >
                compare_arrows
              </span>
            ),
          },
        ]
      : []),
    {
      id: "scenes",
      label: "Scenes",
      icon: <Images size={14} />,
      badge: sceneImages.length,
    },
    {
      id: "assets",
      label: "Assets",
      icon: <Package size={14} />,
      badge: filteredAssets.length,
    },
    {
      id: "logs",
      label: "Logs",
      icon: <Activity size={14} />,
      badge: generationLog.length,
    },
  ];

  // Determine if this is a HITL job and which type
  const hitlType: "final-qc" | "production-va" | null =
    job.status === "AWAITING_QC"
      ? "final-qc"
      : job.status === "AWAITING_PRODUCTION_VA"
        ? "production-va"
        : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {/* HITL Navigation for QC/VA jobs */}
      {hitlType && <HITLNavigation currentJobId={job.id} hitlType={hitlType} />}

      <V2TabNav tabs={tabs} activeTab={activeTab} onChange={setActiveTab} />

      {activeTab === "overview" && (
        <OverviewTab
          job={job}
          canPause={canPause}
          canDelete={canDelete}
          canReviewQC={canReviewQC}
          canAssign={canAssign}
          canEdit={canEdit}
          currentUserId={currentUserId}
          productionVAs={productionVAs}
          uploaderVAs={uploaderVAs}
          finalVideoAssetKey={finalVideoAssetKey}
          finalVideoUrl={mediaView.finalVideoUrl}
        />
      )}

      {activeTab === "comparison" && isComparisonJob && (
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <ComparisonHeroUpload
            jobId={job.id}
            channelId={job.channel_id}
            productAName={comparisonMeta.products?.[0]?.name ?? "Product A"}
            productBName={comparisonMeta.products?.[1]?.name ?? "Product B"}
            productAHeroKey={
              comparisonMeta.products?.[0]?.hero_asset_key ?? null
            }
            productBHeroKey={
              comparisonMeta.products?.[1]?.hero_asset_key ?? null
            }
          />
          <ComparisonDataGridEditor
            jobId={job.id}
            productAName={comparisonMeta.products?.[0]?.name ?? "Product A"}
            productBName={comparisonMeta.products?.[1]?.name ?? "Product B"}
            initialDataGrid={comparisonMeta.data_grid}
            currentUserId={currentUserId}
          />
        </div>
      )}

      {activeTab === "scenes" && (
        <ScenesTab scenes={sceneImages} jobId={job.id} />
      )}

      {activeTab === "assets" && (
        <AssetsTab assets={filteredAssets} jobId={job.id} />
      )}

      {activeTab === "logs" && <LogsTab generationLog={generationLog} />}
    </div>
  );
}

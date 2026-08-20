"use client";

import { useEffect, useState } from "react";
import { ClipForgeShell } from "./shell";
import { DashboardScreen } from "../_screens/dashboard";
import { PipelineScreen } from "../_screens/pipeline";
import { SourcesScreen } from "../_screens/sources";
import { SourceDetailScreen } from "../_screens/source-detail";
import { PoolScreen } from "../_screens/pool";
import { InspectorScreen } from "../_screens/inspector";
import { StudioScreen } from "../_screens/studio";
import { DistributionScreen } from "../_screens/distribution";
import { AccountsScreen } from "../_screens/accounts";
import { QcScreen } from "../_screens/qc";
import { ErrorsScreen } from "../_screens/errors";
import { ConfigScreen } from "../_screens/config";
import { AnalyticsScreen } from "../_screens/analytics";
import { PresetsScreen } from "../_screens/presets";
import { emptyCfData, fetchCfData } from "../_lib/fetch";
import type { CfClip, CfData, ScreenId } from "../_lib/types";

/**
 * Clip Forge console — connected to live `/api/v1/clip-forge/console`.
 *
 * Loads real rows from the `cf_*` tables and polls every 4s so screens stay
 * current as workers move state forward. There is no fallback to synthetic
 * data: if the API errors, screens render their empty state and an error chip
 * shows in the shell. Empty arrays in the real response are NOT an error —
 * that's just the truth before anything has been ingested.
 */
export function ClipForgeConsole() {
  const [data, setData] = useState<CfData>(() => emptyCfData());
  const [screen, setScreen] = useState<ScreenId>("dashboard");
  const [persona, setPersona] = useState<string>("All personas");
  const [activeClipId, setActiveClipId] = useState<string | null>(null);
  const [activeSourceId, setActiveSourceId] = useState<string | null>(null);
  const [activeVariantId, setActiveVariantId] = useState<string | null>(null);

  async function refresh() {
    try {
      const next = await fetchCfData();
      setData(next);
    } catch (e) {
      setData((prev) => ({
        ...prev,
        loaded: true,
        loadError: e instanceof Error ? e.message : String(e),
      }));
    }
  }

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 4000);
    return () => clearInterval(id);
  }, []);

  const personaOptions = ["All personas", ...data.PERS];
  const cyclePersona = () => {
    const i = personaOptions.indexOf(persona);
    setPersona(personaOptions[(i + 1) % personaOptions.length]);
  };

  // Strictly the selected clip. This used to fall back to `data.clips[0]`,
  // so the Inspector silently showed an arbitrary clip and every action on it
  // (re-render, new variant) applied to something the operator never chose.
  const activeClip: CfClip | null = activeClipId
    ? (data.clips.find((c) => c.id === activeClipId) ?? null)
    : null;

  let screenEl: React.ReactNode = null;
  switch (screen) {
    case "dashboard":
      screenEl = <DashboardScreen data={data} />;
      break;
    case "pipeline":
      screenEl = <PipelineScreen data={data} />;
      break;
    case "sources":
      screenEl = (
        <SourcesScreen
          data={data}
          onChange={refresh}
          onOpenSource={(fullId) => {
            setActiveSourceId(fullId);
            setScreen("source");
          }}
        />
      );
      break;
    case "source":
      if (activeSourceId) {
        screenEl = (
          <SourceDetailScreen
            sourceId={activeSourceId}
            data={data}
            setScreen={setScreen}
            onOpenClip={(fullId) => {
              const c = data.clips.find((x) => x.fullId === fullId);
              setActiveClipId(c ? c.id : null);
              setScreen("inspector");
            }}
          />
        );
      } else {
        screenEl = (
          <EmptyState
            title="No source selected"
            body="Pick a source from the SRC screen."
          />
        );
      }
      break;
    case "pool":
      screenEl = (
        <PoolScreen
          data={data}
          persona={persona}
          onOpenClip={(c) => {
            setActiveClipId(c.id);
            setScreen("inspector");
          }}
          setScreen={setScreen}
          onChange={refresh}
        />
      );
      break;
    case "inspector":
      if (activeClip) {
        screenEl = (
          <InspectorScreen
            data={data}
            clip={activeClip}
            setScreen={setScreen}
            onEditVariant={(variantId) => {
              setActiveVariantId(variantId);
              setScreen("studio");
            }}
          />
        );
      } else {
        screenEl = (
          <EmptyState
            title="No clip selected"
            body="Open a clip from the Pool to see its inspector."
          />
        );
      }
      break;
    case "studio":
      screenEl = (
        <StudioScreen setScreen={setScreen} variantId={activeVariantId} />
      );
      break;
    case "distribution":
      screenEl = <DistributionScreen data={data} />;
      break;
    case "accounts":
      screenEl = <AccountsScreen data={data} onChange={refresh} />;
      break;
    case "presets":
      screenEl = <PresetsScreen />;
      break;
    case "qc":
      screenEl = <QcScreen data={data} persona={persona} onChange={refresh} />;
      break;
    case "errors":
      screenEl = <ErrorsScreen data={data} onChange={refresh} />;
      break;
    case "config":
      screenEl = <ConfigScreen data={data} />;
      break;
    case "analytics":
      screenEl = <AnalyticsScreen data={data} />;
      break;
  }

  return (
    <ClipForgeShell
      screen={screen}
      setScreen={(s) => {
        setScreen(s);
        if (s === "pool") setActiveClipId(null);
      }}
      persona={persona}
      cyclePersona={cyclePersona}
      data={data}
      onSelectClip={(fullId) => {
        const c = data.clips.find((x) => x.fullId === fullId);
        setActiveClipId(c ? c.id : null);
        setScreen("inspector");
      }}
      onSelectSource={(fullId) => {
        setActiveSourceId(fullId);
        setScreen("source");
      }}
    >
      {data.loadError && (
        <div
          style={{
            margin: "10px 16px 0",
            padding: "8px 12px",
            border: "1px solid #5a4046",
            background: "rgba(207,116,104,.08)",
            color: "#dd8d83",
            borderRadius: 6,
            fontSize: 11.5,
            fontFamily: "'IBM Plex Mono', monospace",
          }}
        >
          live data load failed: {data.loadError}
        </div>
      )}
      {screenEl}
    </ClipForgeShell>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        color: "#7d8893",
      }}
    >
      <div style={{ fontSize: 14, fontWeight: 600, color: "#cfd4da" }}>
        {title}
      </div>
      <div style={{ fontSize: 12 }}>{body}</div>
    </div>
  );
}

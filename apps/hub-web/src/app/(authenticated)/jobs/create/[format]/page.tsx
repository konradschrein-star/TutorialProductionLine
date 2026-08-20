import { redirect, notFound } from "next/navigation";
import { getSession } from "../../../_lib/v2-auth";
import { hasPermission } from "@/lib/auth/rbac";
import { isFormatOfferedToOperators } from "@/lib/format-lifecycle";
import { listChannels } from "@/lib/repositories/channel-repository";
import { listTemplates } from "@/lib/repositories/template-repository";
import { listArchetypes } from "@/lib/repositories/archetype-repository";
import { listCharacters } from "@/lib/repositories/character-repository";
import { listStyleCollections } from "@/lib/repositories/style-library-repository";
import { GlassCard } from "../../../_components/glass-card";
import { CasuallyExplainedForm } from "./casually-explained-form";
import { ExplainerForm } from "./explainer-form";
import { TechComparisonForm } from "./tech-comparison-form";
import { BundestagForm } from "./bundestag-form";
import { LongFormDramaForm } from "./long-form-drama-form";
import { GenericForm } from "./generic-form";
import { PoliticalCommentaryReactorForm } from "./political-commentary-reactor-form";
import { RankingForm } from "./ranking-form";
import { BusinessHubForm } from "./business-hub-form";
import { listPresetDramaCharacters } from "@/lib/repositories/drama-character-repository";
import { listClipLibraries } from "@repo/db/repositories";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const FORMAT_DESCRIPTIONS: Record<string, string> = {
  CASUALLY_EXPLAINED: "Dry-humor commentary with stick-figure illustration art",
  EXPLAINER: "Educational breakdowns of concepts, processes, or systems",
  POLITICAL_COMMENTARY_REACTOR:
    "Reactor commentary — downloads a YouTube video, auto-transcribes, generates skeptical German commentary with animated avatar overlay",
  TECH_COMPARISON: "Side-by-side product evaluations and reviews",
  BUNDESTAG: "German parliament automated coverage",
  LONG_FORM_DRAMA:
    "Ultra-realistic relationship drama story (45–90 min) with photorealistic AI imagery",
  VIDEO_ESSAY: "Long-form opinion or analysis pieces",
  DOCUMENTARY: "Long-form narrative content",
  RANKING:
    "Tier-list ranking videos — rank anything into 5 tiers with an opinionated host",
  BUSINESS_PLAN_HUB:
    "Business-plan, SBA and EB-5 marketing explainers — computed charts, cited claims, logo-headed presenter",
};

export default async function CreateFormatJobPage({
  params,
}: {
  params: Promise<{ format: string }>;
}) {
  const session = await getSession();
  if (!hasPermission(session, "create:job")) redirect("/dashboard");

  const { format: formatSlug } = await params;
  const formatId = formatSlug.toUpperCase().replace(/-/g, "_");
  if (!Object.hasOwn(FORMAT_DESCRIPTIONS, formatId)) notFound();
  // IDLE formats are parked, not deleted — creating a job is opt-in via
  // CF_ENABLE_IDLE_FORMATS. See @repo/contracts FORMAT_LIFECYCLE.
  // Today this gate is reachable only for BUNDESTAG: its form and pipeline are
  // intact, so enabling the env var genuinely restores job creation.
  // POLITICAL_COMMENTARY has no FORMAT_DESCRIPTIONS key and no form component
  // (both deleted in 031771d7), so it 404s on the line above and never reaches
  // here — enabling the env var alone will NOT bring it back. See
  // docs/FORMAT_REGISTRIES.md for what its restoration actually requires.
  if (!isFormatOfferedToOperators(formatId)) notFound();
  const displayName = formatId
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
  const description = FORMAT_DESCRIPTIONS[formatId] ?? "";

  const [channels, allTemplates] = await Promise.all([
    listChannels(),
    listTemplates(),
  ]);

  const templates = allTemplates.filter(
    (t) => t.format === formatId && t.is_active,
  );

  const needsVisualAssets = formatId === "CASUALLY_EXPLAINED";
  const [archetypes, characters, styleCollections] = needsVisualAssets
    ? await Promise.all([
        listArchetypes(true),
        listCharacters({ active_only: true }),
        listStyleCollections({ format: formatId, is_active: true }),
      ])
    : [[], [], []];

  const presetDramaCharacters =
    formatId === "LONG_FORM_DRAMA" ? await listPresetDramaCharacters() : [];
  const dramaLibraries =
    formatId === "LONG_FORM_DRAMA" ? await listClipLibraries() : [];

  if (channels.length === 0) {
    return (
      <div style={{ maxWidth: 800, margin: "0 auto", padding: "0 24px" }}>
        <p style={{ color: "#f97316", fontSize: 13 }}>
          No channels configured. Create a channel first.
        </p>
      </div>
    );
  }

  function renderForm() {
    const base = { channels, templates };
    switch (formatId) {
      case "CASUALLY_EXPLAINED":
        return (
          <CasuallyExplainedForm
            {...base}
            archetypes={archetypes as any[]}
            characters={characters as any[]}
            styleCollections={styleCollections as any[]}
          />
        );
      case "EXPLAINER":
        return <ExplainerForm {...base} />;
      case "POLITICAL_COMMENTARY_REACTOR":
        return <PoliticalCommentaryReactorForm {...base} />;
      case "TECH_COMPARISON":
        return <TechComparisonForm {...base} />;
      case "RANKING":
        return <RankingForm {...base} />;
      case "BUSINESS_PLAN_HUB":
        return <BusinessHubForm {...base} />;
      case "BUNDESTAG":
        return <BundestagForm {...base} />;
      case "LONG_FORM_DRAMA":
        // The new drama form ignores presetCharacters (the cast UI was
        // dropped in favour of a per-library character_block) but we
        // pass it through so older deployments keep typechecking.
        void presetDramaCharacters;
        return (
          <LongFormDramaForm
            channels={channels.map((c) => ({
              id: c.id,
              name: c.name,
              clip_library_id: c.clip_library_id ?? null,
            }))}
            libraries={dramaLibraries.map((l) => ({ id: l.id, name: l.name }))}
          />
        );
      default:
        if (templates.length === 0) notFound();
        return <GenericForm {...base} formatId={formatId} />;
    }
  }

  return (
    <div style={{ maxWidth: 800, margin: "0 auto", padding: "0 24px" }}>
      <div style={{ marginBottom: 24 }}>
        <h1
          style={{
            color: "#e5e2e1",
            fontSize: 20,
            fontWeight: 800,
            margin: "0 0 4px 0",
          }}
        >
          Create {displayName} Job
        </h1>
        {description && (
          <p style={{ color: "#cdc3d7", fontSize: 12, margin: 0 }}>
            {description}
          </p>
        )}
      </div>
      <GlassCard style={{ padding: 32 }}>{renderForm()}</GlassCard>
    </div>
  );
}

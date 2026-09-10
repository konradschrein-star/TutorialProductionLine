"use client";

import { useMemo, useRef, useState } from "react";
import { GlassCard } from "@/app/(authenticated)/_components";
import { V2Listbox } from "@/components/thumbnails/v2-listbox";
import {
  archetypeImageUrl,
  aspectPadding,
  type ChannelOption,
  type ThumbnailArchetype,
} from "@/components/thumbnails/types";

/**
 * Archetype gallery — image-forward cards, dense grid.
 *
 * The scope filter defaults to "Global" because that is what archetypes are by
 * default and where the 44 imported ones live.
 */

const TEXT_1 = "#e5e2e1";
const TEXT_2 = "#cdc3d7";

interface Props {
  archetypes: ThumbnailArchetype[];
  channels: ChannelOption[];
  onEdit: (a: ThumbnailArchetype) => void;
  onCreate: () => void;
  onGenerateWith: (a: ThumbnailArchetype) => void;
  /** Called after a Duplicate/Replace so the page can refresh the list. */
  onChanged: () => void;
}

export function ArchetypeGallery({
  archetypes,
  channels,
  onEdit,
  onCreate,
  onGenerateWith,
  onChanged,
}: Props) {
  const [scope, setScope] = useState("all");
  const [category, setCategory] = useState("all");
  const [query, setQuery] = useState("");

  const categories = useMemo(() => {
    const set = new Set(archetypes.map((a) => a.category).filter(Boolean));
    return ["all", ...[...set].sort()];
  }, [archetypes]);

  const channelName = useMemo(
    () => new Map(channels.map((c) => [c.id, c.name])),
    [channels],
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return archetypes.filter((a) => {
      if (scope === "global" && a.channel_id !== null) return false;
      if (scope !== "all" && scope !== "global" && a.channel_id !== scope) {
        return false;
      }
      if (category !== "all" && a.category !== category) return false;
      if (q && !`${a.name} ${a.description ?? ""}`.toLowerCase().includes(q)) {
        return false;
      }
      return true;
    });
  }, [archetypes, scope, category, query]);

  const globalCount = archetypes.filter((a) => a.channel_id === null).length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <section aria-labelledby="procedural-blueprints-title">
        <div style={{display:"flex",alignItems:"end",justifyContent:"space-between",gap:12,marginBottom:10,flexWrap:"wrap"}}>
          <div><h2 id="procedural-blueprints-title" style={{margin:0,fontSize:18,color:TEXT_1}}>Procedural blueprints</h2><p style={{margin:"4px 0 0",fontSize:12.5,color:TEXT_2}}>Two right-locked automatic layouts. Left-host compositions remain available only as manual exceptions in the editor.</p></div>
          <a href="/settings?section=channels" className="v2-btn" style={{textDecoration:"none"}}>Configure channels</a>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))",gap:10}}>
          {[
            ["UI focus · host right","Recorded interface","right"],
            ["Icon focus · host right","App or document","right"],
          ].map(([name,object,side])=><div key={name} style={{border:"1px solid var(--v2-border-2)",borderRadius:10,overflow:"hidden",background:"var(--v2-surface-1)"}}>
            <div aria-hidden="true" style={{height:124,position:"relative",background:"linear-gradient(135deg,#f7f8fa,#dfe4e8)"}}>
              <div style={{position:"absolute",left:side==="right"?12:92,right:side==="left"?12:92,top:12,height:32,borderRadius:7,background:"#0b0c0f"}}/>
              <div style={{position:"absolute",left:side==="right"?12:76,right:side==="left"?12:76,top:54,bottom:10,border:"3px solid #17191d",borderRadius:9,background:"white"}}/>
              <div style={{position:"absolute",left:side==="left"?-8:undefined,right:side==="right"?-8:undefined,top:19,width:88,height:116,borderRadius:"48px 48px 12px 12px",background:"linear-gradient(#d6a47e 0 34%,#18314e 35%)"}}/>
              <div style={{position:"absolute",left:side==="right"?118:74,top:48,color:"#ef233c",fontSize:30,fontWeight:900}}>↘</div>
            </div>
            <div style={{padding:10}}><strong style={{display:"block",fontSize:12.5,color:TEXT_1}}>{name}</strong><span style={{fontSize:11,color:TEXT_2}}>Tight host · 1–4 words · {object} · arrow only for a neutral pose</span></div>
          </div>)}
        </div>
      </section>

      <div style={{height:1,background:"var(--v2-border-2)",margin:"4px 0"}}/>
      <h2 style={{margin:0,fontSize:18,color:TEXT_1}}>AI and reference archetypes</h2>
      {/* Filter bar */}
      <GlassCard
        style={{
          padding: 12,
          display: "grid",
          gridTemplateColumns:
            "minmax(180px, 1fr) minmax(150px, 220px) minmax(150px, 220px) auto",
          gap: 10,
          alignItems: "end",
          // Establish a stacking context above the card grid below so the
          // Channel/Category dropdown panels aren't painted behind the cards.
          position: "relative",
          zIndex: 40,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: TEXT_2,
            }}
          >
            Search
          </span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Name or description…"
            style={{
              padding: "9px 10px",
              borderRadius: 8,
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(var(--v2-accent-rgb), 0.16)",
              color: TEXT_1,
              fontSize: 13,
              outline: "none",
            }}
          />
        </div>

        <V2Listbox
          label="Channel"
          value={scope}
          onChange={setScope}
          options={[
            {
              value: "all",
              label: "All",
              hint: `${archetypes.length} archetypes`,
            },
            {
              value: "global",
              label: "Global",
              hint: `${globalCount} usable everywhere`,
            },
            ...channels.map((c) => ({ value: c.id, label: c.name })),
          ]}
        />

        <V2Listbox
          label="Category"
          value={category}
          onChange={setCategory}
          options={categories.map((c) => ({
            value: c,
            label: c === "all" ? "All categories" : c,
          }))}
        />

        <button
          type="button"
          onClick={onCreate}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "9px 14px",
            borderRadius: 8,
            background: "rgba(var(--v2-accent-rgb), 0.16)",
            border: "1px solid rgba(var(--v2-accent-rgb), 0.4)",
            color: "var(--v2-accent)",
            fontSize: 11,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            cursor: "pointer",
            whiteSpace: "nowrap",
          }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
            add
          </span>
          New archetype
        </button>
      </GlassCard>

      <div style={{ fontSize: 11.5, color: TEXT_2 }}>
        Showing <strong style={{ color: TEXT_1 }}>{visible.length}</strong> of{" "}
        {archetypes.length}. Archetypes with no channel are{" "}
        <strong style={{ color: "var(--v2-accent)" }}>global</strong> — every
        channel and format can use them.
      </div>

      {visible.length === 0 ? (
        <GlassCard style={{ padding: 32, textAlign: "center" }}>
          <span
            className="material-symbols-outlined"
            style={{ fontSize: 32, color: "var(--v2-accent)" }}
          >
            image_search
          </span>
          <p style={{ color: TEXT_2, fontSize: 13, margin: "10px 0 0" }}>
            No archetypes match. If the library is empty, run{" "}
            <code style={{ color: TEXT_1 }}>
              pnpm --filter @repo/db seed:thumbnail-archetypes-v2
            </code>{" "}
            to import the 44 archetypes from the old tool.
          </p>
        </GlassCard>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(226px, 1fr))",
            gap: 12,
          }}
        >
          {visible.map((a) => (
            <ArchetypeCard
              key={a.id}
              archetype={a}
              channelLabel={
                a.channel_id
                  ? (channelName.get(a.channel_id) ?? "Channel")
                  : null
              }
              onEdit={() => onEdit(a)}
              onGenerate={() => onGenerateWith(a)}
              onChanged={onChanged}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ArchetypeCard({
  archetype,
  channelLabel,
  onEdit,
  onGenerate,
  onChanged,
}: {
  archetype: ThumbnailArchetype;
  channelLabel: string | null;
  onEdit: () => void;
  onGenerate: () => void;
  onChanged: () => void;
}) {
  const [hover, setHover] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  // D2: Duplicate — the SAFE alternative to Replace. Clones the row (shares the
  // reference image file) as a new global, unassigned preset.
  async function duplicate() {
    setBusy(true);
    try {
      const res = await fetch("/api/thumbnails/archetypes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: `${archetype.name} (copy)`,
          channel_id: null,
          description: archetype.description ?? undefined,
          reference_image_path: archetype.reference_image_path,
          extra_reference_paths: archetype.extra_reference_paths,
          layout_instructions: archetype.layout_instructions ?? undefined,
          base_prompt: archetype.base_prompt ?? undefined,
          features_logo: archetype.features_logo,
          category: archetype.category,
          formats: archetype.formats,
          aspect_ratio: archetype.aspect_ratio,
          resolution: archetype.resolution,
        }),
      });
      if (!res.ok)
        throw new Error((await res.json()).error ?? "Duplicate failed");
      onChanged();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Duplicate failed");
    } finally {
      setBusy(false);
    }
  }

  // D2: Replace — silently changes EVERY future generation, so confirm first.
  async function replace(file: File) {
    if (
      !confirm(
        `Replace the reference image for "${archetype.name}"?\n\nThis changes every future generation that uses this preset. Use Duplicate instead if you want to keep the original.`,
      )
    )
      return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const up = await fetch("/api/thumbnails/upload", {
        method: "POST",
        body: fd,
      });
      const upJson = await up.json();
      if (!up.ok) throw new Error(upJson.error ?? "Upload failed");
      const patch = await fetch(`/api/thumbnails/archetypes/${archetype.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reference_image_path: upJson.path }),
      });
      if (!patch.ok)
        throw new Error((await patch.json()).error ?? "Replace failed");
      onChanged();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Replace failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <GlassCard
      style={{
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        border: hover
          ? "1px solid rgba(var(--v2-accent-rgb), 0.42)"
          : "1px solid rgba(255,255,255,0.09)",
        transition: "border-color 140ms, transform 140ms",
        transform: hover ? "translateY(-2px)" : "none",
        opacity: archetype.is_active ? 1 : 0.5,
      }}
    >
      <div
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        style={{ display: "flex", flexDirection: "column", height: "100%" }}
      >
        {/* Image */}
        <div
          style={{
            position: "relative",
            width: "100%",
            paddingTop: aspectPadding(archetype.aspect_ratio),
            background: "rgba(255,255,255,0.05)",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={archetypeImageUrl(archetype.id)}
            // Empty alt on purpose: if the reference image fails to load, the
            // browser must NOT render the archetype name over the GLOBAL badge
            // (the name is already shown in the card body). A failed image just
            // shows the subtle background.
            alt=""
            loading="lazy"
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              objectFit: "cover",
            }}
          />
          <div
            style={{
              position: "absolute",
              top: 6,
              left: 6,
              display: "flex",
              gap: 4,
              flexWrap: "wrap",
            }}
          >
            <Badge
              accent={!channelLabel}
              icon={channelLabel ? "tv" : "public"}
              text={channelLabel ?? "Global"}
            />
            {archetype.features_logo && (
              <Badge icon="branding_watermark" text="Logo" />
            )}
            {!archetype.is_active && (
              <Badge icon="visibility_off" text="Inactive" />
            )}
          </div>

          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            style={{ display: "none" }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void replace(f);
              e.target.value = "";
            }}
          />
          {hover && (
            <div
              style={{
                position: "absolute",
                inset: 0,
                background:
                  "linear-gradient(to top, rgba(0,0,0,0.82) 0%, rgba(0,0,0,0.1) 55%)",
                display: "flex",
                flexWrap: "wrap",
                alignItems: "flex-end",
                gap: 5,
                padding: 8,
              }}
            >
              <OverlayButton
                icon="auto_awesome"
                text="Generate"
                onClick={onGenerate}
              />
              <OverlayButton icon="edit" text="Edit" onClick={onEdit} />
              <a
                href={`${archetypeImageUrl(archetype.id)}&download=1`}
                download
                title="Download this reference image"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  padding: "5px 9px",
                  borderRadius: 6,
                  background: "rgba(0,0,0,0.6)",
                  border: "1px solid rgba(255,255,255,0.2)",
                  color: "#e5e2e1",
                  fontSize: 10,
                  fontWeight: 800,
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  textDecoration: "none",
                }}
              >
                <span
                  className="material-symbols-outlined"
                  style={{ fontSize: 13 }}
                >
                  download
                </span>
                Get
              </a>
              <OverlayButton
                icon="content_copy"
                text="Copy"
                onClick={duplicate}
                disabled={busy}
              />
              {!archetype.is_locked && (
                <OverlayButton
                  icon="swap_horiz"
                  text="Replace"
                  onClick={() => fileRef.current?.click()}
                  disabled={busy}
                />
              )}
            </div>
          )}
        </div>

        {/* Meta */}
        <div
          style={{
            padding: 10,
            display: "flex",
            flexDirection: "column",
            gap: 4,
            flex: 1,
          }}
        >
          <span
            title={archetype.name}
            style={{
              fontSize: 12.5,
              fontWeight: 700,
              color: TEXT_1,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {archetype.name}
          </span>
          <span
            style={{
              fontSize: 11,
              color: TEXT_2,
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
              minHeight: 28,
            }}
          >
            {archetype.description ||
              archetype.layout_instructions ||
              "No layout notes"}
          </span>
          <div
            style={{
              display: "flex",
              gap: 6,
              fontSize: 9.5,
              color: TEXT_2,
              marginTop: 2,
              textTransform: "uppercase",
              letterSpacing: "0.05em",
            }}
          >
            <span>{archetype.aspect_ratio}</span>
            <span style={{ opacity: 0.4 }}>·</span>
            <span>{archetype.resolution.toUpperCase()}</span>
            <span style={{ opacity: 0.4 }}>·</span>
            <span
              style={{
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {archetype.formats.length === 0
                ? "All formats"
                : `${archetype.formats.length} format${archetype.formats.length > 1 ? "s" : ""}`}
            </span>
          </div>
        </div>
      </div>
    </GlassCard>
  );
}

function Badge({
  icon,
  text,
  accent,
}: {
  icon: string;
  text: string;
  accent?: boolean;
}) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 3,
        padding: "2px 6px",
        borderRadius: 4,
        background: accent
          ? "rgba(var(--v2-accent-rgb), 0.85)"
          : "rgba(0,0,0,0.66)",
        color: accent ? "#12101a" : "#e5e2e1",
        fontSize: 9,
        fontWeight: 800,
        textTransform: "uppercase",
        letterSpacing: "0.05em",
      }}
    >
      <span className="material-symbols-outlined" style={{ fontSize: 11 }}>
        {icon}
      </span>
      {text}
    </span>
  );
}

function OverlayButton({
  icon,
  text,
  onClick,
  disabled,
}: {
  icon: string;
  text: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "5px 9px",
        borderRadius: 6,
        background: "rgba(var(--v2-accent-rgb), 0.9)",
        border: "none",
        color: "#12101a",
        fontSize: 10,
        fontWeight: 800,
        textTransform: "uppercase",
        letterSpacing: "0.05em",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <span className="material-symbols-outlined" style={{ fontSize: 13 }}>
        {icon}
      </span>
      {text}
    </button>
  );
}

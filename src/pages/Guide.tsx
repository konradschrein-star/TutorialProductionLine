import React, { useEffect, useState } from 'react';
import {
  BookOpen,
  Video,
  Sliders,
  Palette,
  Search,
  FolderCheck,
  Users,
  Globe,
  ShieldCheck,
  Command,
  FileText,
  Volume2,
  BarChart3,
  Settings as SettingsIcon,
  Film,
  Sparkles,
  Lock,
  Key
} from 'lucide-react';
import { useConfig } from '../hooks/useStore';

interface GuideSection {
  id: string;
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  admin?: boolean;
}

// Declared at module scope so it is a stable reference for the hash bootstrap.
const SECTIONS: GuideSection[] = [
  { id: 'overview', title: 'System Overview & Pipeline', icon: BookOpen },
  { id: 'roles', title: 'Roles & Access (VA vs Admin)', icon: Lock },
  { id: 'keywords', title: 'Keyword Discovery & Screening', icon: Search },
  { id: 'produce', title: 'Produce: Record → Take → Deliver', icon: Video },
  { id: 'studio', title: 'Studio Pipeline Queue', icon: Sliders },
  { id: 'thumbnails', title: 'Thumbnail Studio', icon: Palette },
  { id: 'library', title: 'Finished Library & Delivery', icon: FolderCheck },
  { id: 'metrics', title: 'Production Metrics', icon: BarChart3 },
  { id: 'config', title: 'Studio Configuration', icon: SettingsIcon, admin: true },
  { id: 'settings', title: 'Settings, Team & API Keys', icon: Users, admin: true },
  { id: 'shortcuts', title: 'Shortcuts & Pro-Tips', icon: Command }
];

const readHash = (): string =>
  typeof window !== 'undefined' ? window.location.hash.replace(/^#/, '') : '';

export const Guide: React.FC = () => {
  const config = useConfig();
  const product = config.productName;

  const [activeSection, setActiveSection] = useState<string>(() => {
    const h = readHash();
    return SECTIONS.some(s => s.id === h) ? h : 'overview';
  });

  // Deep-linking: read the hash on load and follow back/forward navigation.
  useEffect(() => {
    const onHash = () => {
      const h = readHash();
      if (SECTIONS.some(s => s.id === h)) setActiveSection(h);
    };
    onHash();
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const goTo = (id: string) => {
    setActiveSection(id);
    if (readHash() !== id) {
      window.history.replaceState(null, '', `#${id}`);
    }
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6 animate-fadeIn">

      {/* Hero Header */}
      <div className="pro-panel p-6 rounded-2xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4 border border-border shadow-card">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-foreground text-background flex items-center justify-center font-bold">
              <BookOpen className="w-4 h-4" />
            </div>
            <h1 className="text-base font-bold font-display text-foreground">
              {product} — Operator Manual
            </h1>
          </div>
          <p className="text-xs text-muted">
            How the studio actually works today: for Virtual Assistants who produce, and Admins who configure.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span className="badge badge-success font-mono flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5" />
            Operator Guide
          </span>
        </div>
      </div>

      {/* Guide Layout: Left Sidebar Nav (4 cols) / Right Content (8 cols) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">

        {/* Navigation Sidebar */}
        <div className="lg:col-span-4 space-y-2">
          <div className="pro-panel p-2 rounded-xl border border-border space-y-1 sticky top-20">
            <div className="text-[10px] font-mono uppercase font-bold text-muted px-3 py-1.5">
              Table of Contents
            </div>
            {SECTIONS.map(sec => {
              const Icon = sec.icon;
              const isActive = activeSection === sec.id;
              return (
                <a
                  key={sec.id}
                  href={`#${sec.id}`}
                  onClick={(e) => {
                    e.preventDefault();
                    goTo(sec.id);
                  }}
                  className={`w-full p-2.5 rounded-lg text-left text-xs font-semibold flex items-center gap-2.5 transition-all ${
                    isActive
                      ? 'bg-foreground text-background shadow-subtle font-bold'
                      : 'text-muted hover:text-foreground hover:bg-surface-200'
                  }`}
                >
                  <Icon className="w-4 h-4 flex-shrink-0" />
                  <span className="truncate flex-1">{sec.title}</span>
                  {sec.admin && (
                    <span className={`badge ${isActive ? 'badge-neutral' : 'badge-accent'} text-[9px] px-1.5 py-0`}>
                      Admin
                    </span>
                  )}
                </a>
              );
            })}
          </div>
        </div>

        {/* Main Content Area */}
        <div className="lg:col-span-8 space-y-6">

          {/* 1. OVERVIEW */}
          {activeSection === 'overview' && (
            <div id="section-overview" className="pro-panel p-6 rounded-2xl border border-border space-y-5 animate-fadeIn">
              <div>
                <h2 className="text-sm font-bold font-display text-foreground uppercase tracking-wide">
                  System Overview & Pipeline
                </h2>
                <p className="text-xs text-muted mt-1 leading-relaxed">
                  {product} turns a chosen software topic into a short, voiced screen-tutorial and a
                  ready-to-hand-off delivery package. Work moves left to right: find a keyword, generate a
                  script, synthesize a voiceover, record your screen take, then package the result for delivery.
                </p>
              </div>

              {/* Visual pipeline */}
              <div className="p-4 rounded-xl bg-surface-200 border border-border space-y-3">
                <div className="text-[10px] font-mono uppercase font-bold text-muted">Pipeline Stages</div>

                <div className="grid grid-cols-1 sm:grid-cols-5 gap-2 text-center text-xs">
                  <div className="p-3 rounded-lg bg-surface-100 border border-border space-y-1">
                    <Search className="w-4 h-4 mx-auto text-foreground" />
                    <div className="font-bold text-[11px] text-foreground">1. Discover</div>
                    <p className="text-[9px] font-mono text-muted">Suggest + score + screen</p>
                  </div>

                  <div className="p-3 rounded-lg bg-surface-100 border border-border space-y-1">
                    <FileText className="w-4 h-4 mx-auto text-foreground" />
                    <div className="font-bold text-[11px] text-foreground">2. Script</div>
                    <p className="text-[9px] font-mono text-muted">AI draft (provider key)</p>
                  </div>

                  <div className="p-3 rounded-lg bg-surface-100 border border-border space-y-1">
                    <Volume2 className="w-4 h-4 mx-auto text-foreground" />
                    <div className="font-bold text-[11px] text-foreground">3. Voiceover</div>
                    <p className="text-[9px] font-mono text-muted">TTS (provider key)</p>
                  </div>

                  <div className="p-3 rounded-lg bg-surface-100 border border-border space-y-1">
                    <Film className="w-4 h-4 mx-auto text-foreground" />
                    <div className="font-bold text-[11px] text-foreground">4. Record Take</div>
                    <p className="text-[9px] font-mono text-muted">Screen capture in-browser</p>
                  </div>

                  <div className="p-3 rounded-lg bg-surface-100 border border-border space-y-1">
                    <FolderCheck className="w-4 h-4 mx-auto text-success" />
                    <div className="font-bold text-[11px] text-success">5. Deliver</div>
                    <p className="text-[9px] font-mono text-muted">Library + Drive package</p>
                  </div>
                </div>
              </div>

              <div className="space-y-3 pt-2">
                <h3 className="text-xs font-bold text-foreground font-mono uppercase">Where each step lives</h3>
                <ul className="space-y-2 text-xs text-muted leading-relaxed">
                  <li className="flex items-start gap-2">
                    <span className="text-foreground font-bold font-mono whitespace-nowrap">Produce (/):</span>
                    <span>Guided flow to script, voice, record a take, and stage the finished video.</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-foreground font-bold font-mono whitespace-nowrap">Keywords (/keywords):</span>
                    <span>Discover topics via Google/YouTube suggest, score the opportunity, and screen with AI.</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-foreground font-bold font-mono whitespace-nowrap">Thumbnails (/thumbnails):</span>
                    <span>Compose channel-branded thumbnails and multilingual title variants.</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-foreground font-bold font-mono whitespace-nowrap">Library (/finished):</span>
                    <span>Every produced video, its script, thumbnail, and delivery/stealth-manifest export.</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-foreground font-bold font-mono whitespace-nowrap">Metrics (/metrics):</span>
                    <span>Per-VA output against daily/weekly targets.</span>
                  </li>
                </ul>
                <p className="text-[11px] text-muted leading-relaxed">
                  Steps 2 and 3 (AI scripting and TTS) call external providers and require a provider API key
                  configured by an admin. Without keys, those stages are unavailable — recording and manual
                  scripting still work.
                </p>
              </div>
            </div>
          )}

          {/* 2. ROLES */}
          {activeSection === 'roles' && (
            <div id="section-roles" className="pro-panel p-6 rounded-2xl border border-border space-y-5 animate-fadeIn">
              <div>
                <h2 className="text-sm font-bold font-display text-foreground uppercase tracking-wide">
                  Roles & Access
                </h2>
                <p className="text-xs text-muted mt-1 leading-relaxed">
                  {product} splits the app cleanly into what a VA does day-to-day and what an Admin configures.
                  The navigation you see depends on your role.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                <div className="p-4 rounded-xl bg-surface-200 border border-border space-y-2">
                  <div className="flex items-center gap-2">
                    <Users className="w-4 h-4 text-foreground" />
                    <h4 className="font-bold text-foreground">VA (Operator)</h4>
                  </div>
                  <p className="text-muted text-[11px] leading-relaxed">
                    Focused on output. VAs get:
                  </p>
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {['Produce', 'Keywords', 'Thumbnails', 'Library', 'Metrics (own)'].map(t => (
                      <span key={t} className="badge badge-neutral font-mono text-[10px]">{t}</span>
                    ))}
                  </div>
                </div>

                <div className="p-4 rounded-xl bg-surface-200 border border-border space-y-2">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-accent" />
                    <h4 className="font-bold text-foreground">Admin (Owner)</h4>
                  </div>
                  <p className="text-muted text-[11px] leading-relaxed">
                    Everything a VA can do, plus configuration:
                  </p>
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {['All VA views', 'Config', 'Settings', 'Team & Targets', 'API Keys', 'All Metrics'].map(t => (
                      <span key={t} className="badge badge-accent font-mono text-[10px]">{t}</span>
                    ))}
                  </div>
                </div>
              </div>

              <p className="text-[11px] text-muted leading-relaxed">
                Managers sit between the two (produce plus team/config, no API-key rotation or factory reset).
                Access is capability-based, so destructive and admin-only controls stay hidden unless your role
                permits them.
              </p>
            </div>
          )}

          {/* 3. KEYWORDS */}
          {activeSection === 'keywords' && (
            <div id="section-keywords" className="pro-panel p-6 rounded-2xl border border-border space-y-5 animate-fadeIn">
              <div>
                <h2 className="text-sm font-bold font-display text-foreground uppercase tracking-wide">
                  Keyword Discovery & Screening
                </h2>
                <p className="text-xs text-muted mt-1 leading-relaxed">
                  The Keywords page is where topics come from. It combines live suggest-scraping, an opportunity
                  score, and optional AI screening so you spend production time on topics worth making.
                </p>
              </div>

              <div className="p-4 rounded-xl bg-surface-200 border border-border space-y-2 text-xs text-muted leading-relaxed">
                <div className="p-2.5 rounded-lg bg-surface-100 border border-border space-y-1">
                  <strong className="text-foreground font-mono">Discover</strong>
                  <p className="text-[11px]">
                    Enter a seed and pull related queries from Google and YouTube autosuggest. Results expand into
                    candidate tutorial topics without needing a paid SEO tool.
                  </p>
                </div>

                <div className="p-2.5 rounded-lg bg-surface-100 border border-border space-y-1">
                  <strong className="text-foreground font-mono">Opportunity Score</strong>
                  <p className="text-[11px]">
                    Each candidate is scored from weighted signals — estimated volume, competition, channel fit,
                    freshness, and how well it fits your target length. The weights and thresholds
                    (min volume, max competition, length cap) are set in Studio Configuration.
                  </p>
                </div>

                <div className="p-2.5 rounded-lg bg-surface-100 border border-border space-y-1">
                  <strong className="text-foreground font-mono">AI Screening (optional)</strong>
                  <p className="text-[11px]">
                    With auto-screen enabled and a provider key present, candidates are filtered by an LLM pass
                    for tutorial suitability before they reach your queue.
                  </p>
                </div>

                <div className="p-2.5 rounded-lg bg-surface-100 border border-border space-y-1">
                  <strong className="text-foreground font-mono">Claim → Produce</strong>
                  <p className="text-[11px]">
                    Claim a topic to attribute it to yourself, then send it to Produce. CSV import is still
                    available for client-supplied keyword lists.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* 4. PRODUCE */}
          {activeSection === 'produce' && (
            <div id="section-produce" className="pro-panel p-6 rounded-2xl border border-border space-y-5 animate-fadeIn">
              <div>
                <h2 className="text-sm font-bold font-display text-foreground uppercase tracking-wide">
                  Produce: Record → Take → Deliver
                </h2>
                <p className="text-xs text-muted mt-1 leading-relaxed">
                  The Produce flow walks a single topic from script to a staged, deliverable video. Target length
                  and presets come from Studio Configuration, so you record to a consistent house format.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                <div className="p-3.5 rounded-xl bg-surface-200 border border-border space-y-1.5">
                  <span className="badge badge-neutral font-mono text-[10px]">Step 1</span>
                  <h4 className="font-bold text-foreground">Topic & Channel</h4>
                  <p className="text-muted text-[11px]">
                    Pick the channel and confirm the topic (pre-filled if you arrived from Keywords).
                  </p>
                </div>

                <div className="p-3.5 rounded-xl bg-surface-200 border border-border space-y-1.5">
                  <span className="badge badge-neutral font-mono text-[10px]">Step 2</span>
                  <h4 className="font-bold text-foreground">Script</h4>
                  <p className="text-muted text-[11px]">
                    Generate a draft with AI (requires a provider key) or write/paste your own. Edit freely
                    before recording.
                  </p>
                </div>

                <div className="p-3.5 rounded-xl bg-surface-200 border border-border space-y-1.5">
                  <span className="badge badge-neutral font-mono text-[10px]">Step 3</span>
                  <h4 className="font-bold text-foreground">Voiceover</h4>
                  <p className="text-muted text-[11px]">
                    Synthesize a TTS narration (requires a provider key), or skip it and narrate live while you
                    record.
                  </p>
                </div>

                <div className="p-3.5 rounded-xl bg-surface-200 border border-border space-y-1.5">
                  <span className="badge badge-neutral font-mono text-[10px]">Step 4</span>
                  <h4 className="font-bold text-foreground">Record the Take</h4>
                  <p className="text-muted text-[11px]">
                    Use the in-browser screen recorder with the teleprompter to capture your walkthrough. The
                    recorded take (a <code>.webm</code>) is attached to the video.
                  </p>
                </div>
              </div>

              <div className="p-3 rounded-lg bg-surface-200 border border-border text-[11px] text-muted leading-relaxed flex items-start gap-2">
                <Sparkles className="w-3.5 h-3.5 text-accent flex-shrink-0 mt-0.5" />
                <span>
                  The finished entry lands in the Library. Screen recording runs entirely in the browser;
                  server-side re-encoding or automatic multi-clip splicing is not part of the current build —
                  what you record is what you deliver.
                </span>
              </div>
            </div>
          )}

          {/* 5. STUDIO */}
          {activeSection === 'studio' && (
            <div id="section-studio" className="pro-panel p-6 rounded-2xl border border-border space-y-5 animate-fadeIn">
              <div>
                <h2 className="text-sm font-bold font-display text-foreground uppercase tracking-wide">
                  Studio Pipeline Queue
                </h2>
                <p className="text-xs text-muted mt-1 leading-relaxed">
                  For batching several topics, the Studio Pipeline holds jobs as cards moving through stages so
                  you can script, voice, and record without losing your place.
                </p>
              </div>

              <div className="p-4 rounded-xl bg-surface-200 border border-border space-y-2 text-xs text-muted leading-relaxed">
                <div className="p-2.5 rounded-lg bg-surface-100 border border-border">
                  <strong className="text-foreground font-mono">Stage retries:</strong> Re-run the script or
                  voiceover stage on any card if a take needs regeneration.
                </div>
                <div className="p-2.5 rounded-lg bg-surface-100 border border-border">
                  <strong className="text-foreground font-mono">Take attach & preview:</strong> Attach the
                  recorded take to a card and inspect it before the video is finalized.
                </div>
                <div className="p-2.5 rounded-lg bg-surface-100 border border-border">
                  <strong className="text-foreground font-mono">House format:</strong> Length and speed presets
                  come from Studio Configuration, keeping every job on the same target format.
                </div>
              </div>
            </div>
          )}

          {/* 6. THUMBNAILS */}
          {activeSection === 'thumbnails' && (
            <div id="section-thumbnails" className="pro-panel p-6 rounded-2xl border border-border space-y-5 animate-fadeIn">
              <div>
                <h2 className="text-sm font-bold font-display text-foreground uppercase tracking-wide">
                  Thumbnail Studio
                </h2>
                <p className="text-xs text-muted mt-1 leading-relaxed">
                  Compose channel-branded thumbnails from reference archetypes, your own uploaded assets, and
                  title text — then export localized variants.
                </p>
              </div>

              <div className="space-y-3 text-xs text-muted leading-relaxed">
                <div className="p-3.5 rounded-xl bg-surface-200 border border-border space-y-1.5">
                  <h4 className="font-bold text-foreground">Reference archetypes & custom assets</h4>
                  <p>
                    Start from a reference layout or upload your own persona cut-outs, logos, and backgrounds to
                    keep a consistent channel look.
                  </p>
                </div>

                <div className="p-3.5 rounded-xl bg-surface-200 border border-border space-y-1.5">
                  <h4 className="font-bold text-foreground">Channel presets</h4>
                  <p>
                    Save the active fonts, colors, stroke, and aspect ratio as the channel default so new
                    thumbnails start on-brand.
                  </p>
                </div>

                <div className="p-3.5 rounded-xl bg-surface-200 border border-border space-y-1.5">
                  <h4 className="font-bold text-foreground">Multilingual title variants</h4>
                  <p>
                    Translate the on-thumbnail text into your configured standard languages for a batch export.
                    AI-generated imagery and translation steps require a provider key.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* 7. LIBRARY */}
          {activeSection === 'library' && (
            <div id="section-library" className="pro-panel p-6 rounded-2xl border border-border space-y-5 animate-fadeIn">
              <div>
                <h2 className="text-sm font-bold font-display text-foreground uppercase tracking-wide">
                  Finished Library & Delivery
                </h2>
                <p className="text-xs text-muted mt-1 leading-relaxed">
                  The Library (<code>/finished</code>) is the record of everything you have produced, with search,
                  channel and status filters, and per-video delivery exports.
                </p>
              </div>

              <div className="p-4 rounded-xl bg-surface-200 border border-border space-y-2 text-xs text-muted leading-relaxed">
                <div className="p-2.5 rounded-lg bg-surface-100 border border-border">
                  <strong className="text-foreground font-mono">Inspect & edit:</strong> Open any card to play the
                  take, read or edit the script in place, and replace the thumbnail.
                </div>
                <div className="p-2.5 rounded-lg bg-surface-100 border border-border">
                  <strong className="text-foreground font-mono">Filters reflect reality:</strong> Status filters
                  are derived from the videos actually present, so you never chase an empty pill.
                </div>
                <div className="p-2.5 rounded-lg bg-surface-100 border border-border">
                  <strong className="text-foreground font-mono">Delivery packages:</strong> Export a single
                  stealth-upload manifest (JSON) per video, or a batch manifest across the current filtered view.
                </div>
              </div>
            </div>
          )}

          {/* 8. METRICS */}
          {activeSection === 'metrics' && (
            <div id="section-metrics" className="pro-panel p-6 rounded-2xl border border-border space-y-5 animate-fadeIn">
              <div>
                <h2 className="text-sm font-bold font-display text-foreground uppercase tracking-wide">
                  Production Metrics
                </h2>
                <p className="text-xs text-muted mt-1 leading-relaxed">
                  Metrics tracks output against targets. VAs see their own numbers; admins and managers see the
                  whole team.
                </p>
              </div>

              <div className="p-4 rounded-xl bg-surface-200 border border-border space-y-2 text-xs text-muted leading-relaxed">
                <div className="p-2.5 rounded-lg bg-surface-100 border border-border">
                  <strong className="text-foreground font-mono">Targets:</strong> Daily and weekly targets are set
                  per VA (defaults live in Studio Configuration). Progress is measured against completed,
                  attributed videos.
                </div>
                <div className="p-2.5 rounded-lg bg-surface-100 border border-border">
                  <strong className="text-foreground font-mono">Honest data:</strong> Legacy videos without VA
                  attribution simply don't count toward a person — numbers degrade to zero rather than guessing.
                </div>
              </div>
            </div>
          )}

          {/* 9. CONFIG */}
          {activeSection === 'config' && (
            <div id="section-config" className="pro-panel p-6 rounded-2xl border border-border space-y-5 animate-fadeIn">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-bold font-display text-foreground uppercase tracking-wide">
                  Studio Configuration
                </h2>
                <span className="badge badge-accent font-mono text-[10px]">Admin</span>
              </div>
              <p className="text-xs text-muted leading-relaxed">
                Admins tune how the whole studio behaves at <code>/config</code> ("Studio Configuration"). These
                settings are the single source of truth the rest of the app reads from.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-muted">
                <div className="p-2.5 rounded-lg bg-surface-200 border border-border">
                  <strong className="text-foreground font-mono">Video length</strong>
                  <p className="text-[11px] mt-0.5">Default target minutes and selectable length presets.</p>
                </div>
                <div className="p-2.5 rounded-lg bg-surface-200 border border-border">
                  <strong className="text-foreground font-mono">Keyword filters</strong>
                  <p className="text-[11px] mt-0.5">Min volume, max competition, length cap, and score weights.</p>
                </div>
                <div className="p-2.5 rounded-lg bg-surface-200 border border-border">
                  <strong className="text-foreground font-mono">Topics & software</strong>
                  <p className="text-[11px] mt-0.5">Focus topics, focus software, and content-type mix.</p>
                </div>
                <div className="p-2.5 rounded-lg bg-surface-200 border border-border">
                  <strong className="text-foreground font-mono">VA targets</strong>
                  <p className="text-[11px] mt-0.5">Default daily and weekly output targets.</p>
                </div>
                <div className="p-2.5 rounded-lg bg-surface-200 border border-border">
                  <strong className="text-foreground font-mono">Languages</strong>
                  <p className="text-[11px] mt-0.5">Standard languages used for localization exports.</p>
                </div>
                <div className="p-2.5 rounded-lg bg-surface-200 border border-border">
                  <strong className="text-foreground font-mono">Branding</strong>
                  <p className="text-[11px] mt-0.5">Product name and brand accent — this white-labels the app.</p>
                </div>
              </div>
              <p className="text-[11px] text-muted leading-relaxed">
                Changing the product name here updates it everywhere, including the title of this manual.
              </p>
            </div>
          )}

          {/* 10. SETTINGS */}
          {activeSection === 'settings' && (
            <div id="section-settings" className="pro-panel p-6 rounded-2xl border border-border space-y-5 animate-fadeIn">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-bold font-display text-foreground uppercase tracking-wide">
                  Settings, Team & API Keys
                </h2>
                <span className="badge badge-accent font-mono text-[10px]">Admin</span>
              </div>
              <p className="text-xs text-muted leading-relaxed">
                Settings is where admins manage the people and credentials that power the studio.
              </p>

              <div className="p-4 rounded-xl bg-surface-200 border border-border space-y-2 text-xs text-muted leading-relaxed">
                <div className="p-2.5 rounded-lg bg-surface-100 border border-border flex items-start gap-2">
                  <Users className="w-3.5 h-3.5 text-foreground flex-shrink-0 mt-0.5" />
                  <span>
                    <strong className="text-foreground font-mono">Team:</strong> Create and edit operator
                    accounts, assign channels, and set per-VA targets. Roles are Admin, Manager, and VA.
                  </span>
                </div>
                <div className="p-2.5 rounded-lg bg-surface-100 border border-border flex items-start gap-2">
                  <Key className="w-3.5 h-3.5 text-foreground flex-shrink-0 mt-0.5" />
                  <span>
                    <strong className="text-foreground font-mono">API keys:</strong> Provide the provider keys
                    that unlock AI scripting, TTS voiceover, and AI thumbnail/translation steps. Without a key,
                    those stages are disabled.
                  </span>
                </div>
                <div className="p-2.5 rounded-lg bg-surface-100 border border-border flex items-start gap-2">
                  <Globe className="w-3.5 h-3.5 text-foreground flex-shrink-0 mt-0.5" />
                  <span>
                    <strong className="text-foreground font-mono">Delivery:</strong> Google Drive delivery
                    credentials and folder-token rules (see the delivery notes below).
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* 11. SHORTCUTS */}
          {activeSection === 'shortcuts' && (
            <div id="section-shortcuts" className="pro-panel p-6 rounded-2xl border border-border space-y-5 animate-fadeIn">
              <div>
                <h2 className="text-sm font-bold font-display text-foreground uppercase tracking-wide">
                  Shortcuts & Pro-Tips
                </h2>
                <p className="text-xs text-muted mt-1 leading-relaxed">
                  Small things that speed up recording sessions.
                </p>
              </div>

              <div className="p-4 rounded-xl bg-surface-200 border border-border space-y-3">
                <div className="text-xs font-mono font-bold text-foreground uppercase">Teleprompter</div>

                <div className="space-y-2 text-xs">
                  <div className="flex items-center justify-between p-2 rounded bg-surface-100 border border-border">
                    <span className="text-foreground">Play / Pause Auto-Scroll</span>
                    <kbd className="px-2 py-0.5 rounded bg-surface-200 font-mono text-[11px] border border-border font-bold">Spacebar</kbd>
                  </div>

                  <div className="flex items-center justify-between p-2 rounded bg-surface-100 border border-border">
                    <span className="text-foreground">Adjust Scroll Speed</span>
                    <kbd className="px-2 py-0.5 rounded bg-surface-200 font-mono text-[11px] border border-border font-bold">↑ / ↓ Arrow Keys</kbd>
                  </div>

                  <div className="flex items-center justify-between p-2 rounded bg-surface-100 border border-border">
                    <span className="text-foreground">Close a Modal</span>
                    <kbd className="px-2 py-0.5 rounded bg-surface-200 font-mono text-[11px] border border-border font-bold">Esc</kbd>
                  </div>
                </div>

                <div className="text-[11px] text-muted leading-relaxed pt-1">
                  Tip: sections of this manual are shareable — the URL hash (for example <code>#config</code>)
                  reflects the open section, so you can link a teammate straight to it.
                </div>
              </div>
            </div>
          )}

        </div>

      </div>

    </div>
  );
};

import React, { useState } from 'react';
import { 
  BookOpen, 
  Video, 
  Sliders, 
  Palette, 
  Search, 
  FolderCheck, 
  Users, 
  Globe, 
  Key, 
  ShieldCheck, 
  CheckCircle2, 
  Play, 
  Upload, 
  Download, 
  ExternalLink,
  Sparkles,
  Command,
  ArrowRight,
  Layers,
  FileText,
  Volume2
} from 'lucide-react';

export const Guide: React.FC = () => {
  const [activeSection, setActiveSection] = useState<string>('overview');

  const SECTIONS = [
    { id: 'overview', title: 'System Overview & Pipeline Flow', icon: BookOpen },
    { id: 'keywords', title: 'Keyword Intelligence & CSV Ingest', icon: Search },
    { id: 'conveyor', title: 'Creator Conveyor (5-Step Wizard)', icon: Video },
    { id: 'studio', title: 'Standalone Studio Pipeline', icon: Sliders },
    { id: 'thumbnails', title: 'Thumbnail Studio & 10-Lang ZIP', icon: Palette },
    { id: 'drive', title: 'Google Drive Cloud Delivery Setup', icon: FolderCheck },
    { id: 'accounts', title: 'Team & Account Management', icon: Users },
    { id: 'localization', title: 'Multi-Language Localization Factory', icon: Globe },
    { id: 'shortcuts', title: 'Keyboard Shortcuts & Pro-Tips', icon: Command }
  ];

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
              Workstation Operator Manual &amp; Architecture Guide
            </h1>
          </div>
          <p className="text-xs text-muted">
            Complete operational guide for Virtual Assistants, Managers, and Admins in the Titan Media Empire.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span className="px-2.5 py-1 rounded-lg bg-surface-200 text-foreground text-xs font-mono font-bold border border-border flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
            Version 1.0 Production
          </span>
        </div>
      </div>

      {/* Guide Layout: Left Sidebar Nav (4 cols) / Right Content (8 cols) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Navigation Sidebar */}
        <div className="lg:col-span-4 space-y-2">
          <div className="pro-panel p-2 rounded-xl border border-border space-y-1 sticky top-20">
            <div className="text-[10px] font-mono uppercase font-bold text-muted px-3 py-1.5">
              Guide Table of Contents
            </div>
            {SECTIONS.map(sec => {
              const Icon = sec.icon;
              const isActive = activeSection === sec.id;
              return (
                <button
                  key={sec.id}
                  onClick={() => setActiveSection(sec.id)}
                  className={`w-full p-2.5 rounded-lg text-left text-xs font-semibold flex items-center gap-2.5 transition-all ${
                    isActive
                      ? 'bg-foreground text-background shadow-subtle font-bold'
                      : 'text-muted hover:text-foreground hover:bg-surface-200'
                  }`}
                >
                  <Icon className="w-4 h-4 flex-shrink-0" />
                  <span className="truncate">{sec.title}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Main Content Area */}
        <div className="lg:col-span-8 space-y-6">
          
          {/* 1. OVERVIEW */}
          {activeSection === 'overview' && (
            <div className="pro-panel p-6 rounded-2xl border border-border space-y-5 animate-fadeIn">
              <div>
                <h2 className="text-sm font-bold font-display text-foreground uppercase tracking-wide">
                  1. End-to-End Production Pipeline
                </h2>
                <p className="text-xs text-muted mt-1 leading-relaxed">
                  The Tutorial Production Line is designed for zero-friction video output, converting raw keyword queries into fully recorded, voiced, thumbnail-packaged, and Google Drive delivered tutorials.
                </p>
              </div>

              {/* Labeled Visual Architecture Flow */}
              <div className="p-4 rounded-xl bg-surface-200 border border-border space-y-3">
                <div className="text-[10px] font-mono uppercase font-bold text-muted">Visual Pipeline Architecture</div>
                
                <div className="grid grid-cols-1 sm:grid-cols-5 gap-2 text-center text-xs">
                  <div className="p-3 rounded-lg bg-surface-100 border border-border space-y-1">
                    <Search className="w-4 h-4 mx-auto text-foreground" />
                    <div className="font-bold text-[11px] text-foreground">1. Keywords</div>
                    <p className="text-[9px] font-mono text-muted">2,150 Pool &amp; CSV Ingest</p>
                  </div>

                  <div className="p-3 rounded-lg bg-surface-100 border border-border space-y-1">
                    <FileText className="w-4 h-4 mx-auto text-foreground" />
                    <div className="font-bold text-[11px] text-foreground">2. Scripting</div>
                    <p className="text-[9px] font-mono text-muted">Groq LLaMA 3.3 + DeepSeek</p>
                  </div>

                  <div className="p-3 rounded-lg bg-surface-100 border border-border space-y-1">
                    <Volume2 className="w-4 h-4 mx-auto text-foreground" />
                    <div className="font-bold text-[11px] text-foreground">3. Voiceover</div>
                    <p className="text-[9px] font-mono text-muted">Fish / ElevenLabs TTS</p>
                  </div>

                  <div className="p-3 rounded-lg bg-surface-100 border border-border space-y-1">
                    <Video className="w-4 h-4 mx-auto text-foreground" />
                    <div className="font-bold text-[11px] text-foreground">4. Take Ingest</div>
                    <p className="text-[9px] font-mono text-muted">Speed Match &amp; Splice</p>
                  </div>

                  <div className="p-3 rounded-lg bg-surface-100 border border-border space-y-1">
                    <FolderCheck className="w-4 h-4 mx-auto text-emerald-500" />
                    <div className="font-bold text-[11px] text-emerald-500">5. Delivery</div>
                    <p className="text-[9px] font-mono text-muted">Google Drive Auto-Sync</p>
                  </div>
                </div>
              </div>

              <div className="space-y-3 pt-2">
                <h3 className="text-xs font-bold text-foreground font-mono uppercase">Key Workstation Modules:</h3>
                <ul className="space-y-2 text-xs text-muted leading-relaxed">
                  <li className="flex items-start gap-2">
                    <span className="text-foreground font-bold font-mono">Conveyor (`/`):</span>
                    <span>5-step guided wizard for single-take rapid video assembly and prompt generation.</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-foreground font-bold font-mono">Studio Pipeline (`/studio`):</span>
                    <span>Workstation queue manager with speed sliders (`1.0x`–`1.6x`), audio waveforms, and take droppers.</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-foreground font-bold font-mono">Thumbnail Studio (`/thumbnails`):</span>
                    <span>Visual drag-and-drop thumbnail designer with custom brand reference uploading and 10-language ZIP generation.</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-foreground font-bold font-mono">Keywords Hub (`/keywords`):</span>
                    <span>2,150 embedded high-retention topics, search volume filters, and CSV batch ingestion.</span>
                  </li>
                </ul>
              </div>
            </div>
          )}

          {/* 2. KEYWORDS */}
          {activeSection === 'keywords' && (
            <div className="pro-panel p-6 rounded-2xl border border-border space-y-5 animate-fadeIn">
              <div>
                <h2 className="text-sm font-bold font-display text-foreground uppercase tracking-wide">
                  2. Keyword Intelligence &amp; CSV Ingestion
                </h2>
                <p className="text-xs text-muted mt-1 leading-relaxed">
                  How to find, filter, and claim high-demand software topics or import client-provided keyword datasets.
                </p>
              </div>

              {/* Labeled Card */}
              <div className="p-4 rounded-xl bg-surface-200 border border-border space-y-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-mono font-bold text-foreground uppercase">Keyword Operations Walkthrough</span>
                  <span className="px-2 py-0.5 rounded bg-surface-100 text-muted font-mono text-[10px]">2,150 Embedded Items</span>
                </div>

                <div className="space-y-2 text-xs text-muted leading-relaxed">
                  <div className="p-2.5 rounded-lg bg-surface-100 border border-border space-y-1">
                    <strong className="text-foreground font-mono">Step 1: Filter or Ingest Keywords</strong>
                    <p className="text-[11px]">Use the volume filter dropdown (`&gt; 10,000 / mo`, `&gt; 5,000 / mo`) or click <strong>Import CSV</strong> to upload rows from Ahrefs, SEMrush, or Google Sheets.</p>
                  </div>

                  <div className="p-2.5 rounded-lg bg-surface-100 border border-border space-y-1">
                    <strong className="text-foreground font-mono">Step 2: Claim &amp; Route</strong>
                    <p className="text-[11px]">Click <strong>Conveyor</strong> to produce in the 5-step wizard, or <strong>Studio</strong> to enqueue directly into the asynchronous studio pipeline.</p>
                  </div>

                  <div className="p-2.5 rounded-lg bg-surface-100 border border-border space-y-1">
                    <strong className="text-foreground font-mono">Step 3: Bulk Actions</strong>
                    <p className="text-[11px]">Select multiple checkboxes to assign channels in bulk, mark topics as completed, or export custom CSV slices.</p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* 3. CONVEYOR */}
          {activeSection === 'conveyor' && (
            <div className="pro-panel p-6 rounded-2xl border border-border space-y-5 animate-fadeIn">
              <div>
                <h2 className="text-sm font-bold font-display text-foreground uppercase tracking-wide">
                  3. Creator Conveyor (5-Step Rapid Wizard)
                </h2>
                <p className="text-xs text-muted mt-1 leading-relaxed">
                  The primary conveyor workflow for recording single software walkthroughs in under 3 minutes.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                <div className="p-3.5 rounded-xl bg-surface-200 border border-border space-y-1.5">
                  <span className="px-2 py-0.5 rounded bg-surface-100 text-foreground font-mono text-[10px] font-bold">Step 1</span>
                  <h4 className="font-bold text-foreground">Topic &amp; Channel</h4>
                  <p className="text-muted text-[11px]">Select your channel profile and topic. Auto-suggest queries will pop up to optimize click-through.</p>
                </div>

                <div className="p-3.5 rounded-xl bg-surface-200 border border-border space-y-1.5">
                  <span className="px-2 py-0.5 rounded bg-surface-100 text-foreground font-mono text-[10px] font-bold">Step 2</span>
                  <h4 className="font-bold text-foreground">AI Scriptwriting</h4>
                  <p className="text-muted text-[11px]">Choose archetype (Standard, 60s Short, Deep Dive, Troubleshoot). Script is generated with natural `...` pause markers.</p>
                </div>

                <div className="p-3.5 rounded-xl bg-surface-200 border border-border space-y-1.5">
                  <span className="px-2 py-0.5 rounded bg-surface-100 text-foreground font-mono text-[10px] font-bold">Step 3</span>
                  <h4 className="font-bold text-foreground">Voiceover Synthesis</h4>
                  <p className="text-muted text-[11px]">Listen to neural TTS audio, adjust playback speed, or edit text in-place with instant 1-click re-generation.</p>
                </div>

                <div className="p-3.5 rounded-xl bg-surface-200 border border-border space-y-1.5">
                  <span className="px-2 py-0.5 rounded bg-surface-100 text-foreground font-mono text-[10px] font-bold">Step 4</span>
                  <h4 className="font-bold text-foreground">Screen Take Ingest</h4>
                  <p className="text-muted text-[11px]">Launch floating Teleprompter modal, record the on-screen steps, and drop the `.mp4` file for automatic splicing.</p>
                </div>
              </div>
            </div>
          )}

          {/* 4. STUDIO */}
          {activeSection === 'studio' && (
            <div className="pro-panel p-6 rounded-2xl border border-border space-y-5 animate-fadeIn">
              <div>
                <h2 className="text-sm font-bold font-display text-foreground uppercase tracking-wide">
                  4. Standalone Studio Pipeline Workstation
                </h2>
                <p className="text-xs text-muted mt-1 leading-relaxed">
                  The high-throughput pipeline designed for asynchronous queue processing and take ingest.
                </p>
              </div>

              <div className="p-4 rounded-xl bg-surface-200 border border-border space-y-3">
                <div className="text-xs font-mono font-bold text-foreground uppercase">Key Pipeline Controls</div>

                <div className="space-y-2 text-xs text-muted leading-relaxed">
                  <div className="p-2.5 rounded-lg bg-surface-100 border border-border">
                    <strong className="text-foreground font-mono">Speed Presets (1.0x – 1.6x):</strong> Choose the recording speed multiplier. The card will compute the exact capture framerate (`30 / Speed` fps).
                  </div>
                  <div className="p-2.5 rounded-lg bg-surface-100 border border-border">
                    <strong className="text-foreground font-mono">Stage Retries:</strong> Click <strong>Re-Script</strong>, <strong>Synthesize Audio</strong>, or <strong>Re-Splice</strong> if takes need regeneration.
                  </div>
                  <div className="p-2.5 rounded-lg bg-surface-100 border border-border">
                    <strong className="text-foreground font-mono">Video Take Preview:</strong> Expand any card to inspect the uploaded video take before final render.
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* 5. THUMBNAILS */}
          {activeSection === 'thumbnails' && (
            <div className="pro-panel p-6 rounded-2xl border border-border space-y-5 animate-fadeIn">
              <div>
                <h2 className="text-sm font-bold font-display text-foreground uppercase tracking-wide">
                  5. Thumbnail Studio &amp; 10-Language ZIP Pack
                </h2>
                <p className="text-xs text-muted mt-1 leading-relaxed">
                  Custom brand asset references, typography formatting, and batch multilingual exports.
                </p>
              </div>

              <div className="space-y-3 text-xs text-muted leading-relaxed">
                <div className="p-3.5 rounded-xl bg-surface-200 border border-border space-y-1.5">
                  <h4 className="font-bold text-foreground">Custom Brand Reference Uploads</h4>
                  <p>Upload your own persona face cutouts (`.png`), channel logos, and background templates under the <strong>CUSTOM</strong> tab.</p>
                </div>

                <div className="p-3.5 rounded-xl bg-surface-200 border border-border space-y-1.5">
                  <h4 className="font-bold text-foreground">Channel Presets (Bookmark Icon)</h4>
                  <p>Save your active font family, colors, stroke width, and aspect ratio as default template for the channel with 1 click.</p>
                </div>

                <div className="p-3.5 rounded-xl bg-surface-200 border border-border space-y-1.5">
                  <h4 className="font-bold text-foreground">10-Language Batch Export</h4>
                  <p>Click <strong>10-Lang ZIP</strong> to translate top and bottom text into German, Spanish, French, Italian, Portuguese, Dutch, Japanese, Korean, and Swedish in a structured ZIP pack.</p>
                </div>
              </div>
            </div>
          )}

          {/* 6. DRIVE */}
          {activeSection === 'drive' && (
            <div className="pro-panel p-6 rounded-2xl border border-border space-y-5 animate-fadeIn">
              <div>
                <h2 className="text-sm font-bold font-display text-foreground uppercase tracking-wide">
                  6. Google Drive Cloud Delivery Configuration
                </h2>
                <p className="text-xs text-muted mt-1 leading-relaxed">
                  Setting up automatic folder structures and delivery rules in Settings.
                </p>
              </div>

              <div className="p-4 rounded-xl bg-surface-200 border border-border space-y-3">
                <div className="text-xs font-mono font-bold text-foreground uppercase">Supported Folder Tokens</div>
                <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                  <div className="p-2 rounded bg-surface-100 border border-border"><code>{`{channel}`}</code> ➔ Channel Name</div>
                  <div className="p-2 rounded bg-surface-100 border border-border"><code>{`{year}`}</code> ➔ 2026</div>
                  <div className="p-2 rounded bg-surface-100 border border-border"><code>{`{month}`}</code> ➔ 08</div>
                  <div className="p-2 rounded bg-surface-100 border border-border"><code>{`{topic_slug}`}</code> ➔ clean_topic_slug</div>
                </div>
              </div>
            </div>
          )}

          {/* 7. ACCOUNTS */}
          {activeSection === 'accounts' && (
            <div className="pro-panel p-6 rounded-2xl border border-border space-y-5 animate-fadeIn">
              <div>
                <h2 className="text-sm font-bold font-display text-foreground uppercase tracking-wide">
                  7. Team &amp; Account Management
                </h2>
                <p className="text-xs text-muted mt-1 leading-relaxed">
                  Creating and managing operator accounts directly from the Settings page.
                </p>
              </div>

              <div className="p-4 rounded-xl bg-surface-200 border border-border space-y-3 text-xs text-muted leading-relaxed">
                <p>Navigate to <strong>Settings ➔ Team &amp; Account Management</strong> to add or edit accounts with three distinct permission levels:</p>
                
                <div className="grid grid-cols-3 gap-2 text-center pt-1 font-mono">
                  <div className="p-2.5 rounded bg-surface-100 border border-purple-500/30 text-purple-400">
                    <strong>ADMIN</strong>
                    <p className="text-[10px] text-muted mt-0.5">Full System Access</p>
                  </div>
                  <div className="p-2.5 rounded bg-surface-100 border border-blue-500/30 text-blue-400">
                    <strong>MANAGER</strong>
                    <p className="text-[10px] text-muted mt-0.5">Production Lead</p>
                  </div>
                  <div className="p-2.5 rounded bg-surface-100 border border-emerald-500/30 text-emerald-400">
                    <strong>VA</strong>
                    <p className="text-[10px] text-muted mt-0.5">Recording Operator</p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* 8. LOCALIZATION */}
          {activeSection === 'localization' && (
            <div className="pro-panel p-6 rounded-2xl border border-border space-y-5 animate-fadeIn">
              <div>
                <h2 className="text-sm font-bold font-display text-foreground uppercase tracking-wide">
                  8. Multi-Language Localization Factory
                </h2>
                <p className="text-xs text-muted mt-1 leading-relaxed">
                  Translating scripts and generating speech voiceovers in 10 languages.
                </p>
              </div>

              <div className="p-4 rounded-xl bg-surface-200 border border-border space-y-3 text-xs text-muted leading-relaxed">
                <p>Click the <strong>Translate</strong> button in the top navigation bar to open the batch localization factory. Select your target languages to automatically translate narration scripts, synthesize `.wav` audio files, and generate localized thumbnail titles.</p>
              </div>
            </div>
          )}

          {/* 9. SHORTCUTS */}
          {activeSection === 'shortcuts' && (
            <div className="pro-panel p-6 rounded-2xl border border-border space-y-5 animate-fadeIn">
              <div>
                <h2 className="text-sm font-bold font-display text-foreground uppercase tracking-wide">
                  9. Keyboard Shortcuts &amp; Pro-Tips
                </h2>
                <p className="text-xs text-muted mt-1 leading-relaxed">
                  Speed up recording sessions with teleprompter and editing hotkeys.
                </p>
              </div>

              <div className="p-4 rounded-xl bg-surface-200 border border-border space-y-3">
                <div className="text-xs font-mono font-bold text-foreground uppercase">Teleprompter Hotkeys</div>
                
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
                    <span className="text-foreground">Close Modal</span>
                    <kbd className="px-2 py-0.5 rounded bg-surface-200 font-mono text-[11px] border border-border font-bold">Esc</kbd>
                  </div>
                </div>
              </div>
            </div>
          )}

        </div>

      </div>

    </div>
  );
};

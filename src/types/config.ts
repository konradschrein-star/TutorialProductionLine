/**
 * Studio Configuration — the single, UI-editable control surface that lets the
 * OWNER/ADMIN adjust how the whole production line behaves WITHOUT touching code.
 *
 * Everything here is persisted (StorageService `studio_config`) and read live by
 * the pages. Adding a knob here + a control in the Admin → Studio Config page is
 * the canonical way to make a previously-hardcoded behavior adjustable.
 */

export type CompetitionLevel = 'Low' | 'Medium' | 'High';
export type KeywordContentType = 'HOW_TO' | 'FULL_TUTORIAL' | 'LIST' | 'REVIEW';

/** A selectable target video length. */
export interface LengthPreset {
  id: string;
  label: string;
  minutes: number;
}

/** Defaults that drive keyword sourcing, filtering and screening. */
export interface KeywordConfig {
  /** Hide keywords below this monthly search volume by default. */
  minVolume: number;
  /** Highest competition to include by default. */
  maxCompetition: CompetitionLevel;
  /** Content types the operator wants to produce. */
  allowedContentTypes: KeywordContentType[];
  /** Exclude keywords whose estimated runtime exceeds this (minutes). 0 = no cap. */
  lengthCapMinutes: number;
  /** Run AI screening automatically when keywords are imported/generated. */
  autoScreen: boolean;
  /** Weighting for the opportunity score (0..1 each, normalized at runtime). */
  scoreWeights: {
    volume: number;
    competition: number;
    channelFit: number;
    freshness: number;
    lengthFit: number;
  };
}

/** How much of each content type the operator wants in the mix (percentages). */
export interface ContentTypeMix {
  HOW_TO: number;
  FULL_TUTORIAL: number;
  LIST: number;
  REVIEW: number;
}

export interface StudioConfig {
  /** Schema version for forward migrations. */
  version: number;

  // ---- White-label / branding ------------------------------------------------
  productName: string;
  brandAccent: string; // hex, drives the accent token

  // ---- Access control (single-tenant workstation lock) -----------------------
  /**
   * Optional PIN that gates SWITCHING INTO an admin/manager account on this
   * shared workstation. Empty = no lock (default). This is a workstation
   * deterrent, not a security boundary — it is stored locally in plaintext.
   */
  adminPin: string;

  // ---- Production defaults ----------------------------------------------------
  defaultTargetMinutes: number;
  lengthPresets: LengthPreset[];
  defaultSpeed: number;
  speedPresets: number[];
  captureFps: number;
  contentTypeMix: ContentTypeMix;
  /** Topic / niche focus tags used to bias sourcing + AI angle. */
  focusTopics: string[];
  /** Software focus used to bias sourcing. */
  focusSoftware: string[];

  // ---- Keyword engine ---------------------------------------------------------
  keyword: KeywordConfig;

  // ---- Localization -----------------------------------------------------------
  /** Language codes translated in "translate everything" batches. */
  standardLanguages: string[];

  // ---- VA production targets (global defaults; per-VA overrides live in va_targets) ----
  defaultDailyTarget: number;
  defaultWeeklyTarget: number;
}

/** A saved, named keyword-filter combination the operator can re-apply in one click. */
export interface FilterPreset {
  id: string;
  name: string;
  filters: {
    search?: string;
    software?: string;
    channel?: string;
    volume?: string;
    competition?: string;
    contentType?: string;
    status?: string;
    verdict?: string;
    sortBy?: string;
  };
  createdAt: string;
}

/** Per-VA production target override. */
export interface VATarget {
  userId: string;
  dailyTarget: number;
  weeklyTarget: number;
}

export const DEFAULT_STUDIO_CONFIG: StudioConfig = {
  version: 1,

  productName: 'Tutorial Studio',
  brandAccent: '#6366f1',
  adminPin: '',

  defaultTargetMinutes: 3,
  lengthPresets: [
    { id: 'short', label: 'Short (90s)', minutes: 1.5 },
    { id: 'standard', label: 'Standard (3 min)', minutes: 3 },
    { id: 'deep', label: 'Deep dive (5 min)', minutes: 5 },
    { id: 'full', label: 'Full walkthrough (8 min)', minutes: 8 },
  ],
  defaultSpeed: 1.15,
  speedPresets: [1.0, 1.15, 1.25, 1.4],
  captureFps: 30,
  contentTypeMix: { HOW_TO: 60, FULL_TUTORIAL: 20, LIST: 10, REVIEW: 10 },
  focusTopics: [],
  focusSoftware: [],

  keyword: {
    minVolume: 0,
    maxCompetition: 'High',
    allowedContentTypes: ['HOW_TO', 'FULL_TUTORIAL', 'LIST', 'REVIEW'],
    lengthCapMinutes: 0,
    autoScreen: false,
    scoreWeights: {
      volume: 0.35,
      competition: 0.3,
      channelFit: 0.15,
      freshness: 0.1,
      lengthFit: 0.1,
    },
  },

  standardLanguages: ['de', 'fr', 'es', 'it', 'pt'],

  defaultDailyTarget: 6,
  defaultWeeklyTarget: 30,
};

export type ChannelId = string;

export interface Channel {
  id: string;
  name: string;
  niche: string;
  description: string;
  badgeColor: string;
  avatarUrl?: string;
  defaultVoiceId: string;
  targetCategory: string;
  subscribers?: string;
  driveFolder?: string; // Destination folder in Google Drive
  customPromptRules?: string; // Custom tone/prompt instructions for this channel
  thumbnailStyle?: {
    fontFamily?: string;
    fontSize?: number;
    color?: string;
    strokeColor?: string;
    badgeColor?: string;
  };
}

export interface VAUser {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'manager' | 'va' | 'viewer';
  assignedChannels: string[];
  assignedSoftwares?: string[];
}

export interface KeywordItem {
  id: string;
  keyword: string;
  software: string;
  volume: number;
  competition: 'Low' | 'Medium' | 'High';
  screenVerdict: 'APPROVE' | 'REVIEW' | 'REJECT';
  contentType: 'HOW_TO' | 'FULL_TUTORIAL' | 'LIST' | 'REVIEW';
  targetChannelId?: string;
  status: 'NEW' | 'CLAIMED' | 'IN_PRODUCTION' | 'COMPLETED' | 'REJECTED';
  claimedBy?: string;
  assignedTo?: string; // Assigned VA user id or email
  assignedToName?: string; // Human-readable assigned VA name
  dateAdded: string;
  estMinutes?: number;
  /**
   * Which pool this keyword belongs to:
   * - 'starter': the bundled 2,150-keyword curated starter list
   * - 'own': keywords the operator imported, scraped, or added themselves
   * Missing value is treated as 'starter' for backward compatibility.
   */
  source?: 'starter' | 'own';
}

export interface VoiceOption {
  id: string;
  name: string;
  provider: 'fish-audio' | 'elevenlabs' | 'openai';
  gender: 'male' | 'female';
  accent?: string;
  description: string;
  sampleUrl?: string;
}

export interface VideoCreatorState {
  step: number;
  highestStep: number;
  topic: string;
  keywordId?: string;
  targetChannel: string;
  script: string;
  selectedVoice: string;
  voiceSpeed: number;
  audioBlob: Blob | null;
  audioUrl: string | null;
  videoFile: File | null;
  videoUrl: string | null;
  videoDuration: number;
  thumbnailBlob: Blob | null;
  thumbnailUrl: string | null;
  title: string;
  description: string;
  tags: string;
  scheduledDate?: string;
  isProcessing: boolean;
  statusMessage: string;
}

export interface CustomThumbnailAsset {
  id: string;
  name: string;
  category: 'PERSONAS' | 'LOGOS' | 'SYMBOLS' | 'BGS' | 'CUSTOM';
  url: string;
  createdAt: string;
}

export interface ThumbnailElement {
  id: string;
  type: 'TEXT' | 'PERSON' | 'LOGO' | 'SYMBOL' | 'BACKGROUND' | 'UPLOAD';
  url?: string;
  text?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  rotation?: number;
  opacity?: number;
  fontFamily?: string;
  fontSize?: number;
  color?: string;
  strokeColor?: string;
  strokeWidth?: number;
  letterSpacing?: number;
  lineHeight?: number;
  fontWeight?: string;
  fontStyle?: string;
  lang?: string;
  bgColor?: string;
  borderRadius?: string;
  padding?: string;
}

export interface ThumbnailBrief {
  software_name: string;
  thumbnail_text_line1: string;
  thumbnail_text_line2: string;
  purpose_keyword: string;
  logo_search_term: string;
  translations?: Record<string, { top: string; bottom: string }>;
}

export interface UploadQueueItem {
  jobId: string;
  jobTitle: string;
  channelName: string;
  state: 'queued' | 'uploading' | 'paused' | 'finalizing' | 'done' | 'error';
  fileSize: number;
  uploadedBytes: number;
  bytesPerSecond: number;
  etaSeconds: number | null;
  error?: string;
  thumbnailUrl?: string;
  videoUrl?: string;
  createdAt: string;
}

export interface FinishedVideo {
  id: string;
  title: string;
  channel: string;
  status: 'Ready' | 'Queued for Stealth Upload' | 'Published' | 'Uploaded to Drive';
  thumbnailUrl: string;
  duration: string;
  views?: number;
  script: string;
  videoPath?: string;
  tags: string[];
  driveUrl?: string;
  drivePath?: string;
  createdAt: string;
  /**
   * Optional VA attribution. When the operator who produced the video is stamped
   * here (id preferred, name as fallback), per-VA capacity and target progress
   * become real. Absent on legacy records — metrics degrade to honest zeros.
   */
  producedByUserId?: string;
  producedByName?: string;
}

/**
 * Google Drive Integration Types
 */
export interface GoogleDriveConfig {
  enabled: boolean;
  connectionMode: 'service_account' | 'oauth' | 'api_key';
  serviceAccountJson?: string;
  apiKey?: string;
  clientId?: string;
  clientSecret?: string;
  rootFolderId?: string;
  folderStructureTemplate: string; // e.g. "{channel}/{year}_{month}/{topic_slug}/"
  fileNamingTemplate: string; // e.g. "{date}_{title}_{lang}.mp4"
  autoUploadOnRender: boolean;
  uploadThumbnail: boolean;
  uploadManifest: boolean;
  lastConnectedAt?: string;
  isConnected: boolean;
}

export interface DriveDeliveryItem {
  id: string;
  jobId: string;
  title: string;
  channel: string;
  fileName: string;
  drivePath: string;
  fileSize: number;
  uploadedAt: string;
  status: 'DELIVERING' | 'IN_GOOGLE_DRIVE' | 'FAILED';
  viewUrl?: string;
}

/**
 * Standalone Studio Pipeline Job Models
 */
export type StudioJobStatus =
  | 'QUEUED'
  | 'GENERATING_SCRIPT'
  | 'GENERATING_AUDIO'
  | 'READY_TO_RECORD'
  | 'AWAITING_UPLOAD'
  | 'SPLICING'
  | 'COMPLETED'
  | 'FAILED_SCRIPT'
  | 'FAILED_AUDIO'
  | 'FAILED_SPLICE'
  | 'CANCELLED';

export interface StudioJob {
  id: string;
  title: string;
  topic: string;
  channelId: string;
  channelName: string;
  status: StudioJobStatus;
  script: string;
  voiceId: string;
  voiceSpeed: number;
  audioUrl?: string;
  recordingUrl?: string;
  videoUrl?: string;
  thumbnailUrl?: string;
  durationSeconds?: number;
  deliveredToDrive: boolean;
  drivePath?: string;
  driveUrl?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
  /** Optional VA attribution — see FinishedVideo.producedByUserId. */
  producedByUserId?: string;
  producedByName?: string;
}

/**
 * Production Metrics & Reporting
 */
export interface VAProductivityStat {
  userId: string;
  name: string;
  role: 'admin' | 'manager' | 'va' | 'viewer';
  email: string;
  assignedChannels: string[];
  /** All-time COMPLETED keyword claims attributed to this VA. */
  completedCount: number;
  /** Active claims (CLAIMED / IN_PRODUCTION). */
  inProductionCount: number;
  /** Sum of estMinutes over completed claims (real estimate, 0 when unknown). */
  watchTimeMinutes: number;
  /** Back-compat field: now mirrors weeklyProgressPct (0 when no data/target). */
  efficiencyRating: number;

  // ---- additive: target tracking & capacity (all optional) ----
  /** Total keyword claims (any status) attributed to this VA. */
  claimedTotal?: number;
  dailyTarget?: number;
  weeklyTarget?: number;
  /** Attributed produced videos dated to today. */
  completedToday?: number;
  /** Attributed produced videos in the rolling 7-day window. */
  completedThisWeek?: number;
  dailyProgressPct?: number;
  weeklyProgressPct?: number;
  /** Capacity: avg attributed videos per active (producing) day. */
  avgPerActiveDay?: number;
  /** Capacity: observed peak videos produced on a single day. */
  bestDayCount?: number;
  bestDayDate?: string;
  /** Distinct days on which this VA has attributed production. */
  activeDays?: number;
}

export interface ProductionMetrics {
  totalProduced: number;
  totalDurationMinutes: number;
  inProductionCount: number;
  queuedCount: number;
  deliveredToDriveCount: number;
  channelCounts: Record<string, number>;
  vaActivityCounts: Record<string, number>;
  vaProductivityList?: VAProductivityStat[];
  dailyVelocity: { date: string; count: number }[];

  // ---- additive: honest team-wide capacity & recency (all optional) ----
  /** Number of days the dailyVelocity window spans (default 7). */
  windowDays?: number;
  /** Team's single best production day observed across all history. */
  teamBestDay?: { date: string; count: number };
  /** Avg produced per active (producing) day across all history. */
  teamAvgPerActiveDay?: number;
  /** Distinct days with any production across all history. */
  teamActiveDays?: number;
  /** All-time COMPLETED keyword claims across the whole team. */
  totalClaimedCompleted?: number;
  producedToday?: number;
  producedThisWeek?: number;
}

/**
 * Quick Setup / Onboarding State
 */
export interface OnboardingState {
  isCompleted: boolean;
  currentStep: number;
}

export type ChannelId = 'virtualfd' | 'skool' | 'blueprint' | 'custom';

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
}

export interface VAUser {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'manager' | 'va' | 'viewer';
  assignedChannels: string[];
}

export interface KeywordItem {
  id: string;
  keyword: string;
  software: string;
  volume: number;
  competition: 'Low' | 'Medium' | 'High';
  screenVerdict: 'APPROVE' | 'REVIEW' | 'REJECT';
  contentType: 'HOW_TO' | 'FULL_TUTORIAL' | 'LIST' | 'REVIEW';
  targetChannelId?: ChannelId;
  status: 'NEW' | 'CLAIMED' | 'IN_PRODUCTION' | 'COMPLETED' | 'REJECTED';
  claimedBy?: string;
  dateAdded: string;
  estMinutes?: number;
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
  status: 'Ready' | 'Queued for Stealth Upload' | 'Published';
  thumbnailUrl: string;
  duration: string;
  views?: number;
  script: string;
  videoPath?: string;
  tags: string[];
  createdAt: string;
}

import type { RemotionSubtitleConfig } from "@repo/db";

export interface SubtitleFont {
  id: string;
  name: string;
  file_name: string;
}

export interface RemotionControlProps {
  config: RemotionSubtitleConfig;
  onChange: (patch: Partial<RemotionSubtitleConfig>) => void;
  disabled?: boolean;
  fonts?: SubtitleFont[];
}

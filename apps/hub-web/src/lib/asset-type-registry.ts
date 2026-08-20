/**
 * Asset Type Registry
 *
 * Defines the asset types (drop zones) required for each content format.
 * Each format can have multiple asset types with validation rules.
 */

export interface AssetZoneDefinition {
  /** Unique identifier for this asset type */
  id: string;
  /** Display label for the drop zone */
  label: string;
  /** Accepted file extensions */
  accept: string[];
  /** Whether this asset is required for job creation */
  required: boolean;
  /** Icon name (Material Symbols) */
  icon: string;
  /** Help text shown in the drop zone */
  hint: string;
  /** Maximum number of files (null = unlimited) */
  maxFiles: number | null;
  /** Maximum file size in bytes (null = no limit) */
  maxSize: number | null;
}

export interface FormatAssetConfig {
  /** List of asset zones for this format */
  zones: AssetZoneDefinition[];
  /** Whether this format supports ZIP upload */
  supportsZip: boolean;
  /** Special handling notes */
  notes?: string;
}

const DEFAULT_VIDEO_SIZE = 5 * 1024 * 1024 * 1024; // 5GB
const DEFAULT_SCRIPT_SIZE = 10 * 1024 * 1024; // 10MB
const DEFAULT_IMAGE_SIZE = 50 * 1024 * 1024; // 50MB

/**
 * Asset type registry for all formats
 */
export const ASSET_TYPE_REGISTRY: Record<string, FormatAssetConfig> = {
  EXPLAINER: {
    supportsZip: true,
    zones: [
      {
        id: "script",
        label: "Script (Optional)",
        accept: [".txt", ".md"],
        required: false,
        icon: "description",
        hint: "Drop script or leave empty for AI generation",
        maxFiles: 1,
        maxSize: DEFAULT_SCRIPT_SIZE,
      },
      {
        id: "visual-assets",
        label: "Visual Assets (Optional)",
        accept: [".jpg", ".jpeg", ".png", ".webp", ".mp4", ".mov"],
        required: false,
        icon: "collections",
        hint: "Drop images or video clips for visuals",
        maxFiles: null,
        maxSize: DEFAULT_IMAGE_SIZE,
      },
      {
        id: "research",
        label: "Research Material (Optional)",
        accept: [".txt", ".md", ".json", ".pdf"],
        required: false,
        icon: "science",
        hint: "Drop Perplexity research or reference documents",
        maxFiles: null,
        maxSize: DEFAULT_SCRIPT_SIZE,
      },
      {
        id: "heygen-footage",
        label: "HeyGen Footage (Optional)",
        accept: [".mp4", ".mov"],
        required: false,
        icon: "smart_display",
        hint: "Drop HeyGen avatar footage from VA operations",
        maxFiles: null,
        maxSize: DEFAULT_VIDEO_SIZE,
      },
    ],
  },

  DOCUMENTARY: {
    supportsZip: true,
    zones: [
      {
        id: "script",
        label: "Narration Script (Optional)",
        accept: [".txt", ".md"],
        required: false,
        icon: "description",
        hint: "Drop script or leave empty for AI generation",
        maxFiles: 1,
        maxSize: DEFAULT_SCRIPT_SIZE,
      },
      {
        id: "footage",
        label: "Historical Footage (Optional)",
        accept: [".mp4", ".mov", ".jpg", ".jpeg", ".png", ".webp"],
        required: false,
        icon: "movie",
        hint: "Drop historical images or video clips",
        maxFiles: null,
        maxSize: DEFAULT_VIDEO_SIZE,
      },
      {
        id: "research",
        label: "Research Material (Optional)",
        accept: [".txt", ".md", ".json", ".pdf"],
        required: false,
        icon: "science",
        hint: "Drop Perplexity research or reference documents",
        maxFiles: null,
        maxSize: DEFAULT_SCRIPT_SIZE,
      },
      {
        id: "heygen-footage",
        label: "HeyGen Footage (Optional)",
        accept: [".mp4", ".mov"],
        required: false,
        icon: "smart_display",
        hint: "Drop HeyGen avatar footage from VA operations",
        maxFiles: null,
        maxSize: DEFAULT_VIDEO_SIZE,
      },
    ],
  },

  TECH_COMPARISON: {
    supportsZip: true,
    zones: [
      {
        id: "script",
        label: "Comparison Script (Optional)",
        accept: [".txt", ".md"],
        required: false,
        icon: "description",
        hint: "AI will research products and generate script",
        maxFiles: 1,
        maxSize: DEFAULT_SCRIPT_SIZE,
      },
      {
        id: "product-images",
        label: "Product Images (Optional)",
        accept: [".jpg", ".jpeg", ".png", ".webp"],
        required: false,
        icon: "image",
        hint: "Drop product screenshots or promotional images",
        maxFiles: null,
        maxSize: DEFAULT_IMAGE_SIZE,
      },
      {
        id: "heygen-clip",
        label: "HeyGen Clip (Optional)",
        accept: [".mp4", ".mov"],
        required: false,
        icon: "videocam",
        hint: "Drop optional presenter video",
        maxFiles: 1,
        maxSize: DEFAULT_VIDEO_SIZE,
      },
      {
        id: "research",
        label: "Research Material (Optional)",
        accept: [".txt", ".md", ".json", ".pdf"],
        required: false,
        icon: "science",
        hint: "Drop Perplexity research or reference documents",
        maxFiles: null,
        maxSize: DEFAULT_SCRIPT_SIZE,
      },
    ],
  },

  VIDEO_ESSAY: {
    supportsZip: true,
    zones: [
      {
        id: "essay-script",
        label: "Essay Script",
        accept: [".txt", ".md"],
        required: true,
        icon: "description",
        hint: "Drop essay content — script-driven format",
        maxFiles: 1,
        maxSize: DEFAULT_SCRIPT_SIZE,
      },
      {
        id: "visual-assets",
        label: "Visual Assets (Optional)",
        accept: [".jpg", ".jpeg", ".png", ".webp", ".mp4", ".mov"],
        required: false,
        icon: "collections",
        hint: "Drop supporting visuals for the essay",
        maxFiles: null,
        maxSize: DEFAULT_IMAGE_SIZE,
      },
    ],
  },

  CASUALLY_EXPLAINED: {
    supportsZip: true,
    zones: [
      {
        id: "avatar-video",
        label: "Avatar Video",
        accept: [".mp4", ".mov", ".avi", ".mkv"],
        required: true,
        icon: "videocam",
        hint: "Drop avatar video for illustration sync",
        maxFiles: 1,
        maxSize: DEFAULT_VIDEO_SIZE,
      },
      {
        id: "script",
        label: "Finished Script",
        accept: [".txt", ".md", ".srt"],
        required: true,
        icon: "description",
        hint: "Drop completed script with timing",
        maxFiles: 1,
        maxSize: DEFAULT_SCRIPT_SIZE,
      },
      {
        id: "style-reference",
        label: "Style Reference (Optional)",
        accept: [".jpg", ".jpeg", ".png"],
        required: false,
        icon: "palette",
        hint: "Drop style reference images for illustration art",
        maxFiles: 5,
        maxSize: DEFAULT_IMAGE_SIZE,
      },
    ],
    notes: "Style assets are selected via the Style Asset Picker, not uploaded",
  },
};

/**
 * Get asset configuration for a format
 */
export function getAssetConfig(format: string): FormatAssetConfig {
  return (
    ASSET_TYPE_REGISTRY[format] ?? {
      supportsZip: true,
      zones: [],
    }
  );
}

/**
 * Get required asset zone IDs for a format
 */
export function getRequiredAssetIds(format: string): string[] {
  const config = getAssetConfig(format);
  return config.zones.filter((z) => z.required).map((z) => z.id);
}

/**
 * Validate if a file is accepted by a specific zone
 */
export function validateFileForZone(
  file: File,
  zone: AssetZoneDefinition,
): { valid: boolean; error?: string } {
  // Check extension
  const ext = "." + (file.name.split(".").pop() ?? "").toLowerCase();
  if (!zone.accept.includes(ext)) {
    return {
      valid: false,
      error: `Invalid file type. Accepted: ${zone.accept.join(", ")}`,
    };
  }

  // Check size
  if (zone.maxSize !== null && file.size > zone.maxSize) {
    const maxMB = (zone.maxSize / 1024 / 1024).toFixed(0);
    return {
      valid: false,
      error: `File too large. Max size: ${maxMB}MB`,
    };
  }

  return { valid: true };
}

/**
 * Get human-readable size limit
 */
export function formatSizeLimit(bytes: number | null): string {
  if (bytes === null) return "No limit";
  const mb = bytes / 1024 / 1024;
  if (mb >= 1024) {
    return `${(mb / 1024).toFixed(1)}GB`;
  }
  return `${mb.toFixed(0)}MB`;
}

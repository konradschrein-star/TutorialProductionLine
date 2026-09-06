export const UPLOADER_CHANNEL_KEY_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/;

/** Empty form values deliberately remove the mapping instead of guessing one. */
export function normalizeUploaderChannelKey(
  value: string | null | undefined,
): string | null {
  const normalized = value?.trim() ?? "";
  if (normalized === "") return null;
  if (!UPLOADER_CHANNEL_KEY_PATTERN.test(normalized)) {
    throw new Error(
      "Uploader channel key must start with a lowercase letter and contain only lowercase letters, numbers, underscores, or hyphens (max 64 characters)",
    );
  }
  return normalized;
}

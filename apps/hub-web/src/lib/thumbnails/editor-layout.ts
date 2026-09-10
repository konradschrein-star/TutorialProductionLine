/** Reserve a real inset for the stroke/shadow; shrinking text alone cannot stop edge clipping. */
export function thumbnailTextPadding(strokeWidth = 5, configured = "0", scale = 1): string {
  const safeInset = Math.ceil(strokeWidth / 2) + 5;
  const values = configured.trim().split(/\s+/).map((value) => Number.parseFloat(value) || 0);
  return (values.length ? values : [0]).map((value) => `${Math.max(value, safeInset) * scale}px`).join(" ");
}

export function nextLayerId(): string { return `layer-${crypto.randomUUID()}`; }

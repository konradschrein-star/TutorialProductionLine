/** Find a readable fit using actual font metrics, not character counts. */
export function fitThumbnailText(box: { width: number; height: number; preferredSize: number; minimumSize?: number }, measure: (size: number) => { width: number; height: number }): number {
  const minimum = box.minimumSize ?? 24;
  const fits = (size: number) => {
    const measured = measure(size);
    return Number.isFinite(measured.width) && Number.isFinite(measured.height) && measured.width <= box.width && measured.height <= box.height;
  };
  if (box.width <= 0 || box.height <= 0 || !fits(minimum)) throw new Error("Headline does not fit at a readable size. Shorten the text or enlarge its box before exporting.");
  let low = minimum;
  let high = Math.max(minimum, box.preferredSize);
  for (let step = 0; step < 16; step++) {
    const middle = (low + high) / 2;
    if (fits(middle)) low = middle; else high = middle;
  }
  return Math.floor(low * 100) / 100;
}

/** A short headline may grow until it fills its safe hitbox. */
export function automaticHeadlineCeiling(width: number, height: number): number {
  return Math.max(120, Math.min(220, Math.max(height * 1.7, width * .38)));
}

/** Keep copy legible at 320px; try a balanced word break before shrinking. */
export function fitWrappedThumbnailText(text: string, box: { width: number; height: number; preferredSize: number; minimumSize: number }, measure: (text: string, size: number) => { width: number; height: number }): { text: string; fontSize: number } {
  const words = text.trim().split(/\s+/);
  const candidates = [words.join(" "), ...words.slice(1).map((_, index) => `${words.slice(0, index + 1).join(" ")}\n${words.slice(index + 1).join(" ")}`)];
  let best: { text: string; fontSize: number; balance: number } | undefined;
  for (const candidate of candidates) {
    const lines = candidate.split("\n");
    try {
      const fontSize = fitThumbnailText(box, size => {
        const metrics = lines.map(line => measure(line, size));
        return { width: Math.max(...metrics.map(item => item.width)), height: Math.max(...metrics.map(item => item.height), size * 1.05) * lines.length };
      });
      const widths = lines.map(line => measure(line, fontSize).width);
      const balance = Math.max(...widths) - Math.min(...widths);
      if (!best || fontSize > best.fontSize || (fontSize === best.fontSize && balance < best.balance)) best = { text: candidate, fontSize, balance };
    } catch { /* Try another word break; never silently shrink below the floor. */ }
  }
  if (!best) throw new Error("Headline would be too small at 320×180. Shorten the copy or enlarge its text box; save a draft to keep working.");
  return { text: best.text, fontSize: best.fontSize };
}

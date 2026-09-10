/** Export only after the actual assets are decoded; fixed sleeps are not readiness. */
export async function prepareThumbnailExport(root: HTMLElement, timeoutMs = 10_000): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cancelled = false;
  const ready = async () => {
    if (root.querySelector("[data-missing-asset]")) throw new Error("A thumbnail asset is missing. Choose a logo/image or remove its layer before approval. You can still save this as a draft.");
    await root.ownerDocument.fonts.ready;
    while (!cancelled && root.querySelector('[data-artwork-pending="true"]')) {
      await new Promise<void>(resolve => root.ownerDocument.defaultView!.requestAnimationFrame(() => resolve()));
    }
    await Promise.all(Array.from(root.querySelectorAll("img")).map(async (image) => {
      try { await image.decode(); } catch {
        throw new Error("A thumbnail image could not load. Replace the missing logo, character or background and retry.");
      }
      if (!image.naturalWidth || !image.naturalHeight) throw new Error("A thumbnail image is empty.");
    }));
    // A committed React layout is measured synchronously, without a timer.
    if (!root.isConnected || root.clientWidth === 0 || root.clientHeight === 0) {
      throw new Error("The thumbnail canvas is not visible. Reopen the editor and retry.");
    }
  };
  try {
    await Promise.race([
      ready(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Thumbnail assets are still loading. Check your connection and retry.")), timeoutMs);
      }),
    ]);
  } finally { cancelled = true; if (timer) clearTimeout(timer); }
}

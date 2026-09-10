import type { ThumbnailLayout } from "./layout-document";
type Layer = ThumbnailLayout["elements"][number];

/** Geometry/artwork are shared; translated headlines and assigned hosts are not. */
export function inheritThumbnailLayout(shared: Layer[], localized: Layer[]): Layer[] {
  return shared.map((layer) => {
    const local = localized.find((candidate) => candidate.id === layer.id);
    if (layer.type === "TEXT") return { ...layer, text: local?.text ?? "" };
    if (layer.id === "person-1") return { ...layer, url: local?.url ?? layer.url };
    return { ...layer };
  });
}

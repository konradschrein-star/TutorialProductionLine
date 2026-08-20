import { V2Card } from "../../../_components";
import { SceneGallery, type SceneImage } from "@/components/jobs/scene-gallery";
import type { JobMediaScene } from "@/lib/job-media-view";

interface ScenesTabProps {
  scenes: JobMediaScene[];
  jobId: string;
}

export function ScenesTab({ scenes, jobId }: ScenesTabProps) {
  const formattedImages: SceneImage[] = scenes.map((s, i) => ({
    sceneIndex: i,
    imageIndex: 0,
    url: s.url,
    label: s.label,
    prompt: s.caption ?? null,
  }));

  if (formattedImages.length === 0) {
    return (
      <V2Card>
        <div style={{ textAlign: "center", padding: "40px 20px" }}>
          <p style={{ fontSize: 13, color: "var(--v2-text-2)" }}>
            No scene images generated yet.
          </p>
        </div>
      </V2Card>
    );
  }

  return (
    <div>
      <SceneGallery images={formattedImages} jobId={jobId} />
    </div>
  );
}

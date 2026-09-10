/** Project only recorded numeric QA evidence; never expose raw probe errors or paths. */
export function currentReviewQaDetail(detail: unknown, expected: { completedAt: string | null; finalPath: string | null; recordingPath: string | null; audioPath: string | null; recordedAt: string | null; scriptDigest: string }) {
  const identity = detail && typeof detail === "object" && "identity" in detail ? detail.identity as Record<string, unknown> | null : null;
  if (!identity || identity.version !== "tutorial-output-qa/1" || !expected.completedAt || !expected.finalPath) return null;
  if (!(Object.keys(expected) as Array<keyof typeof expected>).every(key => identity[key] === expected[key])) return null;
  return detail;
}
export function reviewQaEvidence(detail: unknown) {
  const checks = detail && typeof detail === "object" && "checks" in detail && Array.isArray(detail.checks) ? detail.checks : [];
  return ([{ id: "loudness", label: "Audio loudness", field: "integrated_lufs", unit: "LUFS" }, { id: "black", label: "Longest black screen", field: "longest_black_seconds", unit: "s" }] as const).map(spec => {
    const check = checks.find((item: any) => item?.id === spec.id);
    const value = check?.[spec.field];
    const measured = typeof value === "number" && Number.isFinite(value) && check?.status !== "skipped";
    return { id: spec.id, label: spec.label, value: measured ? `${value.toFixed(1)} ${spec.unit}` : "Not measured", status: measured && ["pass", "warn", "fail"].includes(check?.status) ? check.status as "pass" | "warn" | "fail" : "unverified", target: spec.id === "loudness" && measured && typeof check?.target_lufs === "number" && Number.isFinite(check.target_lufs) ? `${check.target_lufs} LUFS target` : null };
  });
}

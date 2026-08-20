// Server-side only — imported from the Settings server component. Not marked
// with the `server-only` package because it is not a dependency of hub-web.
import { QUEUE_NAMES, getWorkerOptions } from "@repo/queue";

// NOTE: the Pipeline settings section was DELETED (§3.3 — render engine / QMS
// strictness are per-format, not platform-global). This queue-runtime logic is
// genuinely useful and is preserved for relocation into System Health's
// queue-health tab (see the plan handoff). The row type is defined locally now
// that pipeline-section is gone.
export interface QueueRuntimeRow {
  name: string;
  label: string;
  group: string;
  concurrency: number;
  explicit: boolean;
  lockMinutes: number;
}

/**
 * Build the queue inventory shown in the Pipeline section straight out of the
 * code that the workers actually boot with.
 *
 * The previous Settings page hard-coded a list of 7 queues with hand-typed
 * "defaults" that had drifted from reality. This reads `getWorkerOptions()`
 * for every lane in `QUEUE_NAMES`, so the numbers on screen are the numbers
 * the workers run with.
 */

const GROUP_RULES: Array<[RegExp, string]> = [
  [/^queue-(cf|clip-forge)/, "Clip Forge"],
  [/^queue-clip-/, "Clip Library"],
  [/^queue-image-/, "Image Library"],
  [/^queue-drama-/, "Drama"],
  [/^queue-reactor-/, "Reactor"],
  [/^queue-tutorial-/, "Tutorials"],
  [/^queue-bundestag-/, "Bundestag"],
  [/^queue-(thumbnail|stock-library-gen)/, "Media"],
  [/^queue-(video-stitch|tech-footage-collection)/, "Media"],
  [
    /^queue-(render-heavy|qms-validation|scene-analysis|asset-collection|ai-generation|ingest)/,
    "Core pipeline",
  ],
  [/^queue-(garbage-collection|dead-letter|auto-label)/, "Maintenance"],
];

function groupFor(name: string): string {
  for (const [re, group] of GROUP_RULES) {
    if (re.test(name)) return group;
  }
  return "Other";
}

function labelFor(name: string): string {
  return name
    .replace(/^queue-/, "")
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

const GROUP_ORDER = [
  "Core pipeline",
  "Media",
  "Tutorials",
  "Clip Forge",
  "Clip Library",
  "Image Library",
  "Drama",
  "Reactor",
  "Bundestag",
  "Maintenance",
  "Other",
];

export function buildQueueRuntimeRows(): QueueRuntimeRow[] {
  const rows = Object.values(QUEUE_NAMES).map((name): QueueRuntimeRow => {
    const opts = getWorkerOptions(name);
    return {
      name,
      label: labelFor(name),
      group: groupFor(name),
      // BullMQ's own default when a worker declares no concurrency is 1.
      concurrency: opts.concurrency ?? 1,
      explicit: opts.concurrency !== undefined,
      lockMinutes:
        Math.round(((opts.lockDuration ?? 60_000) / 60_000) * 10) / 10,
    };
  });

  return rows.sort((a, b) => {
    const ga = GROUP_ORDER.indexOf(a.group);
    const gb = GROUP_ORDER.indexOf(b.group);
    if (ga !== gb) return ga - gb;
    return a.label.localeCompare(b.label);
  });
}

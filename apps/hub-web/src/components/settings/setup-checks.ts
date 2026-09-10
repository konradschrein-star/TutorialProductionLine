export type SetupCheck = {
  id: string;
  label: string;
  ready: boolean;
  detail: string;
  href: string;
  optional?: boolean;
  probe?: boolean;
};

export function setupSummary(checks: SetupCheck[]) {
  const required = checks.filter((check) => !check.optional);
  return { configured: required.filter((check) => check.ready).length, total: required.length };
}

export function setupProbeTargets(checks: SetupCheck[]) {
  return ["db", "redis", ...checks.filter((check) => check.probe).map((check) => check.id)];
}

export function channelSetupCheck(count: number | null): SetupCheck {
  return {
    id: "channels", label: "Channels", ready: count !== null && count > 0,
    detail: count === null ? "Could not read channels. Retry or open Channels."
      : count === 0 ? "Add your first channel; there is no fixed network size."
        : `${count} configured; assign channel access in Team.`,
    href: "/channels",
  };
}

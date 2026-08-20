import { ClipForgeConsole } from "./_components/console";

/**
 * Clip Forge — single-page Palantir/IBM Plex operations console.
 *
 * All screens (S0–S12) are routed in-process via the nav rail. The shell,
 * command palette and data loading are wired up by `ClipForgeConsole`, which
 * polls `/api/v1/clip-forge/console` for real `cf_*` rows.
 */
export default function ClipForgePage() {
  return <ClipForgeConsole />;
}

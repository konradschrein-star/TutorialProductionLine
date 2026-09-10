import type { JWTPayload } from "@/lib/auth/jwt";
import { getWorkspaceNavigation } from "./workspace-navigation";

export function getCommandPages(session: JWTPayload) {
  return getWorkspaceNavigation(session);
}
export function paletteShortcut(event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "repeat">): "toggle" | "close" | null {
  if (event.key === "Escape") return "close";
  return !event.repeat && !event.altKey && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k" ? "toggle" : null;
}

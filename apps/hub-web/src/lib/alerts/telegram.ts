import "server-only";
import { db } from "@/lib/db";
import { getSecret } from "@repo/db";

/**
 * Telegram alert transport (§3.3 / T6).
 *
 * SEND-ONLY. Content Forge shares the existing @best_ai_os_bot token but must
 * NEVER poll (getUpdates/webhook) — sendMessage never conflicts, so it is safe
 * to share the token with AI-OS's long poller. Calls the Bot API DIRECTLY; it
 * does NOT route through AI-OS's notifications table (that is gated on
 * fleet_state — when Konrad runs /off, alerts would silently vanish, which is
 * precisely when you most want them).
 *
 * The bot TOKEN lives in the secrets area (TELEGRAM_BOT_TOKEN), never in
 * system_settings. If it is absent, sendAlert THROWS — no silent no-op.
 */

// Tripwire: if anyone ever adds getUpdates/webhook polling, this constant name
// makes the "send-only" contract lint-visible and greppable.
export const TELEGRAM_SEND_ONLY = true as const;

export type AlertSeverity = "info" | "warn" | "error";

export interface AlertInput {
  severity: AlertSeverity;
  category: string;
  title: string;
  detail?: string;
  url?: string;
  chatId?: string;
}

const SEV_ICON: Record<AlertSeverity, string> = {
  info: "ℹ️",
  warn: "⚠️",
  error: "🔴",
};

export async function sendAlert(input: AlertInput): Promise<void> {
  const token = await getSecret(db, "TELEGRAM_BOT_TOKEN"); // throws if unset
  const chatId = input.chatId ?? process.env["TELEGRAM_CHAT_ID"] ?? "";
  if (!chatId) {
    throw new Error(
      "[telegram] no chat id — set it in Settings → Alerts (or TELEGRAM_CHAT_ID).",
    );
  }

  const lines = [
    `🏭 CF ${SEV_ICON[input.severity]} *${escapeMd(input.title)}*`,
    `_${escapeMd(input.category)}_`,
  ];
  if (input.detail) lines.push("", escapeMd(input.detail));
  if (input.url) lines.push("", input.url);

  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: lines.join("\n"),
      parse_mode: "Markdown",
      disable_web_page_preview: true,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `[telegram] sendMessage failed ${res.status}: ${body.slice(0, 200)}`,
    );
  }
}

function escapeMd(s: string): string {
  // Minimal Markdown v1 escaping for the few chars that break parsing.
  return s.replace(/([_*`[])/g, "\\$1");
}

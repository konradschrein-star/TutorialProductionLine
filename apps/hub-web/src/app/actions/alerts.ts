"use server";

import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import { sendAlert } from "@/lib/alerts/telegram";

/**
 * Send a test Telegram alert. Proves the transport + token + chat id actually
 * work (nothing else does). Throws surface to the caller as an error string —
 * no optimistic "sent!".
 */
export async function sendTestAlert(
  chatId?: string,
): Promise<{ success: boolean; error?: string }> {
  const session = await getSession();
  if (!session || !hasPermission(session, "edit:settings")) {
    return { success: false, error: "Unauthorized" };
  }
  try {
    await sendAlert({
      severity: "info",
      category: "test",
      title: "Content Forge alert test",
      detail: "If you can read this, Telegram alerts are wired correctly.",
      chatId: chatId && chatId.trim().length > 0 ? chatId.trim() : undefined,
    });
    return { success: true };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : "Failed to send test alert",
    };
  }
}

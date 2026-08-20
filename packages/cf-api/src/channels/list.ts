import { eq } from "drizzle-orm";
import { channels } from "@repo/db";
import { CfApiError } from "../errors.js";
import type { CfRuntime } from "../runtime.js";

export async function listChannels(rt: CfRuntime) {
  return rt.db.select().from(channels);
}

export async function getChannel(rt: CfRuntime, id: string) {
  const [row] = await rt.db
    .select()
    .from(channels)
    .where(eq(channels.id, id))
    .limit(1);
  if (!row) throw new CfApiError("NOT_FOUND", `Channel ${id} not found`);
  return row;
}

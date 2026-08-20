import { timingSafeEqual } from "node:crypto";
import { getRedisClient } from "@/lib/redis";
import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth/session";

const KEY = "vm:clipboard";
const TTL = 7200; // 2 hours

/**
 * Auth model.
 *
 * `/api/vm-clip` is on the middleware API_ROUTES bypass list, so this file is
 * the only access control. It was previously fully public ("only innocuous
 * clipboard text") — but in practice this is the channel used to paste text
 * into the VM, the hub is internet-reachable, and an unauthenticated GET handed
 * the Redis clipboard to anyone who knew the URL (and an unauthenticated POST
 * let anyone overwrite it).
 *
 * It cannot simply require a session: the VM browser is a separate machine with
 * no `hub_session` cookie. So it accepts EITHER:
 *   - a valid hub session (the host-side writer), or
 *   - a shared secret `VM_CLIP_TOKEN`, passed as `?t=<token>` (so the VM can
 *     just open a URL) or an `X-VM-Clip-Token` header.
 *
 * If `VM_CLIP_TOKEN` is unset, only a session works — this fails closed.
 * OPERATIONAL NOTE: set VM_CLIP_TOKEN in the production env and use
 * `http://<host>:3000/api/vm-clip?t=<token>` from inside the VM.
 */
function tokenMatches(request: NextRequest): boolean {
  const expected = process.env.VM_CLIP_TOKEN;
  if (!expected) return false;
  const provided =
    request.nextUrl.searchParams.get("t") ??
    request.headers.get("x-vm-clip-token") ??
    "";
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

async function authorize(request: NextRequest): Promise<boolean> {
  if (tokenMatches(request)) return true;
  return (await getSession()) !== null;
}

export async function GET(request: NextRequest) {
  if (!(await authorize(request))) {
    return new Response("Unauthorized", { status: 401 });
  }
  const redis = getRedisClient();
  const text = (await redis.get(KEY)) ?? "";
  return new Response(
    `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>VM Clipboard</title>
<style>
  body { font-family: sans-serif; margin: 40px; background: #1a1a1a; color: #e0e0e0; }
  textarea { width: 100%; height: 120px; font-size: 15px; padding: 10px; background: #2a2a2a; color: #e0e0e0; border: 1px solid #444; border-radius: 6px; resize: vertical; }
  button { margin-top: 10px; padding: 10px 24px; background: #6c47ff; color: white; border: none; border-radius: 6px; font-size: 14px; cursor: pointer; }
  button:hover { background: #5a3de0; }
  #msg { margin-top: 8px; font-size: 13px; color: #aaa; }
</style>
</head>
<body>
<h2 style="margin-bottom:16px">VM Clipboard</h2>
<textarea id="t" readonly>${text.replace(/</g, "&lt;")}</textarea>
<br>
<button onclick="copy()">Copy to clipboard</button>
<div id="msg"></div>
<script>
function copy() {
  navigator.clipboard.writeText(document.getElementById('t').value)
    .then(() => { document.getElementById('msg').textContent = 'Copied!'; })
    .catch(() => {
      document.getElementById('t').select();
      document.execCommand('copy');
      document.getElementById('msg').textContent = 'Copied (fallback)!';
    });
}
</script>
</body>
</html>`,
    { headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

export async function POST(req: NextRequest) {
  if (!(await authorize(req))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { text } = (await req.json()) as { text: string };
  if (typeof text !== "string") {
    return Response.json({ error: "text required" }, { status: 400 });
  }
  const redis = getRedisClient();
  await redis.set(KEY, text.slice(0, 65536), "EX", TTL);
  return Response.json({ ok: true });
}

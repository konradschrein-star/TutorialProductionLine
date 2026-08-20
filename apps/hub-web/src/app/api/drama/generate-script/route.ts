import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/app/(authenticated)/_lib/v2-auth";
import { hasPermission } from "@/lib/auth/rbac";

const GEMINI_POOL_URL =
  process.env["GEMINI_POOL_URL"] ??
  "https://hub.schreinercontentsystems.com/gemini";
const GEMINI_POOL_API_KEY = process.env["GEMINI_POOL_API_KEY"] ?? "";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!hasPermission(session, "create:job")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { topic, referenceScript } = (await req.json()) as {
    topic?: string;
    referenceScript?: string;
  };

  if (!topic?.trim()) {
    return NextResponse.json({ error: "topic is required" }, { status: 400 });
  }

  const refSection = referenceScript?.trim()
    ? `\n\nHere is an example script to match in style and pacing:\n---\n${referenceScript.slice(0, 3000)}\n---\n`
    : "";

  const prompt = `Write a dramatic story script for a YouTube drama video about: "${topic}".${refSection}

Requirements:
- Realistic relationship drama in the style of YouTube storytelling channels
- Written as third-person spoken narration (narrator tells the story)
- Hook the viewer strongly in the first paragraph
- 1500–3000 words of pure spoken script
- Include a brief call-to-action at the start (e.g. "Comment where you're watching from and subscribe")
- End with a brief outro encouraging likes and subscription
- Output ONLY the script text — no title, no headers, no markdown, just the spoken words`;

  try {
    const res = await fetch(`${GEMINI_POOL_URL}/v1/chat`, {
      method: "POST",
      headers: {
        "X-Api-Key": GEMINI_POOL_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ prompt }),
    });

    if (!res.ok) {
      const body = await res.text();
      return NextResponse.json(
        { error: `Gemini pool error: ${body.slice(0, 200)}` },
        { status: 502 },
      );
    }

    const data = (await res.json()) as { text: string };
    return NextResponse.json({ script: data.text.trim() });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}

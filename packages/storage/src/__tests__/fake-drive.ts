import type { DriveConfig } from "../config.js";

/**
 * An in-memory stand-in for the Drive REST API.
 *
 * Enough of the real protocol to exercise idempotency, resumption and
 * backoff: folder create/list, appProperties-keyed file lookup, resumable
 * sessions with 308 + Range, and scriptable failures.
 */

export interface FakeFile {
  id: string;
  name: string;
  parents: string[];
  mimeType: string;
  appProperties: Record<string, string>;
  bytes: number;
  trashed: boolean;
}

export interface ScriptedFailure {
  /** Match on the request URL. */
  urlIncludes: string;
  status: number;
  body: string;
  /** Fail this many times, then let it through. */
  times: number;
  headers?: Record<string, string>;
}

export class FakeDrive {
  files = new Map<string, FakeFile>();
  /** sessionUri -> upload state */
  sessions = new Map<
    string,
    {
      file: Omit<FakeFile, "id" | "bytes">;
      total: number;
      received: number;
      fileId?: string;
    }
  >();
  requests: Array<{ method: string; url: string }> = [];
  failures: ScriptedFailure[] = [];
  tokenRequests = 0;

  private seq = 0;

  private nextId(prefix: string): string {
    this.seq += 1;
    return `${prefix}-${this.seq}`;
  }

  failNext(f: ScriptedFailure): void {
    this.failures.push({ ...f });
  }

  private takeScriptedFailure(url: string): ScriptedFailure | null {
    const match = this.failures.find(
      (f) => f.times > 0 && url.includes(f.urlIncludes),
    );
    if (match === undefined) return null;
    match.times -= 1;
    return match;
  }

  readonly fetch = async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = typeof input === "string" ? input : input.toString();
    const method = init?.method ?? "GET";
    this.requests.push({ method, url });

    if (url.includes("oauth2.googleapis.com/token")) {
      this.tokenRequests += 1;
      return new Response(
        JSON.stringify({
          access_token: `tok-${this.tokenRequests}`,
          expires_in: 3600,
        }),
        { status: 200 },
      );
    }

    const scripted = this.takeScriptedFailure(url);
    if (scripted !== null) {
      return new Response(scripted.body, {
        status: scripted.status,
        headers: scripted.headers ?? {},
      });
    }

    if (url.includes("/upload/drive/v3/files") && method === "POST") {
      return this.startResumable(url, init);
    }
    if (url.includes("/resumable-session/")) {
      return this.resumableChunk(url, init);
    }
    if (url.includes("/upload/drive/v3/files") && method === "PATCH") {
      return this.updateMedia(url);
    }
    if (url.includes("/drive/v3/files") && method === "POST") {
      return this.createFile(init);
    }
    if (url.includes("/drive/v3/files") && method === "GET") {
      return this.listOrGet(url);
    }

    return new Response(JSON.stringify({ error: { message: "unrouted" } }), {
      status: 500,
    });
  };

  // ------------------------------------------------------------------ routes

  private createFile(init: RequestInit | undefined): Response {
    const body = JSON.parse(String(init?.body ?? "{}")) as {
      name?: string;
      mimeType?: string;
      parents?: string[];
      appProperties?: Record<string, string>;
    };
    const id = this.nextId("file");
    this.files.set(id, {
      id,
      name: body.name ?? "unnamed",
      parents: body.parents ?? [],
      mimeType: body.mimeType ?? "application/octet-stream",
      appProperties: body.appProperties ?? {},
      bytes: 0,
      trashed: false,
    });
    return new Response(JSON.stringify({ id }), { status: 200 });
  }

  private listOrGet(url: string): Response {
    const parsed = new URL(url);
    const q = parsed.searchParams.get("q");

    if (q === null) {
      const id = decodeURIComponent(parsed.pathname.split("/").pop() ?? "");
      const file = this.files.get(id);
      if (file === undefined) {
        return new Response(
          JSON.stringify({ error: { message: "not found" } }),
          {
            status: 404,
          },
        );
      }
      return new Response(JSON.stringify(this.serialise(file)), {
        status: 200,
      });
    }

    const files = [...this.files.values()].filter((f) => this.matches(f, q));
    return new Response(
      JSON.stringify({ files: files.map((f) => this.serialise(f)) }),
      { status: 200 },
    );
  }

  private matches(file: FakeFile, q: string): boolean {
    if (file.trashed) return false;

    const nameMatch = /name = '([^']*)'/.exec(q);
    if (nameMatch?.[1] !== undefined && file.name !== nameMatch[1])
      return false;

    if (q.includes(`mimeType = 'application/vnd.google-apps.folder'`)) {
      if (file.mimeType !== "application/vnd.google-apps.folder") return false;
    }

    const parentMatch = /'([^']*)' in parents/.exec(q);
    if (parentMatch?.[1] !== undefined) {
      const wanted = parentMatch[1];
      const actual = file.parents[0] ?? "root";
      if (actual !== wanted) return false;
    }

    for (const m of q.matchAll(
      /appProperties has \{ key='([^']*)' and value='([^']*)' \}/g,
    )) {
      const key = m[1] as string;
      const value = m[2] as string;
      if (file.appProperties[key] !== value) return false;
    }
    return true;
  }

  private serialise(f: FakeFile): Record<string, unknown> {
    return {
      id: f.id,
      name: f.name,
      webViewLink: `https://drive.google.com/file/d/${f.id}/view`,
      size: String(f.bytes),
      md5Checksum: `md5-${f.id}`,
      trashed: f.trashed,
    };
  }

  private startResumable(url: string, init: RequestInit | undefined): Response {
    if (!url.includes("uploadType=resumable")) {
      // multipart small-file upload
      const id = this.nextId("file");
      const raw = init?.body;
      const text =
        raw instanceof Uint8Array
          ? Buffer.from(raw).toString("utf8")
          : String(raw ?? "");
      const metaMatch = /\{[\s\S]*?\}\r\n--/.exec(text);
      let meta: {
        name?: string;
        parents?: string[];
        appProperties?: Record<string, string>;
      } = {};
      if (metaMatch !== null) {
        try {
          meta = JSON.parse(metaMatch[0].replace(/\r\n--$/, "")) as typeof meta;
        } catch {
          meta = {};
        }
      }
      // Approximate the payload size: total minus the multipart envelope.
      const parts = text.split("\r\n\r\n");
      const payload = parts.length > 2 ? (parts[2] ?? "") : "";
      const bytes = Buffer.byteLength(payload.replace(/\r\n--.*--\r\n$/, ""));
      this.files.set(id, {
        id,
        name: meta.name ?? "unnamed",
        parents: meta.parents ?? [],
        mimeType: "application/octet-stream",
        appProperties: meta.appProperties ?? {},
        bytes,
        trashed: false,
      });
      return new Response(
        JSON.stringify(this.serialise(this.files.get(id) as FakeFile)),
        {
          status: 200,
        },
      );
    }

    const meta = JSON.parse(String(init?.body ?? "{}")) as {
      name?: string;
      parents?: string[];
      appProperties?: Record<string, string>;
    };
    const total = Number(
      (init?.headers as Record<string, string> | undefined)?.[
        "x-upload-content-length"
      ] ?? 0,
    );
    const sessionId = this.nextId("session");
    const sessionUri = `https://www.googleapis.com/resumable-session/${sessionId}`;
    this.sessions.set(sessionUri, {
      file: {
        name: meta.name ?? "unnamed",
        parents: meta.parents ?? [],
        mimeType: "application/octet-stream",
        appProperties: meta.appProperties ?? {},
        trashed: false,
      },
      total,
      received: 0,
    });
    return new Response("", { status: 200, headers: { location: sessionUri } });
  }

  private resumableChunk(url: string, init: RequestInit | undefined): Response {
    const session = this.sessions.get(url);
    if (session === undefined) {
      return new Response(
        JSON.stringify({ error: { message: "no session" } }),
        {
          status: 404,
        },
      );
    }

    const headers = (init?.headers ?? {}) as Record<string, string>;
    const range = headers["content-range"] ?? "";

    // Status query: "bytes */total"
    if (range.startsWith("bytes */")) {
      if (session.received >= session.total && session.fileId !== undefined) {
        return new Response(
          JSON.stringify(
            this.serialise(this.files.get(session.fileId) as FakeFile),
          ),
          { status: 200 },
        );
      }
      if (session.received === 0) return new Response("", { status: 308 });
      return new Response("", {
        status: 308,
        headers: { range: `bytes=0-${session.received - 1}` },
      });
    }

    const m = /bytes (\d+)-(\d+)\/(\d+)/.exec(range);
    if (m === null) {
      return new Response(JSON.stringify({ error: { message: "bad range" } }), {
        status: 400,
      });
    }
    const start = Number(m[1]);
    const end = Number(m[2]);

    if (start !== session.received) {
      // Real Drive rejects an out-of-order chunk; so do we.
      return new Response("", {
        status: 308,
        headers:
          session.received > 0
            ? { range: `bytes=0-${session.received - 1}` }
            : {},
      });
    }

    session.received = end + 1;

    if (session.received >= session.total) {
      const id = this.nextId("file");
      this.files.set(id, { id, ...session.file, bytes: session.total });
      session.fileId = id;
      return new Response(
        JSON.stringify(this.serialise(this.files.get(id) as FakeFile)),
        { status: 200 },
      );
    }

    return new Response("", {
      status: 308,
      headers: { range: `bytes=0-${session.received - 1}` },
    });
  }

  private updateMedia(url: string): Response {
    const id = decodeURIComponent(
      (new URL(url).pathname.split("/").pop() ?? "").split("?")[0] ?? "",
    );
    const file = this.files.get(id);
    if (file === undefined) {
      return new Response(JSON.stringify({ error: { message: "not found" } }), {
        status: 404,
      });
    }
    return new Response(JSON.stringify(this.serialise(file)), { status: 200 });
  }
}

export function fakeDriveConfig(over: Partial<DriveConfig> = {}): DriveConfig {
  return {
    auth: {
      mode: "oauth_refresh_token",
      clientId: "cid",
      clientSecret: "secret",
      refreshToken: "rtok",
    },
    rootFolderName: "Content Forge",
    requestsPerSecond: 1000,
    burst: 1000,
    chunkSizeBytes: 256 * 1024,
    maxAttempts: 4,
    maxFileBytes: 1024 * 1024 * 1024,
    ...over,
  };
}

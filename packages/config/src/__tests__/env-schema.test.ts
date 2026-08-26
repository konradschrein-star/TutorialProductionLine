import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { tmpdir } from "os";
import { EnvSchema } from "../env-schema.js";
import { loadConfig, getConfig, resetConfig } from "../index.js";

// ── Helpers ───────────────────────────────────────────────────────

/**
 * Builds a minimal valid environment object containing every field that has
 * no default in EnvSchema. Fields with .default() are intentionally omitted
 * so we can verify they resolve to their defaults.
 */
function makeValidEnv(): Record<string, string> {
  return {
    DATABASE_URL: "postgresql://user:pass@localhost:5432/contentforge",
    REDIS_URL: "redis://localhost:6379",
    SECRETS_ENCRYPTION_KEY: "BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=",
    ELEVENLABS_API_KEY: "elevenlabs-test-key",
    ANTHROPIC_API_KEY: "anthropic-test-key",
    GEMINI_API_KEY: "gemini-test-key",
    AI33_API_KEY: "ai33-test-key",
    DEFAULT_VOICE_EN: "voice-en-test-id",
    DEFAULT_VOICE_DE: "test_voice_de_id",
    JWT_SECRET: "this-is-a-32-char-jwt-secret-key!",
    LOCAL_MEDIA_ROOT: tmpdir(),
  };
}

// ── Lifecycle ─────────────────────────────────────────────────────

let originalEnv: NodeJS.ProcessEnv;

beforeEach(() => {
  originalEnv = { ...process.env };
  resetConfig();
});

afterEach(() => {
  process.env = { ...originalEnv };
  resetConfig();
});

// ── EnvSchema.safeParse ───────────────────────────────────────────

describe("EnvSchema.safeParse", () => {
  it("succeeds with all required fields present", () => {
    const result = EnvSchema.safeParse(makeValidEnv());
    expect(result.success).toBe(true);
  });

  it("fails when DATABASE_URL is missing", () => {
    const env = makeValidEnv();
    delete env.DATABASE_URL;
    const result = EnvSchema.safeParse(env);
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.errors.map((e) => e.path.join("."));
      expect(paths).toContain("DATABASE_URL");
    }
  });

  it("fails when DATABASE_URL uses postgres:// prefix instead of postgresql://", () => {
    const env = {
      ...makeValidEnv(),
      DATABASE_URL: "postgres://user:pass@localhost:5432/db",
    };
    const result = EnvSchema.safeParse(env);
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.errors.map((e) => e.message).join(" ");
      expect(messages).toMatch(/postgresql/i);
    }
  });

  it("fails when REDIS_URL uses http:// prefix instead of redis://", () => {
    const env = { ...makeValidEnv(), REDIS_URL: "http://localhost:6379" };
    const result = EnvSchema.safeParse(env);
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.errors.map((e) => e.path.join("."));
      expect(paths).toContain("REDIS_URL");
    }
  });

  it("fails when JWT_SECRET is shorter than 32 characters", () => {
    const env = { ...makeValidEnv(), JWT_SECRET: "too-short" };
    const result = EnvSchema.safeParse(env);
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.errors.map((e) => e.path.join("."));
      expect(paths).toContain("JWT_SECRET");
    }
  });

  it("accepts JWT_SECRET of exactly 32 characters", () => {
    const env = { ...makeValidEnv(), JWT_SECRET: "a".repeat(32) };
    const result = EnvSchema.safeParse(env);
    expect(result.success).toBe(true);
  });

  it("coerces PORT string '3000' to number 3000", () => {
    const env = { ...makeValidEnv(), PORT: "3000" };
    const result = EnvSchema.safeParse(env);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.PORT).toBe(3000);
      expect(typeof result.data.PORT).toBe("number");
    }
  });

  it("coerces PORT string '8080' to number 8080", () => {
    const env = { ...makeValidEnv(), PORT: "8080" };
    const result = EnvSchema.safeParse(env);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.PORT).toBe(8080);
    }
  });

  it("rejects NODE_ENV value not in the allowed enum", () => {
    const env = { ...makeValidEnv(), NODE_ENV: "staging" };
    const result = EnvSchema.safeParse(env);
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.errors.map((e) => e.path.join("."));
      expect(paths).toContain("NODE_ENV");
    }
  });

  it("accepts NODE_ENV = 'development'", () => {
    const result = EnvSchema.safeParse({
      ...makeValidEnv(),
      NODE_ENV: "development",
    });
    expect(result.success).toBe(true);
  });

  it("accepts NODE_ENV = 'production'", () => {
    const result = EnvSchema.safeParse({
      ...makeValidEnv(),
      NODE_ENV: "production",
    });
    expect(result.success).toBe(true);
  });

  it("accepts NODE_ENV = 'test'", () => {
    const result = EnvSchema.safeParse({ ...makeValidEnv(), NODE_ENV: "test" });
    expect(result.success).toBe(true);
  });

  it("defaults PORT to 3000 when PORT is absent", () => {
    const env = makeValidEnv();
    delete env.PORT;
    const result = EnvSchema.safeParse(env);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.PORT).toBe(3000);
    }
  });

  it("defaults NODE_ENV to 'development' when absent", () => {
    const env = makeValidEnv();
    delete env.NODE_ENV;
    const result = EnvSchema.safeParse(env);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.NODE_ENV).toBe("development");
    }
  });

  it("defaults LOCAL_MEDIA_ROOT to '/opt/content-forge/media' when absent", () => {
    const env = makeValidEnv();
    delete env.LOCAL_MEDIA_ROOT;
    const result = EnvSchema.safeParse(env);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.LOCAL_MEDIA_ROOT).toBe("/opt/content-forge/media");
    }
  });

  it("defaults REMOTION_SERVE_URL to 'http://localhost:8000' when absent", () => {
    const env = makeValidEnv();
    delete env.REMOTION_SERVE_URL;
    const result = EnvSchema.safeParse(env);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.REMOTION_SERVE_URL).toBe("http://localhost:8000");
    }
  });

  it("defaults OLLAMA_URL to 'http://localhost:11434' when absent", () => {
    const env = makeValidEnv();
    delete env.OLLAMA_URL;
    const result = EnvSchema.safeParse(env);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.OLLAMA_URL).toBe("http://localhost:11434");
    }
  });

  it("defaults OLLAMA_MODEL to 'gemma3:4b' when absent", () => {
    const env = makeValidEnv();
    delete env.OLLAMA_MODEL;
    const result = EnvSchema.safeParse(env);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.OLLAMA_MODEL).toBe("gemma3:4b");
    }
  });

  it("defaults DEFAULT_VOICE_DE to empty string when absent", () => {
    const env = makeValidEnv();
    delete env.DEFAULT_VOICE_DE;
    const result = EnvSchema.safeParse(env);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.DEFAULT_VOICE_DE).toBe("");
    }
  });


  it("treats optional GOOGLE_IMAGEN_API_KEY as undefined when absent", () => {
    const env = makeValidEnv();
    const result = EnvSchema.safeParse(env);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.GOOGLE_IMAGEN_API_KEY).toBeUndefined();
    }
  });

  it("allows GEMINI_API_KEY to be missing (now optional — §2.3 secrets-area name)", () => {
    const env = makeValidEnv();
    delete env.GEMINI_API_KEY;
    expect(EnvSchema.safeParse(env).success).toBe(true);
  });

  it("fails when SECRETS_ENCRYPTION_KEY is missing (H1 — must boot on it)", () => {
    const env = makeValidEnv();
    delete env.SECRETS_ENCRYPTION_KEY;
    const result = EnvSchema.safeParse(env);
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.errors.map((e) => e.path.join("."));
      expect(paths).toContain("SECRETS_ENCRYPTION_KEY");
    }
  });

  it("fails when SECRETS_ENCRYPTION_KEY does not decode to 32 bytes", () => {
    const env = makeValidEnv();
    env.SECRETS_ENCRYPTION_KEY = Buffer.from("too-short").toString("base64");
    expect(EnvSchema.safeParse(env).success).toBe(false);
  });

  it("fails when LOCAL_MEDIA_ROOT is a relative path", () => {
    const env = {
      ...makeValidEnv(),
      LOCAL_MEDIA_ROOT: "relative/path/to/media",
    };
    const result = EnvSchema.safeParse(env);
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.errors.map((e) => e.message).join(" ");
      expect(messages).toMatch(/absolute path/i);
    }
  });

  it("accepts LOCAL_MEDIA_ROOT as absolute Unix path", () => {
    const env = {
      ...makeValidEnv(),
      LOCAL_MEDIA_ROOT: "/opt/content-forge/media",
    };
    const result = EnvSchema.safeParse(env);
    expect(result.success).toBe(true);
  });

  it("reports all missing required fields in a single parse call", () => {
    // Omit several required fields at once
    const result = EnvSchema.safeParse({});
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.errors.map((e) => e.path.join("."));
      expect(paths).toContain("DATABASE_URL");
      expect(paths).toContain("REDIS_URL");
      expect(paths).toContain("JWT_SECRET");
    }
  });
});

// ── loadConfig ────────────────────────────────────────────────────

describe("loadConfig", () => {
  it("returns a config object with valid env vars", () => {
    Object.assign(process.env, makeValidEnv());
    const config = loadConfig();
    expect(config).toBeDefined();
    expect(config.DATABASE_URL).toBe(makeValidEnv().DATABASE_URL);
  });

  it("throws a descriptive error when required vars are missing", () => {
    // Remove required vars from the env
    delete process.env.DATABASE_URL;
    delete process.env.REDIS_URL;
    delete process.env.JWT_SECRET;
    delete process.env.SECRETS_ENCRYPTION_KEY;
    delete process.env.ELEVENLABS_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.GEMINI_API_KEY;
    delete process.env.AI33_API_KEY;
    delete process.env.DEFAULT_VOICE_EN;
    expect(() => loadConfig()).toThrow();
  });

  it("throws an error message that mentions the invalid field", () => {
    Object.assign(process.env, makeValidEnv());
    process.env.DATABASE_URL = "postgres://wrong-prefix@localhost/db";
    let errorMessage = "";
    try {
      loadConfig();
    } catch (err) {
      errorMessage = (err as Error).message;
    }
    expect(errorMessage).toMatch(/DATABASE_URL/i);
  });

  it("throws an error when LOCAL_MEDIA_ROOT directory does not exist", () => {
    Object.assign(process.env, makeValidEnv());
    process.env.LOCAL_MEDIA_ROOT =
      "/nonexistent/path/that/does/not/exist/12345";
    let errorMessage = "";
    try {
      loadConfig();
    } catch (err) {
      errorMessage = (err as Error).message;
    }
    expect(errorMessage).toMatch(/does not exist/i);
  });

  it("returns the same cached object on repeated calls", () => {
    Object.assign(process.env, makeValidEnv());
    const first = loadConfig();
    const second = loadConfig();
    expect(first).toBe(second);
  });
});

// ── getConfig ─────────────────────────────────────────────────────

describe("getConfig", () => {
  it("throws when loadConfig has not been called", () => {
    // resetConfig() called in beforeEach — cache is empty
    expect(() => getConfig()).toThrow(/loadConfig/i);
  });

  it("returns cached config after loadConfig succeeds", () => {
    Object.assign(process.env, makeValidEnv());
    loadConfig();
    const config = getConfig();
    expect(config).toBeDefined();
    expect(config.DATABASE_URL).toBe(makeValidEnv().DATABASE_URL);
  });
});

// ── resetConfig ───────────────────────────────────────────────────

describe("resetConfig", () => {
  it("clears the cache so getConfig throws again", () => {
    Object.assign(process.env, makeValidEnv());
    loadConfig();
    // Sanity: config is accessible
    expect(() => getConfig()).not.toThrow();
    resetConfig();
    // After reset, cache is gone
    expect(() => getConfig()).toThrow(/loadConfig/i);
  });

  it("allows loadConfig to re-run after reset", () => {
    Object.assign(process.env, makeValidEnv());
    const first = loadConfig();
    resetConfig();
    const second = loadConfig();
    // Both parses should yield equal data (not the same reference)
    expect(second.DATABASE_URL).toBe(first.DATABASE_URL);
  });
});

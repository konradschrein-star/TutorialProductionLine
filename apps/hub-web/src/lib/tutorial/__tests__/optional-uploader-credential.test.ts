import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@repo/db", () => ({ getSecretPresences: vi.fn(async () => new Map()) }));
import { buildTutorialCredentialRows } from "../credentials";

describe("optional uploader credentials", () => {
  it("does not require an uploader token for the manual production path", async () => {
    const rows = await buildTutorialCredentialRows();
    const uploader = rows.find((row) => row.providerKey === "uploader_callback_secret");
    expect(uploader?.required).toBe(false);
    expect(uploader?.description).toContain("Optional for manual delivery");
    expect(rows.find((row) => row.providerKey === "deepseek")?.required).toBe(true);
    expect(rows.find((row) => row.providerKey === "fish")?.required).toBe(true);
  });
});

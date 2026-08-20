import { describe, it, expect } from "vitest";
import {
  brandingContractFor,
  checkBrandingContract,
} from "../branding-contract.js";

const ctx = { format: "TUTORIAL_STUDIO", subjectId: "job-1" };

describe("brandingContractFor", () => {
  it("holds tutorial JOBS to the full contract", () => {
    expect(brandingContractFor("TUTORIAL_STUDIO", "tutorial_job")).toEqual({
      requiresChannel: true,
      requiresHostCharacter: true,
      requiresArchetype: true,
    });
  });

  it("exempts scratch Studio and test renders of the same format", () => {
    for (const kind of ["studio", "test"]) {
      const c = brandingContractFor("TUTORIAL_STUDIO", kind);
      expect(c.requiresChannel).toBe(false);
      expect(c.requiresHostCharacter).toBe(false);
      expect(c.requiresArchetype).toBe(false);
    }
  });

  it("exempts formats that were never branded", () => {
    const c = brandingContractFor("TECH_COMPARISON", "content_job");
    expect(c.requiresHostCharacter).toBe(false);
  });
});

describe("checkBrandingContract", () => {
  const full = brandingContractFor("TUTORIAL_STUDIO", "tutorial_job");

  it("passes when channel, template and host are all resolved", () => {
    expect(
      checkBrandingContract(
        full,
        {
          channelId: "c1",
          hostCharacterName: "General Guy",
          archetypeId: "a1",
        },
        ctx,
      ),
    ).toBeNull();
  });

  it("names EVERY missing piece at once, not one per failed render", () => {
    const err = checkBrandingContract(
      full,
      { channelId: null, hostCharacterName: null, archetypeId: null },
      ctx,
    );
    expect(err).toContain("no channel is attached");
    expect(err).toContain("archetype");
    expect(err).toContain("host character");
  });

  it("points at the Character Library when only the host is missing", () => {
    const err = checkBrandingContract(
      full,
      { channelId: "c1", hostCharacterName: null, archetypeId: "a1" },
      ctx,
    );
    expect(err).toContain("/characters");
    expect(err).toContain("c1");
    expect(err).not.toContain("no channel is attached");
  });

  it("accepts an explicit reference override in place of an archetype row", () => {
    // An operator who hands us a reference image HAS supplied a template.
    expect(
      checkBrandingContract(
        full,
        {
          channelId: "c1",
          hostCharacterName: "General Guy",
          archetypeId: "override",
        },
        ctx,
      ),
    ).toBeNull();
  });

  it("never complains about an unbranded format", () => {
    const none = brandingContractFor("TECH_COMPARISON", "content_job");
    expect(
      checkBrandingContract(
        none,
        { channelId: null, hostCharacterName: null, archetypeId: null },
        { format: "TECH_COMPARISON", subjectId: "job-2" },
      ),
    ).toBeNull();
  });
});

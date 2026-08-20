import { describe, it, expect } from "vitest";
import { deriveLogoSubject } from "../tutorial-product-subject.js";

/**
 * Every title in the "real production titles" blocks below is copied verbatim
 * from `select distinct title from tutorial_jobs where status = 'COMPLETED'`
 * on the production database, so these are the shapes that actually occur.
 */
describe("deriveLogoSubject", () => {
  describe("recognised products", () => {
    it("names the product from a plain 'in <Product>' title", () => {
      expect(deriveLogoSubject("How To Duplicate a Task in Wrike")).toBe(
        "Wrike",
      );
      expect(deriveLogoSubject("How to Rename Notes in Obsidian")).toBe(
        "Obsidian",
      );
      expect(deriveLogoSubject("How to Manage Contacts in MailerLite")).toBe(
        "MailerLite",
      );
    });

    it("uses the canonical display name, not the matched alias", () => {
      // "monday com" is how the title normalises; the prompt must not say that.
      expect(
        deriveLogoSubject("How To Build Lead Routing Workflows In Monday.com"),
      ).toBe("Monday.com");
      expect(deriveLogoSubject("How to fix an issue in sendinblue")).toBe(
        "Brevo",
      );
    });

    it("is case-insensitive and punctuation-insensitive", () => {
      expect(deriveLogoSubject("HOW TO ADD A TASK IN CLICKUP")).toBe("ClickUp");
      expect(deriveLogoSubject("how to add a task in clickup!")).toBe("ClickUp");
    });

    it("still finds the product in the VAs' internal segment naming", () => {
      // Underscore-delimited working titles are a real shape in the corpus and
      // they do name their product, so branding them is correct.
      expect(deriveLogoSubject("10_Jotform_Intermediate")).toBe("Jotform");
      expect(deriveLogoSubject("10_MailerLite_Intermediate")).toBe("MailerLite");
    });

    it("finds a product named without a preposition", () => {
      expect(deriveLogoSubject("n8n Advanced Course")).toBe("n8n");
      expect(deriveLogoSubject("How to Fix MailerLite Forms Not Working")).toBe(
        "MailerLite",
      );
    });
  });

  /**
   * The disambiguation rule. This title grammar puts the tutorial's real
   * subject LAST, so a title naming two products is a tutorial about the
   * second one. Taking the first match brands these with the wrong company.
   */
  describe("titles naming two products", () => {
    it("takes the last-named product, not the first", () => {
      expect(
        deriveLogoSubject("How To Send New Leads To HubSpot Using Zapier"),
      ).toBe("Zapier");
      expect(
        deriveLogoSubject("How To Export Salesforce Reports To Google Sheets"),
      ).toBe("Google Sheets");
      expect(
        deriveLogoSubject("How To Connect Excel Online To Salesforce"),
      ).toBe("Salesforce");
      expect(
        deriveLogoSubject("How To Add Typeform Responses To Airtable Using Zapier"),
      ).toBe("Zapier");
    });

    it("prefers the longer alias at the same position", () => {
      expect(deriveLogoSubject("How to sort data in Google Sheets")).toBe(
        "Google Sheets",
      );
    });
  });

  /**
   * Products we do not list still get branded, via the title's grammar. This
   * is the half that could invent nonsense, so the guards matter more than the
   * hits.
   */
  describe("unlisted products, derived positionally", () => {
    it("extracts a product that is not in the table", () => {
      expect(
        deriveLogoSubject("How To Reconcile Bank Accounts In Sage Accounting"),
      ).toBe("Sage Accounting");
      expect(deriveLogoSubject("How to Add a Company Logo in Gusto")).toBe(
        "Gusto",
      );
    });

    it("strips articles and trailing generic nouns", () => {
      expect(
        deriveLogoSubject("How To Add an Image to a GetResponse Email"),
      ).toBe("GetResponse");
      expect(deriveLogoSubject("How To Add a Button in GetResponse Editor")).toBe(
        "GetResponse",
      );
    });

    it("ignores a trailing marketing suffix", () => {
      expect(
        deriveLogoSubject("How to use VirtualBox - Tutorial for Beginners"),
      ).toBe("VirtualBox");
    });
  });

  /**
   * The honesty rule: a wrong product name makes the model stamp the wrong
   * company's logo on the thumbnail, which is worse than no branding at all.
   */
  describe("returns null rather than guessing", () => {
    it("returns null for segment and scratch titles that name no product", () => {
      for (const title of [
        "12b",
        "4.3 — Part 1",
        "1.1 — Part 1",
        "Northwest NY LLC — Part 3",
      ]) {
        expect(deriveLogoSubject(title)).toBeNull();
      }
    });

    it("returns null when the tail is only filler", () => {
      expect(deriveLogoSubject("How to get started for beginners")).toBeNull();
      expect(deriveLogoSubject("A guide to the settings")).toBeNull();
    });

    it("returns null when no preposition and no known product", () => {
      expect(deriveLogoSubject("Some Unbranded Course Title")).toBeNull();
    });

    it("returns null for empty and non-string input", () => {
      expect(deriveLogoSubject("")).toBeNull();
      expect(deriveLogoSubject("   ")).toBeNull();
      expect(deriveLogoSubject(null)).toBeNull();
      expect(deriveLogoSubject(undefined)).toBeNull();
    });

    it("refuses an over-long tail rather than emitting a sentence", () => {
      expect(
        deriveLogoSubject("How to do the thing in a way that works well"),
      ).toBeNull();
    });
  });

  it("never returns an empty or whitespace-only string", () => {
    const titles = [
      "How To Duplicate a Task in Wrike",
      "12b",
      "How To Add an Image to a GetResponse Email",
      "How to get started for beginners",
      "How To Send New Leads To HubSpot Using Zapier",
    ];
    for (const t of titles) {
      const r = deriveLogoSubject(t);
      expect(r === null || r.trim().length > 0).toBe(true);
    }
  });
});

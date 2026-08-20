import { describe, it, expect } from "vitest";
import { sanitizeScriptText } from "../sanitize-script.js";

describe("sanitizeScriptText", () => {
  it("strips bold around UI names (the real production case)", () => {
    // Verbatim shape from production job f59d3ec3.
    const { text, report } = sanitizeScriptText(
      "Once the dashboard loads, click **Automations** in the left sidebar.",
    );
    expect(text).toBe(
      "Once the dashboard loads, click Automations in the left sidebar.",
    );
    expect(report.changed).toBe(true);
    expect(report.removed).toContain("bold");
  });

  it("strips single-asterisk emphasis", () => {
    const { text } = sanitizeScriptText(
      "It is *not* necessarily today's date.",
    );
    expect(text).toBe("It is not necessarily today's date.");
  });

  it("strips bold-italic and underscore bold", () => {
    expect(sanitizeScriptText("say ***this*** now").text).toBe("say this now");
    expect(sanitizeScriptText("say __that__ now").text).toBe("say that now");
  });

  it("leaves code-comment syntax alone", () => {
    // The opening marker is followed by a space, so it is not emphasis.
    const src = "add a comment at the top using /* and */ to remind myself.";
    const { text, report } = sanitizeScriptText(src);
    expect(text).toBe(src);
    expect(report.changed).toBe(false);
  });

  it("leaves ordinary prose untouched", () => {
    const src =
      "Head to the left sidebar and click Automations.\n\nName it something you'll recognise.";
    const { text, report } = sanitizeScriptText(src);
    expect(text).toBe(src);
    expect(report.changed).toBe(false);
    expect(report.removed).toEqual([]);
  });

  it("strips headings and bullets that would be read aloud", () => {
    const { text, report } = sanitizeScriptText(
      "## Step one\nClick Save.\n- First point\n* Second point",
    );
    expect(text).toBe("Step one\nClick Save.\nFirst point\nSecond point");
    expect(report.removed).toContain("heading");
    expect(report.removed).toContain("bullet");
  });

  /**
   * The em dash used as a pause is the most reliable AI tell in this pipeline,
   * and the one instruction the model would not follow: a script generated
   * immediately after the prompt banned it shipped with seven of them. So it is
   * now removed mechanically rather than requested.
   *
   * A comma, not a period: it can never turn a sentence into a fragment, and it
   * is what the pause stood in for. Better for TTS too, which reads a dash
   * inconsistently and sometimes not at all.
   */
  it("converts an em dash pause to a comma but keeps hyphens", () => {
    const { text, report } = sanitizeScriptText(
      "Use the drop-down — it's faster - honestly.",
    );
    expect(text).toBe("Use the drop-down, it's faster - honestly.");
    expect(report.removed).toContain("dash-pause");
  });

  it("leaves a script with no em dashes untouched", () => {
    const src = "Click Save. The drop-down closes.";
    const { text, report } = sanitizeScriptText(src);
    expect(text).toBe(src);
    expect(report.changed).toBe(false);
  });

  it("strips inline code and code fences", () => {
    const { text } = sanitizeScriptText("Type `npm install` to begin.");
    expect(text).toBe("Type npm install to begin.");
    expect(sanitizeScriptText("```\nClick Save.\n```").text).toBe(
      "Click Save.",
    );
  });

  it("keeps the label from a markdown link and drops the URL", () => {
    const { text } = sanitizeScriptText(
      "Open the [Help Center](https://example.com/help) for details.",
    );
    expect(text).toBe("Open the Help Center for details.");
  });

  it("preserves paragraph breaks", () => {
    const { text } = sanitizeScriptText(
      "Click **Save**.\n\nThen open **Settings**.",
    );
    expect(text).toBe("Click Save.\n\nThen open Settings.");
  });

  it("is idempotent", () => {
    const once = sanitizeScriptText("click **Automations** now").text;
    expect(sanitizeScriptText(once).text).toBe(once);
  });

  it("does not mangle multiplication or standalone asterisks", () => {
    const src = "Roughly 3 * 4 minutes of work.";
    expect(sanitizeScriptText(src).text).toBe(src);
  });
});

import { expect, it } from "vitest";
import {
  isParkedTutorialMode,
  recordSessionKey,
  recoverScriptDraft,
  shouldRestoreRecordSelection,
} from "../record-session";
it("restores selection only while explicitly visiting Record, never during navigation away", () => {
  expect(shouldRestoreRecordSelection("studio", null, "va")).toBe(true);
  for (const tab of [null, "create", "keywords", "localize", "review", "uploads", "dashboard"]) {
    expect(shouldRestoreRecordSelection(tab, null, "va")).toBe(false);
  }
  expect(shouldRestoreRecordSelection("studio", "explicit-job", "va")).toBe(false);
  expect(shouldRestoreRecordSelection("studio", null)).toBe(false);
});
it("parks long-form modes while keeping normal tutorials", () => {
  expect(isParkedTutorialMode("LONG_FORM")).toBe(true);
  expect(isParkedTutorialMode("SIX_MIN_STITCH")).toBe(true);
  expect(isParkedTutorialMode("SIX_MIN")).toBe(false);
});
it("isolates selection and drafts by signed-in user and job", () => {
  expect(recordSessionKey("a", "one")).not.toBe(recordSessionKey("b", "one"));
  expect(recordSessionKey("a", "one")).not.toBe(recordSessionKey("a", "two"));
  expect(recordSessionKey("a")).not.toBe(recordSessionKey("b"));
});
it("restores only drafts matching the current server script", () => {
  const value = JSON.stringify({
    base: "original",
    draft: "my unsaved changes",
  });
  expect(recoverScriptDraft(value, "original")).toBe("my unsaved changes");
  expect(recoverScriptDraft(value, "new generation")).toBeNull();
  expect(recoverScriptDraft("broken", "original")).toBeNull();
  expect(recoverScriptDraft(null, "original")).toBeNull();
});

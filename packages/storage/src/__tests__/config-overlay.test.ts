import { describe, expect, it } from "vitest";
import { loadStorageConfig } from "../config.js";

describe("storage config overlay", () => {
  it("accepts a database-derived environment without mutating process.env", () => {
    const before = process.env["GOOGLE_DRIVE_CLIENT_ID"];
    const result = loadStorageConfig({
      STORAGE_DRIVE_ENABLED: "true",
      GOOGLE_DRIVE_CLIENT_ID: "ui-client",
      GOOGLE_DRIVE_CLIENT_SECRET: "ui-secret",
      GOOGLE_DRIVE_REFRESH_TOKEN: "ui-refresh",
      GOOGLE_DRIVE_ROOT_FOLDER_NAME: "Friend Studio",
      GOOGLE_DRIVE_TUTORIALS_FOLDER_NAME: "Ready to Upload",
      STORAGE_DRIVE_RPS: "2",
    });
    expect(result.enabled).toBe(true);
    if (result.enabled) {
      expect(result.drive.auth.clientId).toBe("ui-client");
      expect(result.drive.rootFolderName).toBe("Friend Studio");
      expect(result.drive.tutorialsFolderName).toBe("Ready to Upload");
      expect(result.drive.requestsPerSecond).toBe(2);
    }
    expect(process.env["GOOGLE_DRIVE_CLIENT_ID"]).toBe(before);
  });
});

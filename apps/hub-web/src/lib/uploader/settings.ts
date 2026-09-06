import { UploaderSettingsSchema, type UploaderSettings } from "@repo/contracts";
import { getSettings } from "@/lib/repositories/settings-repository";

export async function getUploaderSettings(): Promise<UploaderSettings> {
  const row = await getSettings();
  return UploaderSettingsSchema.parse(row?.uploader ?? {});
}

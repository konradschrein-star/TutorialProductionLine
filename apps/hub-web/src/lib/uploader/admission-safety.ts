import type {UploaderSettings} from '@repo/contracts';
/** A live-capable connection does not release an existing queue. Applied only to new claims. */
export function uploaderAdmissionHold(settings:Pick<UploaderSettings,'enabled'|'executionMode'|'requireManualRelease'>):string|null {
 if(!settings.enabled||settings.executionMode!=='live')return 'Uploader is disabled or dry-run. No execution is permitted.';
 if(settings.requireManualRelease)return 'Manual release is enabled. This request remains held; enabling live mode does not release queued uploads.';
 return null;
}

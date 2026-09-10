import {describe,it,expect} from 'vitest';
import {UploaderSettingsSchema} from '@repo/contracts';
import {uploaderAdmissionHold} from '../admission-safety';
import {TUTORIAL_PROVIDER_KEY_OVERRIDES as slots,TUTORIAL_ADDITIONAL_KEYS as additional} from '../../tutorial/credential-slots';
import {readFileSync} from 'node:fs';
describe('safe uploader and credential defaults',()=>{
 it('ordinary upload default is unlisted with manual release retained',()=>{const s=UploaderSettingsSchema.parse({});expect(s.defaultVisibility).toBe('unlisted');expect(s.requireManualRelease).toBe(true);expect(s.executionMode).toBe('dry_run')});
 it('live capability never releases held existing queue',()=>expect(uploaderAdmissionHold(UploaderSettingsSchema.parse({enabled:true,executionMode:'live'}))).toContain('Manual release'));
 it('requires both live and explicit release',()=>{expect(uploaderAdmissionHold({enabled:true,executionMode:'live',requireManualRelease:false})).toBeNull();expect(uploaderAdmissionHold({enabled:false,executionMode:'live',requireManualRelease:false})).not.toBeNull();expect(uploaderAdmissionHold({enabled:true,executionMode:'dry_run',requireManualRelease:false})).not.toBeNull()});
 it('claim checks locked settings before dispatch, after read-only replay branch',()=>{const text=readFileSync(new URL('../scheduled-delivery.ts',import.meta.url),'utf8'),claim=text.slice(text.indexOf('export async function claimScheduledDelivery'),text.indexOf('export async function ingestScheduledReceipt'));expect(claim.indexOf('replay: true')).toBeLessThan(claim.indexOf('uploaderAdmissionHold('));expect(claim.indexOf('.for("share")')).toBeLessThan(claim.indexOf('uploaderAdmissionHold('));expect(claim.indexOf('uploaderAdmissionHold(')).toBeLessThan(claim.indexOf('state: "generic_dispatched"'));expect(claim).not.toContain('await getUploaderSettings()')});
 it('exposes real runtime key slots rather than null catalog entries',()=>{expect(slots.elevenlabs_official).toBe('ELEVENLABS_API_KEY');expect(slots.gemini_direct).toBe('GEMINI_FALLBACK_API_KEY');expect(slots.openai).toBe('OPENAI_API_KEY');expect(additional.map(r=>r[0])).toContain('AI33_API_KEY_2');expect(additional.map(r=>r[0])).toContain('VEOFORGE_API_KEY')});
});

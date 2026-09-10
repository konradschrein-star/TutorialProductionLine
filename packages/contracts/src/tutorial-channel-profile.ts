import {z} from 'zod';
import {normalizeTutorialLanguage} from './queue-payloads/tutorial-payloads.js';
export const TutorialThumbnailModeSchema=z.enum(['procedural','ai','both']);
export type TutorialThumbnailMode=z.infer<typeof TutorialThumbnailModeSchema>;
export const TutorialProceduralLayoutSchema=z.enum([
 'ui-card-host-right','ui-card-host-left','icon-focus-host-right','icon-focus-host-left',
 'guide-host-right','guide-host-left','host-right-headline','host-left-dashboard',
 'solid-light-circle','solid-dark-circle',
]);
export type TutorialProceduralLayout=z.infer<typeof TutorialProceduralLayoutSchema>;
export const TUTORIAL_PROCEDURAL_LAYOUTS=TutorialProceduralLayoutSchema.options;
export const DEFAULT_TUTORIAL_PROCEDURAL_LAYOUTS=['ui-card-host-right','icon-focus-host-right'] as const;
export const TutorialProceduralBackgroundSchema=z.enum([
 'soft-light','soft-dark',
 'office-neutral','office-window','office-white-desk','office-conference','office-desktop',
 'solid-white','solid-black',
]);
export type TutorialProceduralBackground=z.infer<typeof TutorialProceduralBackgroundSchema>;
export const TUTORIAL_PROCEDURAL_BACKGROUNDS=TutorialProceduralBackgroundSchema.options;
export const DEFAULT_TUTORIAL_PROCEDURAL_BACKGROUNDS=['soft-light'] as const;
export const TutorialProceduralTemplateSchema=z.object({
 id:z.string().uuid(),name:z.string().trim().min(1).max(80),enabled:z.boolean().default(true),
 appliesToWordCounts:z.array(z.number().int().min(1).max(4)).min(1).max(4).default([1,2,3,4]),
 wordLengthPattern:z.enum(['any','short-short','short-long','long-short','long-long','contains-long']).default('any'),
 languages:z.array(z.string().trim().toLowerCase().regex(/^[a-z]{2,3}(?:-[a-z]{2})?$/)).max(20).default([]),
 headlineLines:z.enum(['auto','1','2','3','4']).default('auto'),
 hostSide:z.enum(['left','right']).default('right'),hostScale:z.number().min(.8).max(1.15).default(1),hostEdgeOffset:z.number().int().min(-120).max(180).default(82),
 headlineX:z.number().int().min(0).max(1180).default(204),headlineY:z.number().int().min(0).max(620).default(28),headlineWidth:z.number().int().min(180).max(1100).default(530),headlineHeight:z.number().int().min(80).max(500).default(224),
 uiX:z.number().int().min(0).max(1100).default(34),uiY:z.number().int().min(0).max(620).default(286),uiWidth:z.number().int().min(240).max(1100).default(700),uiHeight:z.number().int().min(160).max(620).default(414),
 logoX:z.number().int().min(0).max(1160).default(34),logoY:z.number().int().min(0).max(640).default(61),logoSize:z.number().int().min(64).max(320).default(152),
 arrowEnabled:z.boolean().default(true),arrowX:z.number().int().min(0).max(1100).default(539),arrowY:z.number().int().min(0).max(620).default(405),arrowSize:z.number().int().min(64).max(320).default(190),
 auraEnabled:z.boolean().default(false),auraX:z.number().int().min(-400).max(1680).default(1040),auraY:z.number().int().min(-400).max(1120).default(370),auraRadius:z.number().int().min(80).max(700).default(350),auraOpacity:z.number().min(.05).max(.65).default(.28),
}).strict();
export type TutorialProceduralTemplate=z.infer<typeof TutorialProceduralTemplateSchema>;
/** Explicit opt-in grouping. An absent profile NEVER enables another language. */
export const TutorialChannelProfileSchema=z.object({
 version:z.literal(1).default(1),
 primaryChannelId:z.string().uuid().nullable().default(null),
 translationEnabled:z.boolean().default(false),
 translationMethod:z.enum(['voiceover','none']).default('voiceover'),
 youtubeUrl:z.string().max(300).refine(v=>!v||/^https:\/\/(www\.)?youtube\.com\/(channel\/UC[\w-]+|@[\w.-]+)\/?$/.test(v),'Use a YouTube channel or handle URL').default(''),
 accountLabel:z.string().trim().max(150).default(''),
 thumbnailMode:TutorialThumbnailModeSchema.default('both'),
 proceduralLayoutIds:z.array(TutorialProceduralLayoutSchema).max(TUTORIAL_PROCEDURAL_LAYOUTS.length).default([...DEFAULT_TUTORIAL_PROCEDURAL_LAYOUTS]),
 proceduralBackgrounds:z.array(TutorialProceduralBackgroundSchema).max(TUTORIAL_PROCEDURAL_BACKGROUNDS.length).default([]),
 proceduralUiScreenshot:z.boolean().default(true),
 proceduralTheme:z.enum(['light-first','mixed','dark-first']).default('light-first'),
 proceduralHostCrop:z.enum(['tight','extra-tight']).default('tight'),
 proceduralArrow:z.boolean().default(true),
 proceduralLogoTreatment:z.enum(['badge','integrated','off']).default('badge'),
 proceduralLogoAura:z.boolean().default(false),
 proceduralLogoAuraX:z.number().int().min(-400).max(1680).default(1040),
 proceduralLogoAuraY:z.number().int().min(-400).max(1120).default(370),
 proceduralLogoAuraRadius:z.number().int().min(80).max(700).default(350),
 proceduralLogoAuraOpacity:z.number().min(.05).max(.65).default(.28),
 proceduralTemplates:z.array(TutorialProceduralTemplateSchema).max(20).default([]),
 avatarId:z.string().uuid().nullable().default(null),
 referenceImageIds:z.array(z.string().uuid()).max(40).default([]),
 promptOverrides:z.object({script:z.string().max(12000).default(''),translation:z.string().max(12000).default(''),metadata:z.string().max(12000).default(''),thumbnailText:z.string().max(8000).default(''),thumbnailImage:z.string().max(12000).default('')}).default({}),
}).strict().superRefine((v,ctx)=>{if(v.translationEnabled&&(!v.primaryChannelId||v.translationMethod==='none'))ctx.addIssue({code:'custom',message:'Enabled translations require a primary channel and translation method'});if(v.referenceImageIds.length&&!v.avatarId)ctx.addIssue({code:'custom',message:'Choose a host for its reference images'});if(new Set(v.referenceImageIds).size!==v.referenceImageIds.length)ctx.addIssue({code:'custom',message:'Reference images must be unique'})});
export type TutorialChannelProfile=z.infer<typeof TutorialChannelProfileSchema>;
export const tutorialChannelProfile=(metadata:unknown)=>TutorialChannelProfileSchema.parse((metadata as any)?.tutorialChannelProfile??{});
/** Distinguish an explicitly configured workflow from schema defaults. Legacy
 * channels keep using the global fallback until an Admin saves a choice. */
export const configuredTutorialThumbnailMode=(metadata:unknown):TutorialThumbnailMode|undefined=>{
 const parsed=TutorialThumbnailModeSchema.safeParse((metadata as any)?.tutorialChannelProfile?.thumbnailMode);
 return parsed.success?parsed.data:undefined;
};
export interface TutorialChannelTargetInput {
 id:string;
 language:string;
 isPrimary:boolean;
 enabled:boolean;
 metadata:unknown;
}
/** Resolve only explicitly enabled destinations owned by one primary channel.
 * Invalid profiles and duplicate language destinations are reported and never
 * guessed. This pure contract is shared by the UI, API and workers so a queue
 * retry cannot silently choose a different channel from the one shown to an
 * operator. */
export function resolveTutorialChannelTargets(primaryChannelId:string|null,all:readonly TutorialChannelTargetInput[]){
 const candidates=all.flatMap(channel=>{
  if(channel.isPrimary||!channel.enabled||!primaryChannelId)return [];
  const parsed=TutorialChannelProfileSchema.safeParse((channel.metadata as {tutorialChannelProfile?:unknown}|null)?.tutorialChannelProfile??{});
  if(!parsed.success||parsed.data.primaryChannelId!==primaryChannelId||!parsed.data.translationEnabled||parsed.data.translationMethod==='none')return [];
  const language=normalizeTutorialLanguage(channel.language);
  return language&&language!=='en'?[{channelId:channel.id,language,profile:parsed.data}]:[];
 });
 const duplicateLanguages=new Set(candidates.filter((target,index)=>candidates.findIndex(other=>other.language===target.language)!==index).map(target=>target.language));
 return {
  targets:candidates.filter(target=>!duplicateLanguages.has(target.language)),
  blocked:[...duplicateLanguages].map(language=>({language,reason:'Multiple enabled destinations are configured for this language.'})),
 };
}
export function channelProfileConflict(channel:{id:string;is_primary:boolean;language:string},profile:TutorialChannelProfile,all:Array<{id:string;is_primary:boolean;language:string;metadata:unknown}>):string|null{
 if(channel.is_primary&&profile.primaryChannelId)return 'A primary channel cannot be nested under another primary.';
 if(!channel.is_primary&&profile.translationEnabled&&!profile.primaryChannelId)return 'Choose the primary channel first.';
 if(profile.primaryChannelId){const parent=all.find(c=>c.id===profile.primaryChannelId);if(!parent?.is_primary||parent.id===channel.id)return 'The parent must be a different primary channel.';
 const duplicate=all.some(c=>c.id!==channel.id&&!c.is_primary&&normalizeTutorialLanguage(c.language)===normalizeTutorialLanguage(channel.language)&&(c.metadata as any)?.tutorialChannelProfile?.primaryChannelId===profile.primaryChannelId);if(duplicate)return 'This primary channel already has a destination for this language.';}
 return null;
}

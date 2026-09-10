import {NextResponse} from 'next/server';
import {eq,sql} from 'drizzle-orm';
import {z} from 'zod';
import {db,channels,ttsVoices,characters,characterImages} from '@/lib/db';
import {getSession} from '@/lib/auth/session';
import {TutorialChannelProfileSchema,channelProfileConflict,normalizeTutorialLanguage} from '@repo/contracts';
export const dynamic='force-dynamic';
export async function GET(){
 const session=await getSession();if(session?.role!=='ADMIN')return NextResponse.json({error:'Admin access required'},{status:403});
 const [rows,voices,hosts,images]=await Promise.all([db.select().from(channels),db.select({id:ttsVoices.id,name:ttsVoices.name,language:ttsVoices.language,provider:ttsVoices.provider,isActive:ttsVoices.is_active}).from(ttsVoices),db.select({id:characters.id,name:characters.name,isActive:characters.is_active}).from(characters),db.select({id:characterImages.id,characterId:characterImages.character_id,isActive:characterImages.is_active,pose:characterImages.pose}).from(characterImages)]);
 return NextResponse.json({channels:rows.filter(r=>r.accepts_tutorials||r.is_primary||(r.metadata as any)?.tutorialChannelProfile).map(r=>{const p=TutorialChannelProfileSchema.safeParse((r.metadata as any)?.tutorialChannelProfile??{});return {id:r.id,name:r.name,language:r.language,isPrimary:r.is_primary,enabled:r.accepts_tutorials,voiceId:r.voice_id,uploaderChannelKey:r.uploader_channel_key,youtubeChannelId:r.youtube_channel_id,updatedAt:r.updated_at,profile:p.success?p.data:null,profileError:p.success?null:'Saved configuration is invalid; correct it before enabling translations.'}}),voices,hosts,images,languages:[...new Set(voices.map(v=>v.language))].sort()});
}
const Save=z.object({action:z.literal('save'),channelId:z.string().uuid(),expectedUpdatedAt:z.string().datetime(),enabled:z.boolean(),voiceId:z.string().uuid().nullable(),uploaderChannelKey:z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/).nullable(),profile:TutorialChannelProfileSchema}).strict();
const Create=z.object({action:z.literal('create'),name:z.string().trim().min(1).max(100),language:z.string().regex(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/).max(10),youtubeChannelId:z.string().regex(/^UC[\w-]{22}$/),primaryChannelId:z.string().uuid().nullable()}).strict();
export async function POST(request:Request){
 const session=await getSession();if(session?.role!=='ADMIN')return NextResponse.json({error:'Admin access required'},{status:403});const parsed=z.union([Save,Create]).safeParse(await request.json().catch(()=>null));if(!parsed.success)return NextResponse.json({error:'Check channel configuration',details:parsed.error.issues.map(i=>i.message)},{status:400});
 return db.transaction(async tx=>{
  // Serialize group topology changes; prevents competing same-language destination assignments.
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('tutorial-channel-groups'))`);
  const all=await tx.select().from(channels).for('update'),data=parsed.data;
  if(data.action==='create'){
   if(all.some(c=>c.youtube_channel_id===data.youtubeChannelId))return NextResponse.json({error:'This YouTube channel already exists. Edit its group instead.'},{status:409});
   const profile=TutorialChannelProfileSchema.parse({primaryChannelId:data.primaryChannelId,youtubeUrl:'https://www.youtube.com/channel/'+data.youtubeChannelId});
   const conflict=channelProfileConflict({id:'new',is_primary:!data.primaryChannelId,language:data.language},profile,all);if(conflict)return NextResponse.json({error:conflict},{status:409});
   const [row]=await tx.insert(channels).values({name:data.name,language:data.language,youtube_channel_id:data.youtubeChannelId,is_primary:!data.primaryChannelId,accepts_tutorials:false,metadata:{tutorialChannelProfile:profile,tutorialChannelProfileUpdatedBy:session.userId,tutorialChannelProfileUpdatedAt:new Date().toISOString()}}).returning({id:channels.id});return NextResponse.json({id:row.id,enabled:false,translationsStarted:0});
  }
  const channel=all.find(c=>c.id===data.channelId);if(!channel)return NextResponse.json({error:'Channel not found'},{status:404});if(channel.updated_at.toISOString()!==data.expectedUpdatedAt)return NextResponse.json({error:'Channel changed in another session. Reload before saving.'},{status:409});
  const conflict=channelProfileConflict(channel,data.profile,all);if(conflict)return NextResponse.json({error:conflict},{status:409});
  if(data.profile.translationEnabled&&!all.find(c=>c.id===data.profile.primaryChannelId)?.accepts_tutorials)return NextResponse.json({error:'Enable the primary tutorial channel before its translations.'},{status:400});
  if(data.voiceId){const [v]=await tx.select().from(ttsVoices).where(eq(ttsVoices.id,data.voiceId));if(!v?.is_active||normalizeTutorialLanguage(v.language)!==normalizeTutorialLanguage(channel.language))return NextResponse.json({error:'Choose an active voice for this language'},{status:400});}
  if(data.profile.translationEnabled&&(!data.enabled||!data.voiceId))return NextResponse.json({error:'Enable this destination and select its voice before enabling translation.'},{status:400});
  if(data.profile.avatarId){const [host]=await tx.select().from(characters).where(eq(characters.id,data.profile.avatarId));if(!host?.is_active)return NextResponse.json({error:'Choose an active host'},{status:400});const images=await tx.select().from(characterImages).where(eq(characterImages.character_id,host.id));if(data.profile.referenceImageIds.some(id=>!images.some(i=>i.id===id&&i.is_active)))return NextResponse.json({error:'Reference images must belong to the selected host and be active'},{status:400});}
  if(data.uploaderChannelKey&&all.some(c=>c.id!==channel.id&&c.uploader_channel_key===data.uploaderChannelKey))return NextResponse.json({error:'Uploader mapping already belongs to another channel'},{status:409});
  const [row]=await tx.update(channels).set({accepts_tutorials:data.enabled,voice_id:data.voiceId,uploader_channel_key:data.uploaderChannelKey,metadata:{...(channel.metadata as any??{}),tutorialChannelProfile:data.profile,tutorialChannelProfileUpdatedBy:session.userId,tutorialChannelProfileUpdatedAt:new Date().toISOString()},updated_at:new Date()}).where(eq(channels.id,channel.id)).returning({updatedAt:channels.updated_at});
  return NextResponse.json({success:true,updatedAt:row.updatedAt,existingJobsChanged:false,backfillStarted:false});
 });
}

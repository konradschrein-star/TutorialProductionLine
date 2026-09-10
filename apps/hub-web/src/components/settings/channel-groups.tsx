'use client';
import {useEffect,useState,type CSSProperties} from 'react';
import {TutorialChannelProfileSchema,normalizeTutorialLanguage,type TutorialChannelProfile,type TutorialProceduralLayout,type TutorialProceduralBackground} from '@repo/contracts';
import {toast} from 'sonner';
import {ChannelSchedules} from '@/app/(authenticated)/tutorial-studio/_components/channel-schedules';
import {ChannelDeliveryPolicy} from '@/app/(authenticated)/tutorial-studio/_components/channel-delivery-policy';
import {ProceduralTemplateBuilder} from './procedural-template-builder';
type Channel={id:string;name:string;language:string;isPrimary:boolean;enabled:boolean;voiceId:string|null;uploaderChannelKey:string|null;youtubeChannelId:string;updatedAt:string;profile:TutorialChannelProfile|null;profileError:string|null};
type Inventory={channels:Channel[];voices:Array<{id:string;name:string;language:string;provider:string;isActive:boolean}>;hosts:Array<{id:string;name:string;isActive:boolean}>;images:Array<{id:string;characterId:string;pose:string|null;isActive:boolean}>;languages:string[]};
const input:CSSProperties={width:'100%',minHeight:36,padding:'7px 10px',border:'1px solid var(--v2-border-1)',borderRadius:6,background:'var(--v2-surface-1)',color:'var(--v2-text-1)'};
const LAYOUTS:Array<{id:TutorialProceduralLayout;label:string;detail:string}>=[
 {id:'ui-card-host-right',label:'UI focus · host right',detail:'Tight host, large recorded interface card'},
 {id:'ui-card-host-left',label:'Manual exception · host left',detail:'Never assigned by the default rotation'},
 {id:'icon-focus-host-right',label:'Icon focus · host right',detail:'Large app/document object with tight host'},
 {id:'icon-focus-host-left',label:'Manual exception · host left',detail:'Never assigned by the default rotation'},
 {id:'guide-host-right',label:'Legacy guide · right',detail:'Kept for saved layouts; not a new default'},
 {id:'guide-host-left',label:'Legacy guide · left',detail:'Kept for saved layouts; not a new default'},
 {id:'host-right-headline',label:'Legacy logo-first · right',detail:'Kept for saved layouts; not a new default'},
 {id:'host-left-dashboard',label:'Legacy logo-first · left',detail:'Kept for saved layouts; not a new default'},
 {id:'solid-light-circle',label:'White + circle',detail:'Manual high-contrast option'},
 {id:'solid-dark-circle',label:'Black + circle',detail:'Manual high-contrast option'},
];
const BACKGROUNDS:Array<{id:TutorialProceduralBackground;label:string;manual?:boolean}>=[
 {id:'soft-light',label:'Soft light · recommended'}, {id:'soft-dark',label:'Soft dark'},
 {id:'office-neutral',label:'Neutral office'}, {id:'office-window',label:'Window desk'},
 {id:'office-white-desk',label:'White desk'}, {id:'office-conference',label:'Conference room'},
 {id:'office-desktop',label:'Desktop'}, {id:'solid-white',label:'Plain white',manual:true},
 {id:'solid-black',label:'Plain black',manual:true},
];
export function ChannelGroups(){
 const [data,setData]=useState<Inventory|null>(null),[error,setError]=useState(''),[selected,setSelected]=useState(''),[draft,setDraft]=useState<Channel|null>(null),[busy,setBusy]=useState(false),[dirty,setDirty]=useState(false);
 const [channelSearch,setChannelSearch]=useState('');
 const [newChannel,setNewChannel]=useState({name:'',language:'en',youtubeChannelId:'',primaryChannelId:''});
 async function load(){try{const r=await fetch('/api/production/channel-groups');if(!r.ok)throw Error('Channel settings could not be loaded');const d=await r.json();setData(d);setError('');if(selected)setDraft(d.channels.find((c:Channel)=>c.id===selected)??null);}catch(e){setError(e instanceof Error?e.message:'Load failed')}}
 useEffect(()=>{void load()},[]);
 function choose(c:Channel){if(dirty&&!window.confirm('Discard unsaved channel changes?'))return;setSelected(c.id);setDraft({...c,profile:c.profile??TutorialChannelProfileSchema.parse({})});setDirty(false)}
 function patch(p:Partial<Channel>){setDraft(d=>d?{...d,...p}:d);setDirty(true)}
 function profile(p:Partial<TutorialChannelProfile>){if(draft?.profile)patch({profile:{...draft.profile,...p}})}
 async function submit(body:unknown){setBusy(true);try{const r=await fetch('/api/production/channel-groups',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),j=await r.json();if(!r.ok)throw Error([j.error,...(j.details??[])].join(' '));toast.success('Channel saved. Existing tutorials and schedules were not changed.');setDirty(false);await load();}catch(e){toast.error(e instanceof Error?e.message:'Save failed')}finally{setBusy(false)}}
 if(error)return <div role="alert">{error} <button className="v2-btn" onClick={()=>void load()}>Retry</button></div>;
 if(!data)return <p role="status">Loading channels and configured voices…</p>;
 const primary=data.channels.filter(c=>c.isPrimary),unmapped=data.channels.filter(c=>!c.isPrimary&&!c.profile?.primaryChannelId),p=draft?.profile;
 const normalizedSearch=channelSearch.trim().toLocaleLowerCase();
 const matchesSearch=(channel:Channel)=>!normalizedSearch||[channel.name,channel.language,channel.youtubeChannelId,channel.profile?.accountLabel,channel.uploaderChannelKey].some(value=>value?.toLocaleLowerCase().includes(normalizedSearch));
 const translationsFor=(channelId:string)=>data.channels.filter(channel=>channel.profile?.primaryChannelId===channelId);
 const visiblePrimary=primary.filter(channel=>matchesSearch(channel)||translationsFor(channel.id).some(matchesSearch));
 const visibleUnmapped=unmapped.filter(matchesSearch);
 function row(c:Channel){return <button type="button" key={c.id} className="v2-btn" aria-pressed={selected===c.id} disabled={busy} onClick={()=>choose(c)} style={{justifyContent:'space-between',width:'100%',marginTop:4,textAlign:'left'}}><span>{c.name} · {c.language}</span><small>{c.enabled?(c.isPrimary?'Primary':c.profile?.translationEnabled?'Translation on':'Translation off'):'Disabled'}</small></button>}
 return <section aria-labelledby="channel-group-title" style={{color:'var(--v2-text-1)'}}>
  <h2 id="channel-group-title">Channels & translations</h2><p style={{color:'var(--v2-text-2)'}}>Each primary channel owns its translated destinations. New channels start disabled, with no automatic translations.</p>
  <div style={{display:'flex',gap:8,alignItems:'end',flexWrap:'wrap'}}>
   <label style={{flex:'1 1 260px'}}>Find a channel<input type="search" style={input} placeholder="Name, language, YouTube ID or uploader mapping" value={channelSearch} onChange={event=>setChannelSearch(event.target.value)}/></label>
   <button type="button" className="v2-btn" disabled={busy} onClick={()=>{if(!dirty||window.confirm('Reload and discard unsaved changes?')){setDirty(false);void load()}}}>Reload</button>
  </div>
  <p style={{margin:'8px 0 12px',color:'var(--v2-text-2)'}}>{primary.length} primary {primary.length===1?'channel':'channels'} · {data.channels.length-primary.length} translated or unassigned destinations</p>
  <div className="settings-channel-grid">
   <div style={{display:'grid',gap:6,maxHeight:640,overflowY:'auto',paddingRight:4}}>{visiblePrimary.map(c=>{const translations=translationsFor(c.id),visibleTranslations=translations.filter(matchesSearch);return <section key={c.id} style={{padding:'5px 7px 7px',border:'1px solid var(--v2-border-2)',borderRadius:9,background:'var(--v2-surface-1)'}}>{row(c)}{normalizedSearch?(visibleTranslations.length?<div style={{paddingLeft:12,marginTop:6}}>{visibleTranslations.map(row)}</div>:null):translations.length?<details style={{marginTop:7}}><summary>{translations.length} translated {translations.length===1?'destination':'destinations'} · {translations.filter(channel=>channel.enabled&&channel.profile?.translationEnabled).length} active</summary><div style={{paddingLeft:12,marginTop:6}}>{translations.map(row)}</div></details>:null}</section>})}{!!visibleUnmapped.length&&<details open={Boolean(normalizedSearch)} style={{padding:10,border:'1px solid var(--v2-border-2)',borderRadius:9}}><summary>Unassigned translated channels ({visibleUnmapped.length})</summary><p>Assign explicitly; existing videos are not moved.</p>{visibleUnmapped.map(row)}</details>}{!visiblePrimary.length&&!visibleUnmapped.length&&<p role="status" style={{padding:12,border:'1px dashed var(--v2-border-2)',borderRadius:9,color:'var(--v2-text-2)'}}>No channel matches “{channelSearch.trim()}”.</p>}
   <details style={{marginTop:16}}><summary>Add a channel</summary><form onSubmit={e=>{e.preventDefault();void submit({action:'create',...newChannel,primaryChannelId:newChannel.primaryChannelId||null})}} style={{display:'grid',gap:10,marginTop:10}}>
    <label>Name<input required style={input} value={newChannel.name} onChange={e=>setNewChannel(s=>({...s,name:e.target.value}))}/></label>
    <label>Channel group<select style={input} value={newChannel.primaryChannelId} onChange={e=>setNewChannel(s=>({...s,primaryChannelId:e.target.value}))}><option value="">New primary channel</option>{primary.map(c=><option value={c.id} key={c.id}>{c.name} — translated destination</option>)}</select></label>
    <label>Language code<input required style={input} list="configured-voice-languages" value={newChannel.language} onChange={e=>setNewChannel(s=>({...s,language:e.target.value}))}/></label><datalist id="configured-voice-languages">{data.languages.map(l=><option key={l} value={l}/>)}</datalist>
    <label>YouTube channel ID<input required style={input} placeholder="UC… (not a handle)" value={newChannel.youtubeChannelId} onChange={e=>setNewChannel(s=>({...s,youtubeChannelId:e.target.value}))}/></label><small>Use the actual channel ID. Connecting a browser account is a separate uploader action.</small><button className="v2-btn" disabled={busy}>Add disabled channel</button>
   </form></details></div>
   {draft&&p?<form onSubmit={e=>{e.preventDefault();void submit({action:'save',channelId:draft.id,expectedUpdatedAt:draft.updatedAt,enabled:draft.enabled,voiceId:draft.voiceId,uploaderChannelKey:draft.uploaderChannelKey,profile:p})}} style={{display:'grid',gap:12}}>
    <h3 style={{margin:0}}>{draft.name} · {draft.language}</h3>{draft.profileError&&<p role="alert">{draft.profileError}</p>}
    <label><input type="checkbox" checked={draft.enabled} onChange={e=>patch({enabled:e.target.checked,profile:{...p,translationEnabled:e.target.checked?p.translationEnabled:false}})}/> Enabled for tutorial production</label>
    {!draft.isPrimary&&<><label>Primary channel<select style={input} value={p.primaryChannelId??''} onChange={e=>profile({primaryChannelId:e.target.value||null,translationEnabled:false})}><option value="">Not assigned</option>{primary.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label><label><input type="checkbox" checked={p.translationEnabled} onChange={e=>profile({translationEnabled:e.target.checked})}/> Automatically translate future approved tutorials into this channel</label></>}
    <label>YouTube channel URL<input style={input} value={p.youtubeUrl} placeholder={'https://www.youtube.com/channel/'+draft.youtubeChannelId} onChange={e=>profile({youtubeUrl:e.target.value})}/></label>
    <label>Account label<input style={input} value={p.accountLabel} placeholder="Optional account name — never a password" onChange={e=>profile({accountLabel:e.target.value})}/></label>
    <label>Custom uploader channel mapping<input style={input} value={draft.uploaderChannelKey??''} onChange={e=>patch({uploaderChannelKey:e.target.value||null})}/></label>
    <label>Narration voice<select style={input} value={draft.voiceId??''} onChange={e=>patch({voiceId:e.target.value||null})}><option value="">No channel voice</option>{data.voices.filter(v=>v.isActive&&normalizeTutorialLanguage(v.language)===normalizeTutorialLanguage(draft.language)).map(v=><option key={v.id} value={v.id}>{v.name} · {v.provider}</option>)}</select></label>
    <label>Translation method<select style={input} value={p.translationMethod} onChange={e=>profile({translationMethod:e.target.value as typeof p.translationMethod,translationEnabled:e.target.value==='none'?false:p.translationEnabled})}><option value="voiceover">Translated script + selected narration voice</option><option value="none">No translation</option></select></label>
    <label>Thumbnail workflow<select style={input} value={p.thumbnailMode} onChange={e=>profile({thumbnailMode:e.target.value as typeof p.thumbnailMode})}><option value="procedural">Procedural only</option><option value="ai">AI only</option><option value="both">Both</option></select></label>
    {p.thumbnailMode!=='ai'&&<fieldset style={{display:'grid',gap:10}}><legend>Procedural templates for this channel</legend>
      <p style={{margin:0,color:'var(--v2-text-2)'}}>Automatic layouts lock the host on the right, use one dominant UI or icon object and no more than four words. Left-host and legacy layouts remain manual compatibility options.</p>
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(190px,1fr))',gap:8}}>{LAYOUTS.map(item=><label key={item.id} style={{padding:9,border:'1px solid var(--v2-border-2)',borderRadius:8}}><input type="checkbox" checked={p.proceduralLayoutIds.includes(item.id)} onChange={e=>{const next=e.target.checked?[...p.proceduralLayoutIds,item.id]:p.proceduralLayoutIds.filter(id=>id!==item.id);if(next.length)profile({proceduralLayoutIds:next})}}/> <strong>{item.label}</strong><small style={{display:'block',marginLeft:20,color:'var(--v2-text-2)'}}>{item.detail}</small></label>)}</div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(190px,1fr))',gap:10}}>
       <label><input type="checkbox" checked={p.proceduralUiScreenshot} onChange={e=>profile({proceduralUiScreenshot:e.target.checked})}/> Use a crisp frame from the recorded tutorial</label>
       <label><input type="checkbox" checked={p.proceduralArrow} onChange={e=>profile({proceduralArrow:e.target.checked})}/> Add an arrow only when the selected host pose is not already pointing</label>
       <label>Appearance<select style={input} value={p.proceduralTheme} onChange={e=>profile({proceduralTheme:e.target.value as typeof p.proceduralTheme})}><option value="light-first">Light first</option><option value="mixed">Balanced light + dark</option><option value="dark-first">Dark first</option></select></label>
       <label>Host crop<select style={input} value={p.proceduralHostCrop} onChange={e=>profile({proceduralHostCrop:e.target.value as typeof p.proceduralHostCrop})}><option value="tight">Tight · mid-chest</option><option value="extra-tight">Extra tight · face-led</option></select></label>
       <label>Logo treatment<select style={input} value={p.proceduralLogoTreatment} onChange={e=>profile({proceduralLogoTreatment:e.target.value as typeof p.proceduralLogoTreatment})}><option value="badge">Top-left badge</option><option value="integrated">Inside UI/object</option><option value="off">No logo</option></select></label>
       <label><input type="checkbox" checked={p.proceduralLogoAura} onChange={e=>profile({proceduralLogoAura:e.target.checked})}/> Experimental low-opacity circle using colors sampled from the logo</label>
      </div>
      {p.proceduralLogoAura&&<details><summary>Built-in circle placement</summary><div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(140px,1fr))',gap:8,marginTop:8}}>{([
       ['Horizontal centre','proceduralLogoAuraX',-400,1680,1],['Vertical centre','proceduralLogoAuraY',-400,1120,1],['Radius','proceduralLogoAuraRadius',80,700,1],['Opacity','proceduralLogoAuraOpacity',.05,.65,.01],
      ] as const).map(([label,key,min,max,step])=><label key={key}>{label}<input style={input} type="number" min={min} max={max} step={step} value={p[key]} onChange={e=>profile({[key]:Number(e.target.value)})}/></label>)}</div></details>}
      <div><strong>Automatic background pool</strong><p style={{margin:'3px 0 8px',color:'var(--v2-text-2)'}}>No selection inherits the workspace fallback. Plain colours are available in the editor and stay out of rotation unless checked here.</p><div style={{display:'flex',gap:8,flexWrap:'wrap'}}>{BACKGROUNDS.map(item=><label key={item.id} style={{padding:'7px 9px',border:'1px solid var(--v2-border-2)',borderRadius:7}}><input type="checkbox" checked={p.proceduralBackgrounds.includes(item.id)} onChange={e=>profile({proceduralBackgrounds:e.target.checked?[...p.proceduralBackgrounds,item.id]:p.proceduralBackgrounds.filter(id=>id!==item.id)})}/> {item.label}{item.manual?' · manual by default':''}</label>)}</div></div>
      <ProceduralTemplateBuilder templates={p.proceduralTemplates} onChange={proceduralTemplates=>profile({proceduralTemplates})}/>
    </fieldset>}
    <label>Host / avatar<select style={input} value={p.avatarId??''} onChange={e=>profile({avatarId:e.target.value||null,referenceImageIds:[]})}><option value="">Use existing channel branding</option>{data.hosts.filter(h=>h.isActive).map(h=><option key={h.id} value={h.id}>{h.name}</option>)}</select></label>
    {p.avatarId&&<fieldset><legend>Host reference images</legend><div style={{display:'flex',gap:10,flexWrap:'wrap'}}>{data.images.filter(i=>i.characterId===p.avatarId&&i.isActive).map(i=><label key={i.id}><input type="checkbox" checked={p.referenceImageIds.includes(i.id)} onChange={e=>profile({referenceImageIds:e.target.checked?[...p.referenceImageIds,i.id]:p.referenceImageIds.filter(id=>id!==i.id)})}/><img src={'/api/characters/images/'+i.id+'/file'} width={70} height={70} style={{objectFit:'contain'}} alt={i.pose??'Host reference'}/></label>)}</div></fieldset>}
    <div style={{display:'flex',gap:16,flexWrap:'wrap'}}><a href="/characters">Manage hosts and add reference images</a><a href="/settings/voices">Manage voices and voice settings</a></div>
    <details><summary>Prompt overrides · this channel and language</summary><p>Blank fields inherit the standard prompt. Existing approved tutorials are not rewritten.</p>{Object.entries(p.promptOverrides).map(([key,value])=><label key={key} style={{display:'block',marginTop:10}}>{({script:'Script',translation:'Translation',metadata:'Video title, description & tags',thumbnailText:'Thumbnail headlines',thumbnailImage:'AI thumbnail instructions'} as Record<string,string>)[key]}<textarea style={{...input,minHeight:100}} value={value} onChange={e=>profile({promptOverrides:{...p.promptOverrides,[key]:e.target.value}})}/></label>)}</details>
    <button type="submit" className="v2-btn v2-btn-primary" disabled={busy||!dirty}>{busy?'Saving…':'Save channel settings'}</button>
   </form>:<p>Select a channel to configure its voice, thumbnails, prompts and translated destinations.</p>}
  </div>
  {selected&&<div style={{display:'grid',gap:12,marginTop:24}}><h3>Publication · selected channel</h3><ChannelSchedules key={'schedule-'+selected} channelId={selected}/><ChannelDeliveryPolicy key={'policy-'+selected} channelId={selected}/></div>}
 </section>;
}

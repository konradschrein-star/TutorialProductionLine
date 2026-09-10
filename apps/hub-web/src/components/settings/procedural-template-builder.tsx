'use client';

import type {CSSProperties,PointerEvent as ReactPointerEvent} from 'react';
import type {TutorialProceduralTemplate} from '@repo/contracts';
import {MoveDownRight} from 'lucide-react';

type Props={templates:TutorialProceduralTemplate[];onChange:(templates:TutorialProceduralTemplate[])=>void};
const field:CSSProperties={width:'100%',minHeight:34,padding:'6px 8px',border:'1px solid var(--v2-border-1)',borderRadius:6,background:'var(--v2-surface-1)',color:'var(--v2-text-1)'};
const panel:CSSProperties={padding:12,border:'1px solid var(--v2-border-2)',borderRadius:10,background:'var(--v2-surface-1)'};

function freshTemplate(index:number):TutorialProceduralTemplate{
 return {id:crypto.randomUUID(),name:`Custom template ${index}`,enabled:true,appliesToWordCounts:[1,2,3,4],wordLengthPattern:'any',languages:[],headlineLines:'auto',hostSide:'right',hostScale:1,hostEdgeOffset:82,headlineX:204,headlineY:28,headlineWidth:530,headlineHeight:224,uiX:34,uiY:286,uiWidth:700,uiHeight:414,logoX:34,logoY:61,logoSize:152,arrowEnabled:true,arrowX:539,arrowY:405,arrowSize:190,auraEnabled:false,auraX:1040,auraY:370,auraRadius:350,auraOpacity:.28};
}

type Movable='headline'|'ui'|'logo'|'arrow'|'aura';
function TemplatePreview({value,onMove}:{value:TutorialProceduralTemplate;onMove:(target:Movable,x:number,y:number)=>void}){
 const pct=(value.auraOpacity*100).toFixed(0);
 const rect=(x:number,y:number,w:number,h:number):CSSProperties=>({position:'absolute',left:`${x/12.8}%`,top:`${y/7.2}%`,width:`${w/12.8}%`,height:`${h/7.2}%`});
 const hostWidth=34*value.hostScale;
 const drag=(target:Movable,startX:number,startY:number)=>(event:ReactPointerEvent<HTMLElement>)=>{
  event.preventDefault();event.currentTarget.setPointerCapture(event.pointerId);
  const parent=event.currentTarget.parentElement;if(!parent)return;const bounds=parent.getBoundingClientRect(),originX=event.clientX,originY=event.clientY;
  const move=(moveEvent:PointerEvent)=>onMove(target,Math.round(startX+(moveEvent.clientX-originX)*1280/bounds.width),Math.round(startY+(moveEvent.clientY-originY)*720/bounds.height));
  const stop=()=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',stop);window.removeEventListener('pointercancel',stop)};
  window.addEventListener('pointermove',move);window.addEventListener('pointerup',stop,{once:true});window.addEventListener('pointercancel',stop,{once:true});
 };
 const movable:CSSProperties={cursor:'move',touchAction:'none',outline:'1px dashed transparent'};
 return <div aria-label={`Preview of ${value.name}. Drag elements or use the exact fields beside it.`} style={{position:'relative',aspectRatio:'16/9',overflow:'hidden',borderRadius:8,border:'1px solid var(--v2-border-1)',background:'linear-gradient(135deg,#f7f8fa,#dfe4e8)'}}>
  {value.auraEnabled&&<span title="Move logo-colour circle" onPointerDown={drag('aura',value.auraX,value.auraY)} style={{position:'absolute',left:`${(value.auraX-value.auraRadius)/12.8}%`,top:`${(value.auraY-value.auraRadius)/7.2}%`,width:`${value.auraRadius*2/12.8}%`,aspectRatio:'1',borderRadius:'50%',background:'linear-gradient(135deg,#26d7e8,#7b48ff)',opacity:Number(pct)/100,...movable}}/>}
  <span title="Move UI crop" onPointerDown={drag('ui',value.uiX,value.uiY)} style={{...rect(value.uiX,value.uiY,value.uiWidth,value.uiHeight),border:'2px solid #20242b',borderRadius:5,background:'#fff',boxShadow:'0 4px 12px #0003',...movable}}><span style={{display:'block',margin:'12% 8%',height:'30%',borderRadius:4,background:'#1267d6'}}/></span>
  <span title="Move logo" onPointerDown={drag('logo',value.logoX,value.logoY)} style={{...rect(value.logoX,value.logoY,value.logoSize,value.logoSize),borderRadius:6,background:'#fff',boxShadow:'0 2px 8px #0003',display:'grid',placeItems:'center',fontWeight:900,color:'#111',...movable}}>LOGO</span>
  <span title="Move headline hitbox" onPointerDown={drag('headline',value.headlineX,value.headlineY)} style={{...rect(value.headlineX,value.headlineY,value.headlineWidth,value.headlineHeight),display:'flex',alignItems:'center',...movable}}><b style={{display:'block',maxWidth:'100%',padding:'2.5% 5%',borderRadius:4,background:'#090a0c',color:'#fff',fontFamily:'Anton,Impact,sans-serif',fontSize:'clamp(12px,2.2vw,27px)',lineHeight:.95}}>EXAMPLE TEXT</b></span>
  <span style={{position:'absolute',top:'-3%',bottom:'-6%',width:`${hostWidth}%`,[value.hostSide]:`${-value.hostEdgeOffset/12.8}%`,borderRadius:'48% 48% 12% 12%',background:'linear-gradient(#ffd7bf 0 31%,#172d50 32%)',boxShadow:'0 0 0 2px #ffffff80'}}/>
  {value.arrowEnabled&&<span title="Move arrow" onPointerDown={drag('arrow',value.arrowX,value.arrowY)} style={{...rect(value.arrowX,value.arrowY,value.arrowSize,value.arrowSize),color:'#ef1717',transform:'rotate(18deg)',...movable}}><MoveDownRight aria-hidden="true" style={{width:'100%',height:'100%',strokeWidth:4}}/></span>}
 </div>;
}

function NumberField({label,value,min,max,step=1,onChange}:{label:string;value:number;min:number;max:number;step?:number;onChange:(value:number)=>void}){
 return <label style={{display:'grid',gap:4,fontSize:12}}><span>{label}</span><input aria-label={label} style={field} type="number" min={min} max={max} step={step} value={value} onChange={event=>{const next=Number(event.target.value);if(Number.isFinite(next))onChange(Math.min(max,Math.max(min,next)))}}/></label>;
}

export function ProceduralTemplateBuilder({templates,onChange}:Props){
 const update=(id:string,patch:Partial<TutorialProceduralTemplate>)=>onChange(templates.map(template=>template.id===id?{...template,...patch}:template));
 const move=(template:TutorialProceduralTemplate,target:Movable,x:number,y:number)=>{
  const limits=(value:number,min:number,max:number)=>Math.min(max,Math.max(min,value));
  if(target==='headline')update(template.id,{headlineX:limits(x,0,1280-template.headlineWidth),headlineY:limits(y,0,720-template.headlineHeight)});
  if(target==='ui')update(template.id,{uiX:limits(x,0,1280-template.uiWidth),uiY:limits(y,0,720-template.uiHeight)});
  if(target==='logo')update(template.id,{logoX:limits(x,0,1280-template.logoSize),logoY:limits(y,0,720-template.logoSize)});
  if(target==='arrow')update(template.id,{arrowX:limits(x,0,1280-template.arrowSize),arrowY:limits(y,0,720-template.arrowSize)});
  if(target==='aura')update(template.id,{auraX:limits(x,-400,1680),auraY:limits(y,-400,1120)});
 };
 const fields=(template:TutorialProceduralTemplate,items:Array<[string,keyof TutorialProceduralTemplate,number,number,number?]>)=><div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(115px,1fr))',gap:8}}>{items.map(([label,key,min,max,step])=><NumberField key={String(key)} label={label} value={template[key] as number} min={min} max={max} step={step} onChange={value=>update(template.id,{[key]:value})}/>)}</div>;
 return <section aria-labelledby="template-builder-title" style={{display:'grid',gap:10}}>
  <div><strong id="template-builder-title">Cross-video template builder</strong><p style={{margin:'4px 0',color:'var(--v2-text-2)'}}>Saved here for this channel. Enabled templates join future automatic rotation; the normal editor still controls a single video.</p></div>
  <button type="button" className="v2-btn" onClick={()=>onChange([...templates,freshTemplate(templates.length+1)])}>+ Create template</button>
  {!templates.length&&<div style={panel}><strong>No custom templates yet.</strong><p style={{margin:'4px 0',color:'var(--v2-text-2)'}}>Built-in right-host templates remain active. Create one to permanently tune placement or intentionally add a left-host variant.</p></div>}
  {templates.map((template,index)=><details key={template.id} open={index===0} style={panel}>
   <summary style={{cursor:'pointer',fontWeight:700}}>{template.name}{template.enabled?' · in rotation':' · paused'}</summary>
   <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(min(100%,320px),1fr))',gap:14,marginTop:12}}>
    <div style={{display:'grid',gap:9,alignContent:'start'}}><TemplatePreview value={template} onMove={(target,x,y)=>move(template,target,x,y)}/><small style={{color:'var(--v2-text-2)'}}>Drag headline, UI, logo, arrow or circle. Exact fields remain available for keyboard and precise adjustments.</small><label><input type="checkbox" checked={template.enabled} onChange={event=>update(template.id,{enabled:event.target.checked})}/> Include in future automatic rotation</label><label>Template name<input style={field} value={template.name} maxLength={80} onChange={event=>update(template.id,{name:event.target.value})}/></label>
     <fieldset style={{display:'grid',gap:6}}><legend>Use for word counts</legend><div style={{display:'flex',gap:10,flexWrap:'wrap'}}>{[1,2,3,4].map(count=><label key={count}><input type="checkbox" checked={template.appliesToWordCounts.includes(count)} onChange={event=>{const next=event.target.checked?[...template.appliesToWordCounts,count]:template.appliesToWordCounts.filter(item=>item!==count);if(next.length)update(template.id,{appliesToWordCounts:[...new Set(next)].sort()})}}/> {count}</label>)}</div></fieldset>
     <label>Word-length match<select style={field} value={template.wordLengthPattern} onChange={event=>update(template.id,{wordLengthPattern:event.target.value as TutorialProceduralTemplate['wordLengthPattern']})}><option value="any">Any lengths</option><option value="short-short">Two short words</option><option value="short-long">Short + long</option><option value="long-short">Long + short</option><option value="long-long">Two long words</option><option value="contains-long">Contains a long word</option></select></label>
     <label>Language scope<input style={field} value={template.languages.join(', ')} placeholder="All languages" onChange={event=>update(template.id,{languages:event.target.value.split(',').map(item=>item.trim().toLowerCase()).filter(Boolean)})}/><small style={{display:'block',color:'var(--v2-text-2)'}}>Leave empty for all, or use comma-separated codes such as en, de, fr.</small></label>
     <label>Headline rows<select style={field} value={template.headlineLines} onChange={event=>update(template.id,{headlineLines:event.target.value as TutorialProceduralTemplate['headlineLines']})}><option value="auto">Automatic best fit</option><option value="1">Force 1 row</option><option value="2">Force 2 rows</option><option value="3">Force 3 rows</option><option value="4">Force 4 rows</option></select></label>
     <label>Host side<select style={field} value={template.hostSide} onChange={event=>update(template.id,{hostSide:event.target.value as 'left'|'right'})}><option value="right">Right · standard</option><option value="left">Left · deliberate variant</option></select></label>
     <div style={{display:'flex',gap:8,flexWrap:'wrap'}}><button type="button" className="v2-btn" onClick={()=>onChange([...templates,{...template,id:crypto.randomUUID(),name:`${template.name} copy`}])}>Duplicate</button><button type="button" className="v2-btn" onClick={()=>{if(window.confirm(`Remove ${template.name}? Existing thumbnails are unchanged.`))onChange(templates.filter(item=>item.id!==template.id))}}>Remove</button></div>
    </div>
    <div style={{display:'grid',gap:10,alignContent:'start'}}>
     <details open><summary>Host and headline hitbox</summary>{fields(template,[['Host scale','hostScale',.8,1.15,.01],['Edge offset','hostEdgeOffset',-120,180],['Headline X','headlineX',0,1180],['Headline Y','headlineY',0,620],['Headline width','headlineWidth',180,1100],['Headline height','headlineHeight',80,500]])}</details>
     <details open><summary>UI crop and logo</summary>{fields(template,[['UI X','uiX',0,1100],['UI Y','uiY',0,620],['UI width','uiWidth',240,1100],['UI height','uiHeight',160,620],['Logo X','logoX',0,1160],['Logo Y','logoY',0,640],['Logo size','logoSize',64,320]])}</details>
     <details><summary>Arrow</summary><label><input type="checkbox" checked={template.arrowEnabled} onChange={event=>update(template.id,{arrowEnabled:event.target.checked})}/> Use arrow when the host is not pointing</label>{fields(template,[['Arrow X','arrowX',0,1100],['Arrow Y','arrowY',0,620],['Arrow size','arrowSize',64,320]])}</details>
     <details><summary>Logo-colour circle</summary><label><input type="checkbox" checked={template.auraEnabled} onChange={event=>update(template.id,{auraEnabled:event.target.checked})}/> Sample one or two logo colours</label>{fields(template,[['Circle X','auraX',-400,1680],['Circle Y','auraY',-400,1120],['Radius','auraRadius',80,700],['Opacity','auraOpacity',.05,.65,.01]])}</details>
    </div>
   </div>
  </details>)}
 </section>;
}

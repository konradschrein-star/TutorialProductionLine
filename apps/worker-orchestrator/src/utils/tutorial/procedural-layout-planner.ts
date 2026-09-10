import type {TutorialProceduralTemplate} from '@repo/contracts';

export type WordLengthClass='short'|'medium'|'long';
export interface ProceduralPlanInput{
 lines:readonly string[];
 hasUiScreenshot:boolean;
 variantIndex:number;
 hostSide?:'left'|'right';
 auraEnabled?:boolean;
 auraOpacity?:number;
 auraX?:number;
 auraY?:number;
 auraRadius?:number;
}
export interface ProceduralLayoutPlan{
 template:TutorialProceduralTemplate;
 wordCount:number;
 wordLengths:WordLengthClass[];
 strategy:'single-hero'|'balanced-stack'|'long-word-stack';
}

export const classifyProceduralWord=(word:string):WordLengthClass=>{
 const glyphs=Array.from(word.normalize('NFC')).length;
 return glyphs<=5?'short':glyphs<=9?'medium':'long';
};

/**
 * Turn content into geometry before pixels are rendered. The returned hitboxes
 * are the same contract used by the Admin template builder, so automatic and
 * hand-tuned thumbnails cannot silently drift into separate systems.
 */
export function planProceduralLayout(input:ProceduralPlanInput):ProceduralLayoutPlan{
 const words=input.lines.flatMap(line=>line.trim().split(/\s+/u)).filter(Boolean).slice(0,4);
 const wordLengths=words.map(classifyProceduralWord);
 const hasLong=wordLengths.includes('long');
 const strategy=words.length<=2&&!hasLong?'single-hero':hasLong?'long-word-stack':'balanced-stack';
 const side=input.hostSide??'right';
 const variant=Math.abs(input.variantIndex)%6;
 const baseHostScale=[1.08,1,1.13,1.04,1.1,1.02][variant]!;
 const hostScale=hasLong&&words.length>=4?baseHostScale*.88:hasLong&&words.length===3?baseHostScale*.94:baseHostScale;
 const hostEdgeOffset=[92,78,104,84,98,72][variant]!;
 const logoSize=[160,152,168,156,164,148][variant]!;
 // Long localized copy needs vertical room to add a third/fourth row while
 // preserving the mobile type floor. Keeping every retry at 258px made the
 // French and Swedish canaries deterministically fail in exactly the same way.
 const headlineHeight=strategy==='single-hero'
  ?218
  :strategy==='long-word-stack'
   ?words.length>=4?400:words.length===3?310:258
   :words.length>=4?300:246;
 const headlineWidth=hasLong&&words.length>=4?650:side==='right'?(hasLong?548:526):(hasLong?556:536);
 const headlineY=36;
 const uiY=input.hasUiScreenshot?Math.max(274,headlineY+headlineHeight+4):292;
 const uiHeight=side==='left'?Math.min(288,720-uiY-36):720-uiY-36;
 const uiX=side==='right'?36:1280-36-704;
 const logoX=side==='right'?36:1280-36-logoSize;
 const headlineX=side==='right'?logoX+logoSize+18:uiX;
 const arrowX=side==='right'?uiX+500:uiX+18;
 return {
  wordCount:words.length,
  wordLengths,
  strategy,
  template:{
   id:`00000000-0000-4000-8000-${String(variant+1).padStart(12,'0')}`,
   name:`Automatic ${strategy} ${variant+1}`,
   enabled:true,
   appliesToWordCounts:[1,2,3,4],
   wordLengthPattern:'any',
   languages:[],
   headlineLines:'auto',
   hostSide:side,
   hostScale,
   hostEdgeOffset,
   headlineX,
   headlineY,
   headlineWidth,
   headlineHeight,
   uiX,
   uiY,
   uiWidth:704,
   uiHeight,
   logoX,
   logoY:48,
   logoSize,
   arrowEnabled:true,
   arrowX,
   arrowY:uiY+Math.round(uiHeight*.26),
   arrowSize:176,
   auraEnabled:Boolean(input.auraEnabled),
   auraX:input.auraX??(side==='right'?1070:210),
   auraY:input.auraY??360,
   auraRadius:input.auraRadius??360,
   auraOpacity:Math.min(.65,Math.max(.05,input.auraOpacity??.24)),
  },
 };
}

export function proceduralTemplateMatches(template:TutorialProceduralTemplate,lines:readonly string[],language:string):boolean{
 const words=lines.flatMap(line=>line.trim().split(/\s+/u)).filter(Boolean).slice(0,4);
 if(!template.appliesToWordCounts.includes(Math.max(1,words.length)))return false;
 if(template.languages.length&&!template.languages.includes(language.toLowerCase()))return false;
 if(template.wordLengthPattern==='any')return true;
 const lengths=words.map(classifyProceduralWord);
 if(template.wordLengthPattern==='contains-long')return lengths.includes('long');
 if(words.length!==2)return false;
 return `${lengths[0]}-${lengths[1]}`===template.wordLengthPattern;
}

/** Clamp persisted templates at the renderer boundary. Older or manually
 * edited metadata must not make Sharp composite outside the 1280×720 canvas. */
export function safeProceduralTemplate(template:TutorialProceduralTemplate):TutorialProceduralTemplate{
 const clamp=(value:number,min:number,max:number)=>Math.min(max,Math.max(min,value));
 const headlineWidth=clamp(template.headlineWidth,180,1100),headlineHeight=clamp(template.headlineHeight,80,500);
 const uiWidth=clamp(template.uiWidth,240,1100),uiHeight=clamp(template.uiHeight,160,620);
 const logoSize=clamp(template.logoSize,64,320),arrowSize=clamp(template.arrowSize,64,320);
 return {...template,
  hostScale:clamp(template.hostScale,.8,1.15),hostEdgeOffset:clamp(template.hostEdgeOffset,-120,180),
  headlineWidth,headlineHeight,headlineX:clamp(template.headlineX,0,1280-headlineWidth),headlineY:clamp(template.headlineY,0,720-headlineHeight),
  uiWidth,uiHeight,uiX:clamp(template.uiX,0,1280-uiWidth),uiY:clamp(template.uiY,0,720-uiHeight),
  logoSize,logoX:clamp(template.logoX,0,1280-logoSize),logoY:clamp(template.logoY,0,720-logoSize),
  arrowSize,arrowX:clamp(template.arrowX,0,1280-arrowSize),arrowY:clamp(template.arrowY,0,720-arrowSize),
  auraX:clamp(template.auraX,-400,1680),auraY:clamp(template.auraY,-400,1120),auraRadius:clamp(template.auraRadius,80,700),auraOpacity:clamp(template.auraOpacity,.05,.65),
 };
}

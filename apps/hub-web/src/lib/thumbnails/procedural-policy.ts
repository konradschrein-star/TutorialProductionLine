export const MAX_PROCEDURAL_WORDS = 4;
export const MAX_PROCEDURAL_HEADLINES = 4;
export const headlineWords = (text: string) => text.trim().split(/\s+/).filter(Boolean);
const connector = /^(?:&|\+|and|or)$/i;

/** Remove an exact product name when its logo already says the same thing. */
export function removeRepresentedProduct(text: string, productName?: string | null): string {
  const words = headlineWords(text);
  const qualifiers = new Set(["app", "apps", "application", "online", "desktop", "cloud", "studio", "suite", "workspace", "template", "templates"]);
  const product = headlineWords(productName ?? "").map(word => word.toLocaleLowerCase("en").replace(/[^\p{L}\p{N}.]+/gu, ""));
  while (product.length > 1 && qualifiers.has(product[product.length - 1]!)) product.pop();
  if (!product.length) return words.join(" ");
  const bare = (word: string) => word.toLocaleLowerCase("en").replace(/[^\p{L}\p{N}.]+/gu, "");
  const result: string[] = [];
  for (let index = 0; index < words.length;) {
    const matches = product.every((word, offset) => bare(words[index + offset] ?? "") === word);
    if (matches) index += product.length;
    else result.push(words[index++]!);
  }
  while (result.length && connector.test(result[0]!)) result.shift();
  while (result.length && connector.test(result[result.length - 1]!)) result.pop();
  return result.join(" ");
}
export function validateProceduralHeadlines(layers: Array<{type:string;text?:string}>) {
  const blocks = layers.filter(layer => layer.type === 'TEXT' && layer.text?.trim());
  if (!blocks.length || blocks.length > MAX_PROCEDURAL_HEADLINES) return 'Use between one and four headline blocks.';
  if (blocks.some(layer => /[\r\n]/.test(layer.text!))) return 'Each headline block owns one line. Use the 1–4 line controls to split the copy.';
  if (blocks.flatMap(layer => headlineWords(layer.text!)).length > MAX_PROCEDURAL_WORDS) return 'Use no more than four words total. Shorten the copy; it will never be truncated automatically.';
  return null;
}

/** Preserve word order while balancing the visual width of 1–4 hitboxes. */
export function distributeHeadlineWords(words: readonly string[], requestedBlocks: number): string[] {
  // Never silently delete legacy copy. The validator keeps approval blocked
  // until the VA deliberately shortens it to four words.
  const clean = words.map(word => word.trim()).filter(Boolean);
  if (!clean.length) return [''];
  // A connector belongs to the phrase before it. It may never become the
  // giant, isolated headline seen in the broken DocuSign composition.
  const units: string[] = [];
  for (const word of clean) {
    if (connector.test(word) && units.length) units[units.length - 1] = `${units[units.length - 1]} ${word}`;
    else units.push(word);
  }
  const count = Math.max(1, Math.min(MAX_PROCEDURAL_HEADLINES, requestedBlocks, units.length));
  const result: string[] = [];
  let cursor = 0;
  for (let block = 0; block < count; block++) {
    const wordsLeft = units.length - cursor;
    const blocksLeft = count - block;
    const take = Math.max(1, Math.ceil(wordsLeft / blocksLeft));
    result.push(units.slice(cursor, cursor + take).join(' '));
    cursor += take;
  }
  return result;
}
export function initialLocaleOnly(languageParameter: string | null, requestedJobLanguage?: string | null): boolean {
  return languageParameter !== null || Boolean(requestedJobLanguage && requestedJobLanguage !== 'en');
}
export function moveLayerBefore<T extends {id:string;zIndex:number}>(layers:T[],moving:string,target:string):T[] {
  if(moving===target||!layers.some(l=>l.id===moving)||!layers.some(l=>l.id===target))return layers;
  const ordered=[...layers].sort((a,b)=>b.zIndex-a.zIndex);const item=ordered.find(l=>l.id===moving)!;
  const rest=ordered.filter(l=>l.id!==moving);rest.splice(rest.findIndex(l=>l.id===target),0,item);
  const indices=new Map(rest.map((l,i)=>[l.id,rest.length-i]));return layers.map(l=>({...l,zIndex:indices.get(l.id)!}));
}
export function alphaBounds(data:ArrayLike<number>,width:number,height:number){
  let left=width,top=height,right=-1,bottom=-1;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)if((data[(y*width+x)*4+3]??0)>8){left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);}
  return right<left ? {x:0,y:0,width,height} : {x:left,y:top,width:right-left+1,height:bottom-top+1};
}

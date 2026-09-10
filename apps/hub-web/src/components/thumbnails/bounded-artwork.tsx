'use client';
import { useEffect, useState } from 'react';
import { alphaBounds } from '@/lib/thumbnails/procedural-policy';
type Bounds={x:number;y:number;width:number;height:number;naturalWidth:number;naturalHeight:number};
const cache=new Map<string,Promise<Bounds|null>>();
function boundsFor(url:string){
  if(!cache.has(url))cache.set(url,new Promise(resolve=>{const image=new Image();image.crossOrigin='anonymous';image.onerror=()=>resolve(null);image.onload=()=>{try{const factor=Math.min(1,512/Math.max(image.naturalWidth,image.naturalHeight));const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(image.naturalWidth*factor));canvas.height=Math.max(1,Math.round(image.naturalHeight*factor));const ctx=canvas.getContext('2d')!;ctx.drawImage(image,0,0,canvas.width,canvas.height);const b=alphaBounds(ctx.getImageData(0,0,canvas.width,canvas.height).data,canvas.width,canvas.height);resolve({...b,naturalWidth:canvas.width,naturalHeight:canvas.height});}catch{resolve(null);}};image.src=url;}));
  return cache.get(url)!;
}
/** Display-only alpha crop: shared/original bytes are never changed. */
export function BoundedArtwork({url,width,height,scale=1,mirrorX=false,mirrorY=false,tight=false,shadow,onError,alt}:{url:string;width:number;height:number;scale?:number;mirrorX?:boolean;mirrorY?:boolean;tight?:boolean;shadow?:string;onError?:()=>void;alt:string}){
  const [state,setState]=useState<{url:string;bounds:Bounds|null}|null>(null);
  useEffect(()=>{let active=true;void boundsFor(url).then(bounds=>{if(active)setState({url,bounds});});return()=>{active=false;};},[url]);
  const b=tight&&state?.url===url?state.bounds:null;
  const factor=b?Math.min(width/b.width,height/b.height)*scale:1;
  return <div data-artwork-pending={tight&&state?.url!==url?'true':undefined} style={{width:'100%',height:'100%',position:'relative',overflow:'visible',transform:`scale(${mirrorX?-1:1},${mirrorY?-1:1})`,filter:shadow?`drop-shadow(${shadow})`:undefined}}>
    <img src={url} alt={alt} onError={onError} style={b?{position:'absolute',maxWidth:'none',width:b.naturalWidth*factor,height:b.naturalHeight*factor,left:(width-b.width*factor)/2-b.x*factor,top:(height-b.height*factor)/2-b.y*factor,pointerEvents:'none'}:{width:'100%',height:'100%',objectFit:'contain',pointerEvents:'none',transform:`scale(${scale})`,transformOrigin:'center'}} />
  </div>;
}

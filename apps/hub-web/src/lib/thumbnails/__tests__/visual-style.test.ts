import { describe, expect, it } from 'vitest';
import { CLOSE_HOST_CROP, TUTORIAL_HEADLINE_SIZE, headlineColorForRgb, layerShadowCss } from '../visual-style';
import { readThumbnailLayout } from '../layout-document';
describe('new draft visual style',()=>{
  it('uses a closer body crop and headline readable at a 320px preview',()=>{
    expect(CLOSE_HOST_CROP.right.width).toBeGreaterThan(330);
    expect(CLOSE_HOST_CROP.left.height).toBeGreaterThan(450);
    expect(CLOSE_HOST_CROP.right.y+CLOSE_HOST_CROP.right.height).toBeGreaterThan(450);
    expect(TUTORIAL_HEADLINE_SIZE*320/800).toBeGreaterThanOrEqual(30);
  });
  it('chooses white for dark backgrounds and yellow for bright backgrounds',()=>{
    expect(headlineColorForRgb(20,30,40)).toBe('#ffffff');
    expect(headlineColorForRgb(240,235,230)).toBe('#ffeb3b');
  });
  it('supports soft alpha-outline shadows for every layer and explicit off',()=>{
    expect(layerShadowCss({shadow:true})).toBe('0 5px 12px rgba(0,0,0,0.45)');
    expect(layerShadowCss({shadow:true,shadowBlur:20,shadowOpacity:.2,shadowOffsetY:-3},.5)).toBe('0 -1.5px 10px rgba(0,0,0,0.2)');
    expect(layerShadowCss({shadow:false})).toBeUndefined();
  });
  it('round-trips per-layer preferences without changing old saved layouts',()=>{
    const layer={id:'person',type:'PERSON',x:0,y:0,width:300,height:400,zIndex:1};
    const old=JSON.stringify({aspectRatio:'16:9',elements:[layer]});
    expect(readThumbnailLayout(old)?.elements[0]).toEqual(layer);
    const enhanced={...layer,shadow:true,shadowBlur:18,shadowOpacity:.3,shadowOffsetY:6};
    expect(readThumbnailLayout(JSON.stringify({aspectRatio:'16:9',elements:[enhanced]}))?.elements[0]).toEqual(enhanced);
  });
});

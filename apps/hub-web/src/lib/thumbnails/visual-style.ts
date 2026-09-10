/** New/replacement draft geometry only; persisted layouts are never migrated. */
export const CLOSE_HOST_CROP = {
  right: { x: 430, y: -24, width: 410, height: 554 },
  left: { x: -45, y: -24, width: 410, height: 554 },
} as const;
export const TUTORIAL_HEADLINE_SIZE = 76;
export const backgroundToneColor = (tone?: 'light'|'dark'|'auto') => tone === 'light' ? '#ffeb3b' : tone === 'dark' ? '#ffffff' : null;

export function headlineColorForRgb(r: number, g: number, b: number): '#ffffff' | '#ffeb3b' {
  const luminance = .2126 * r + .7152 * g + .0722 * b;
  return luminance >= 145 ? '#ffeb3b' : '#ffffff';
}
export interface LayerShadow { shadow?: boolean; shadowBlur?: number; shadowOpacity?: number; shadowOffsetY?: number }
export function layerShadowCss(layer: LayerShadow, scale = 1): string | undefined {
  if (!layer.shadow) return undefined;
  const blur = Math.max(0, Math.min(40, layer.shadowBlur ?? 12));
  const opacity = Math.max(0, Math.min(1, layer.shadowOpacity ?? .45));
  const y = Math.max(-30, Math.min(30, layer.shadowOffsetY ?? 5));
  return `0 ${y * scale}px ${blur * scale}px rgba(0,0,0,${opacity})`;
}
/** Sampling only follows an explicit draft background/layout action. It never
 * rewrites loaded saved layouts or approvals. Failed sampling leaves copy intact. */
export async function sampleBackgroundColor(url?: string, css?: string): Promise<'#ffffff' | '#ffeb3b' | null> {
  if (!url) {
    const hex = css?.match(/#([a-f0-9]{6})(?![a-f0-9])/i)?.[1];
    return hex ? headlineColorForRgb(parseInt(hex.slice(0,2),16),parseInt(hex.slice(2,4),16),parseInt(hex.slice(4,6),16)) : null;
  }
  return new Promise(resolve => {
    const image = new Image(); image.crossOrigin = 'anonymous';
    const timer = setTimeout(() => resolve(null), 5000);
    image.onerror = () => { clearTimeout(timer); resolve(null); };
    image.onload = () => { clearTimeout(timer); try {
      const canvas = document.createElement('canvas'); canvas.width = 32; canvas.height = 18;
      const context = canvas.getContext('2d'); if (!context) return resolve(null);
      context.drawImage(image, 0, 0, 32, 18); const data = context.getImageData(0,0,32,18).data;
      let r=0,g=0,b=0; for(let i=0;i<data.length;i+=4){r+=data[i]!;g+=data[i+1]!;b+=data[i+2]!;}
      resolve(headlineColorForRgb(r/576,g/576,b/576));
    } catch { resolve(null); } };
    image.src = url;
  });
}

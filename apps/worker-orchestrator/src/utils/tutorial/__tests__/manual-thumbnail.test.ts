import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";
import { extractBestInterfaceFrame, prepareLogoArtwork, renderManualTutorialArtwork } from "../manual-thumbnail.js";
import { planProceduralLayout } from "../procedural-layout-planner.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("renderManualTutorialArtwork", () => {
  it("keeps contain padding transparent instead of adding black logo bars",async()=>{
    const directory=await mkdtemp(join(tmpdir(),'tutorial-logo-'));temporaryDirectories.push(directory);
    const input=join(directory,'wide.png');await sharp({create:{width:180,height:52,channels:4,background:{r:25,g:110,b:235,alpha:1}}}).png().toFile(input);
    const {data,info}=await sharp(await prepareLogoArtwork(input,112)).raw().toBuffer({resolveWithObject:true});
    const topAlpha=Array.from({length:info.width},(_,x)=>data[x*info.channels+3]??255);
    expect(Math.max(...topAlpha)).toBe(0);
    expect(data.some((value,index)=>index%info.channels===3&&value===255)).toBe(true);
  });
  it("removes opaque black bars baked into a downloaded logo",async()=>{
    const directory=await mkdtemp(join(tmpdir(),'tutorial-logo-bars-'));temporaryDirectories.push(directory);
    const input=join(directory,'letterboxed.png');
    const artwork=await sharp({create:{width:180,height:64,channels:4,background:{r:38,g:112,b:238,alpha:1}}}).png().toBuffer();
    await sharp({create:{width:180,height:112,channels:4,background:{r:0,g:0,b:0,alpha:1}}})
      .composite([{input:artwork,left:0,top:24}]).png().toFile(input);
    const {data,info}=await sharp(await prepareLogoArtwork(input,112)).ensureAlpha().raw().toBuffer({resolveWithObject:true});
    const visible=[] as Array<{r:number;g:number;b:number}>;
    for(let index=0;index<data.length;index+=info.channels){
      if((data[index+3]??0)>240)visible.push({r:data[index]??0,g:data[index+1]??0,b:data[index+2]??0});
    }
    expect(visible.length).toBeGreaterThan(0);
    expect(visible.filter(pixel=>pixel.r<25&&pixel.g<25&&pixel.b<25)).toHaveLength(0);
    const topAlpha=Array.from({length:info.width},(_,x)=>data[x*info.channels+3]??255);
    expect(Math.max(...topAlpha)).toBe(0);
  });
  it("falls back cleanly when a recorded interface frame is unavailable", async () => {
    await expect(extractBestInterfaceFrame(join(tmpdir(), "missing-tutorial.mp4"), join(tmpdir(), "missing-frame.png"))).resolves.toBeNull();
  });
  it("renders a full-size office thumbnail with the bundled condensed display font", async () => {
    const directory = await mkdtemp(join(tmpdir(), "tutorial-thumbnail-"));
    temporaryDirectories.push(directory);
    const publicDir = resolve(process.cwd(), "../hub-web/public");
    const outputPath = join(directory, "thumbnail.png");

    await renderManualTutorialArtwork({
      outputPath,
      backgroundPath: join(publicDir, "background/bg_1_1128207.jpg"),
      hostPath: join(publicDir, "English/american-hero.png"),
      logoPath: join(publicDir, "app_logos_png/notion.png"),
      lines: ["MASTER", "NOTION", "TEN", "MINUTES"],
      accent: "#00b7ff",
      hostSide: "right",
      publicDir,
    });

    const metadata = await sharp(outputPath).metadata();
    expect(metadata.width).toBe(1280);
    expect(metadata.height).toBe(720);
    expect(metadata.format).toBe("png");
  });
  it("keeps four-word French copy above the mobile font floor by adding rows", async () => {
    const directory = await mkdtemp(join(tmpdir(), "tutorial-thumbnail-fr-"));
    temporaryDirectories.push(directory);
    const publicDir = resolve(process.cwd(), "../hub-web/public");
    const lines = ["DÉSACTIVER LA SAUVEGARDE AUTOMATIQUE"];
    const template = planProceduralLayout({ lines, hasUiScreenshot: true, variantIndex: 2 }).template;
    const result = await renderManualTutorialArtwork({
      outputPath: join(directory, "thumbnail.png"),
      backgroundColor: "#f3f5f7",
      hostPath: join(publicDir, "English/american-pointing.png"),
      logoPath: join(publicDir, "app_logos_png/notion.png"),
      lines,
      accent: "#00b7ff",
      hostSide: "right",
      showArrow: false,
      hostPointsAtTarget: true,
      language: "fr",
      template,
      publicDir,
    });
    expect(result.quality?.passed, JSON.stringify(result.quality)).toBe(true);
    expect(result.quality?.metrics.headlineBlocks).toBeGreaterThanOrEqual(3);
    expect(result.quality?.metrics.minimumMobileFontPx).toBeGreaterThanOrEqual(11.5);
    expect(result.quality?.issues.map(issue => issue.code)).not.toContain("pill_off_center");
  });
  it("supports a forced four-row template with shrink-wrapped centered pills", async () => {
    const directory = await mkdtemp(join(tmpdir(), "tutorial-thumbnail-four-rows-"));
    temporaryDirectories.push(directory);
    const publicDir = resolve(process.cwd(), "../hub-web/public");
    const lines = ["STÄNG AV AUTOMATISK SPARNING"];
    const planned = planProceduralLayout({ lines, hasUiScreenshot: true, variantIndex: 1 }).template;
    const template = { ...planned, headlineLines: "4" as const, headlineHeight: 460, uiY: 510, uiHeight: 188 };
    const result = await renderManualTutorialArtwork({
      outputPath: join(directory, "thumbnail.png"),
      backgroundColor: "#111318",
      hostPath: join(publicDir, "English/american-pointing.png"),
      logoPath: join(publicDir, "app_logos_png/gmail.png"),
      lines,
      accent: "#ff304f",
      hostSide: "right",
      showArrow: false,
      hostPointsAtTarget: true,
      language: "sv",
      template,
      publicDir,
    });
    expect(result.quality?.metrics.headlineBlocks).toBe(4);
    expect(result.quality?.passed, JSON.stringify(result.quality)).toBe(true);
    expect(result.quality?.issues.map(issue => issue.code)).not.toEqual(expect.arrayContaining(["pill_off_center", "glyph_overflow"]));
  });
});

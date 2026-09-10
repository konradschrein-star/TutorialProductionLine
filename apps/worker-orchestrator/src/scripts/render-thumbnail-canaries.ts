import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import sharp from "sharp";
import { renderManualTutorialArtwork } from "../utils/tutorial/manual-thumbnail.js";
import { planProceduralLayout } from "../utils/tutorial/procedural-layout-planner.js";

const publicDir = resolve(process.cwd(), "../hub-web/public");
const outputDir = resolve(process.cwd(), "../../.release/thumbnail-canaries-25");
await mkdir(outputDir, { recursive: true });

async function uiComponent(name: string, markup: string): Promise<string> {
  const path = join(outputDir, `${name}-component.png`);
  await sharp(Buffer.from(`<svg width="960" height="540" xmlns="http://www.w3.org/2000/svg">${markup}</svg>`)).png().toFile(path);
  return path;
}

const notionUi = await uiComponent("notion", `
  <rect width="960" height="540" rx="28" fill="#fff"/>
  <text x="70" y="104" font-family="Arial" font-size="68" font-weight="800" fill="#111">Auto-save</text><text x="70" y="158" font-family="Arial" font-size="29" fill="#666">Save every change automatically</text>
  <rect x="66" y="205" width="828" height="154" rx="28" fill="#f6f6f4" stroke="#d9d9d5" stroke-width="5"/><text x="112" y="274" font-family="Arial" font-size="36" font-weight="700" fill="#111">Save changes</text><text x="112" y="321" font-family="Arial" font-size="26" fill="#666">Keep this page synced</text><rect x="726" y="245" width="124" height="70" rx="35" fill="#111"/><circle cx="813" cy="280" r="28" fill="#fff"/>
  <rect x="66" y="401" width="360" height="98" rx="18" fill="#111"/><text x="246" y="464" text-anchor="middle" font-family="Arial" font-size="34" font-weight="700" fill="#fff">Save now</text>`);

const gmailUi = await uiComponent("gmail", `
  <rect width="960" height="540" rx="28" fill="#fff"/><rect x="38" y="34" width="884" height="472" rx="22" fill="#fff" stroke="#d4d7dc" stroke-width="5"/><rect x="38" y="34" width="884" height="72" rx="22" fill="#f1f3f4"/><text x="78" y="82" font-family="Arial" font-size="30" font-weight="700" fill="#202124">New Message</text>
  <text x="78" y="154" font-family="Arial" font-size="24" fill="#6b7075">Recipients</text><line x1="70" y1="178" x2="890" y2="178" stroke="#e0e0e0" stroke-width="3"/><text x="78" y="226" font-family="Arial" font-size="24" fill="#6b7075">Subject</text><line x1="70" y1="250" x2="890" y2="250" stroke="#e0e0e0" stroke-width="3"/>
  <rect x="72" y="398" width="248" height="76" rx="38" fill="#0b57d0"/><text x="196" y="448" text-anchor="middle" font-family="Arial" font-size="33" font-weight="700" fill="#fff">Send</text><path d="M282 426l16 20 16-20" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round"/>`);

const discordUi = await uiComponent("discord", `
  <rect width="960" height="540" rx="28" fill="#313338"/><rect width="92" height="540" fill="#1e1f22"/><rect x="92" width="230" height="540" fill="#2b2d31"/><circle cx="46" cy="58" r="30" fill="#5865f2"/><text x="46" y="68" text-anchor="middle" font-family="Arial" font-size="27" font-weight="800" fill="#fff">D</text>
  <text x="132" y="72" font-family="Arial" font-size="27" font-weight="700" fill="#f2f3f5">Tutorial Team</text><rect x="116" y="112" width="182" height="54" rx="10" fill="#404249"/><text x="138" y="147" font-family="Arial" font-size="22" fill="#fff"># closed-tickets</text>
  <text x="364" y="74" font-family="Arial" font-size="29" font-weight="700" fill="#f2f3f5"># closed-tickets</text><circle cx="394" cy="172" r="34" fill="#5865f2"/><text x="444" y="164" font-family="Arial" font-size="24" font-weight="700" fill="#fff">Ticket Bot</text><text x="444" y="204" font-family="Arial" font-size="22" fill="#b5bac1">This ticket has been closed.</text><rect x="444" y="236" width="372" height="76" rx="14" fill="#248046"/><text x="630" y="285" text-anchor="middle" font-family="Arial" font-size="27" font-weight="700" fill="#fff">View closed ticket</text>`);

const driveUi = await uiComponent("drive", `
  <rect width="960" height="540" rx="28" fill="#f8fafd"/><rect x="48" y="44" width="864" height="452" rx="30" fill="#fff" stroke="#dce1e7" stroke-width="5"/><circle cx="166" cy="173" r="68" fill="#fce8e6"/><path d="M166 126v65m0 38v5" stroke="#d93025" stroke-width="17" stroke-linecap="round"/><text x="272" y="161" font-family="Arial" font-size="52" font-weight="800" fill="#202124">Upload failed</text><text x="272" y="220" font-family="Arial" font-size="29" fill="#5f6368">Check your connection.</text><rect x="472" y="337" width="374" height="108" rx="54" fill="#0b57d0"/><text x="659" y="405" text-anchor="middle" font-family="Arial" font-size="40" font-weight="700" fill="#fff">Try again</text>`);

const common = {
  publicDir,
  hostPath: join(publicDir, "English/american-pointing.png"),
  accent: "#ff304f",
  hostCrop: "extra-tight" as const,
  logoTreatment: "badge" as const,
  showArrow: false,
  hostSide: "right" as const,
  layoutId: "ui-card-host-right" as const,
  hostZoom: 1,
} as const;

const canaries = [
  { name: "notion-tutorial", backgroundColor: "#f3f5f7", logoPath: join(publicDir, "app_logos_png/notion.png"), lines: ["AUTO SAVE"], uiScreenshotPath: notionUi, theme: "light-first" as const, hostZoom: 1.12 },
  { name: "send-email", backgroundColor: "#111318", logoPath: join(publicDir, "app_logos_png/gmail.png"), lines: ["SEND EMAIL"], uiScreenshotPath: gmailUi, theme: "dark-first" as const },
  { name: "find-closed", backgroundColor: "#eef1f4", logoPath: join(publicDir, "app_logos_png/discord.png"), lines: ["FIND CLOSED"], uiScreenshotPath: discordUi, theme: "light-first" as const },
  { name: "fix-drive", backgroundColor: "#f6f7f8", logoPath: join(publicDir, "app_logos_png/googledrive.png"), lines: ["UPLOAD FIX"], uiScreenshotPath: driveUi, theme: "light-first" as const, hostZoom: 1.12 },
  { name: "send-email-aura", backgroundColor: "#111318", logoPath: join(publicDir, "app_logos_png/gmail.png"), lines: ["SEND EMAIL"], uiScreenshotPath: gmailUi, theme: "dark-first" as const, logoAura: true },
  { name: "upload-fix-aura", backgroundColor: "#f6f7f8", logoPath: join(publicDir, "app_logos_png/googledrive.png"), lines: ["UPLOAD FIX"], uiScreenshotPath: driveUi, theme: "light-first" as const, logoAura: true },
  { name: "one-word-reset", backgroundColor: "#f3f5f7", logoPath: join(publicDir, "app_logos_png/notion.png"), lines: ["RESET"], uiScreenshotPath: notionUi, theme: "light-first" as const, hostZoom: 1.12 },
  { name: "three-word-recover-files", backgroundColor: "#f6f7f8", logoPath: join(publicDir, "app_logos_png/googledrive.png"), lines: ["RECOVER LOST FILES"], uiScreenshotPath: driveUi, theme: "light-first" as const },
  { name: "german-mixed-length", backgroundColor: "#111318", logoPath: join(publicDir, "app_logos_png/gmail.png"), lines: ["DATEN JETZT WIEDERHERSTELLEN"], uiScreenshotPath: gmailUi, theme: "dark-first" as const },
  { name: "host-left-variant", backgroundColor: "#eef1f4", logoPath: join(publicDir, "app_logos_png/discord.png"), lines: ["SCHNELL DATEI FINDEN"], uiScreenshotPath: discordUi, theme: "light-first" as const, hostSide: "left" as const, layoutId: "ui-card-host-left" as const },
  { name: "short-long", backgroundColor: "#f6f7f8", logoPath: join(publicDir, "app_logos_png/googledrive.png"), lines: ["FIX WIEDERHERSTELLUNG"], uiScreenshotPath: driveUi, theme: "light-first" as const },
  { name: "long-short", backgroundColor: "#f6f7f8", logoPath: join(publicDir, "app_logos_png/googledrive.png"), lines: ["WIEDERHERSTELLUNG FIX"], uiScreenshotPath: driveUi, theme: "light-first" as const },
  { name: "long-long", backgroundColor: "#111318", logoPath: join(publicDir, "app_logos_png/gmail.png"), lines: ["AUTOMATISCHE WIEDERHERSTELLUNG"], uiScreenshotPath: gmailUi, theme: "dark-first" as const },
  { name: "french-four-words", backgroundColor: "#f3f5f7", logoPath: join(publicDir, "app_logos_png/notion.png"), lines: ["DÉSACTIVER LA SAUVEGARDE AUTOMATIQUE"], uiScreenshotPath: notionUi, theme: "light-first" as const },
  { name: "italian-three-words", backgroundColor: "#eef1f4", logoPath: join(publicDir, "app_logos_png/discord.png"), lines: ["RIPRISTINA FILE ELIMINATI"], uiScreenshotPath: discordUi, theme: "light-first" as const },
  { name: "swedish-four-words", backgroundColor: "#111318", logoPath: join(publicDir, "app_logos_png/gmail.png"), lines: ["STÄNG AV AUTOMATISK SPARNING"], uiScreenshotPath: gmailUi, theme: "dark-first" as const },
] as const;

const qualityReports:Array<{name:string;score:number|null;passed:boolean|null;issues:string[]}>=[];
const fullQuality:Array<{name:string;quality:unknown}>=[];
for (const [index,canary] of canaries.entries()) {
  const hostSide='hostSide' in canary?canary.hostSide:common.hostSide;
  const logoAura='logoAura' in canary?canary.logoAura:false;
  const plan=planProceduralLayout({lines:canary.lines,hasUiScreenshot:true,variantIndex:index,hostSide,auraEnabled:logoAura});
  const language=canary.name.includes('german')||canary.name.includes('long')?'de':canary.name.includes('french')?'fr':canary.name.includes('italian')?'it':canary.name.includes('swedish')?'sv':'en';
  const rendered=await renderManualTutorialArtwork({ ...common, ...canary, language, hostPointsAtTarget:true, hostSide, hostZoom:plan.template.hostScale, template:plan.template, outputPath: join(outputDir, `${canary.name}.png`) });
  qualityReports.push({name:canary.name,score:rendered.quality?.score??null,passed:rendered.quality?.passed??null,issues:rendered.quality?.issues.map(issue=>issue.code)??[]});
  fullQuality.push({name:canary.name,quality:rendered.quality});
}

const rendered = canaries.map(({ name }) => join(outputDir, `${name}.png`));
const tiles = await Promise.all(rendered.map(path => sharp(path).resize(620, 349).png().toBuffer()));
await sharp({ create: { width: 1920, height: Math.ceil(canaries.length / 3) * 369 + 10, channels: 3, background: "#090a0d" } }).composite(tiles.map((input, index) => ({ input, left: index % 3 * 640 + 10, top: Math.floor(index / 3) * 369 + 10 }))).png().toFile(join(outputDir, "contact-sheet.png"));
const wordTiles = tiles.slice(6);
await sharp({ create: { width: 1280, height: Math.ceil(wordTiles.length / 2) * 369 + 10, channels: 3, background: "#090a0d" } }).composite(wordTiles.map((input, index) => ({ input, left: index % 2 * 640 + 10, top: Math.floor(index / 2) * 369 + 10 }))).png().toFile(join(outputDir, "word-length-sheet.png"));
const mobile = await Promise.all(rendered.map(path => sharp(path).resize(320, 180).png().toBuffer()));
await sharp({ create: { width: 340, height: canaries.length * 190 + 20, channels: 3, background: "#090a0d" } }).composite(mobile.map((input, index) => ({ input, left: 10, top: index * 190 + 10 }))).png().toFile(join(outputDir, "mobile-preview.png"));

await writeFile(join(outputDir,'quality-report.json'),JSON.stringify(fullQuality,null,2));
console.log(JSON.stringify({ outputDir, qualityReports,files: [...canaries.map(({ name }) => `${name}.png`), "contact-sheet.png", "word-length-sheet.png", "mobile-preview.png",'quality-report.json'] }));

import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import sharp, { type OverlayOptions } from "sharp";
import type { ShareCard } from "../social";

async function assetDirectory() {
  for (const app of [process.cwd(), join(process.cwd(), "apps/launch-website")]) {
    const dir = join(app, "lib/server/share-assets");
    try { await access(join(dir, "BarlowSemiCondensed-Bold.ttf")); return dir; } catch { /* Try the monorepo layout. */ }
  }
  throw new Error("Share image assets unavailable");
}

const backdrop = Buffer.from(`<svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg">
  <defs><linearGradient id="paper" x2="1" y2=".35" gradientUnits="objectBoundingBox"><stop stop-color="#101912"/><stop offset=".62" stop-color="#13251a"/><stop offset="1" stop-color="#20432c"/></linearGradient></defs>
  <rect width="1200" height="630" fill="url(#paper)"/>
  <g fill="none" stroke="#41734a" opacity=".48"><circle cx="976" cy="312" r="222"/><circle cx="976" cy="312" r="268"/><circle cx="976" cy="312" r="314"/><circle cx="976" cy="312" r="360"/></g>
  <path d="M60 518 H1140" stroke="#709278" opacity=".65"/><path d="M60 518 H180" stroke="#b6f655" stroke-width="3"/>
  </svg>`);
const circle = Buffer.from('<svg width="292" height="292"><circle cx="146" cy="146" r="146" fill="white"/></svg>');

function escapeText(value: string) {
  return value.replace(/[&<>]/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;" })[c]!);
}
async function lettering(text: string, size: number, color: string, width: number, fontfile: string) {
  const input = await sharp({ text: { text: '<span foreground="' + color + '">' + escapeText(text) + '</span>',
    font: "Barlow Semi Condensed Bold " + size, fontfile, rgba: true, dpi: 72 } }).png().toBuffer();
  return sharp(input).resize({ width, withoutEnlargement: true }).png().toBuffer();
}

export async function renderShareImage(card: ShareCard, portrait: Buffer | null) {
  const dir = await assetDirectory(), font = join(dir, "BarlowSemiCondensed-Bold.ttf");
  const brand = await readFile(join(dir, "rmt-mark.png"));
  const text = (value: string, size: number, color: string, width: number) => lettering(value, size, color, width, font);
  const category = card.kind === "creator" ? "CREATOR PROFILE" : card.kind === "token" ? "TOKEN PROFILE" : "TOKEN LAUNCHPAD";
  const hero = card.name === card.identity && card.kind === "creator" ? card.name.replace(/^@/, "") : card.name;
  const [wordmark, label, name, handle, domain, chain, mark] = await Promise.all([
    text("RMT LAUNCH", 35, "#f3f8ee", 245), text(category, 25, "#b6f655", 420),
    text(hero, 96, "#f4f7ed", 655), text(card.identity, 40, "#aac4ac", 655),
    text("rmtlaunch.fun", 29, "#f4f7ed", 330), text("Robinhood Chain", 26, "#aac4ac", 295),
    sharp(brand).resize(64,64).png().toBuffer(),
  ]);
  let artwork: Buffer;
  if (portrait || card.kind === "site") {
    artwork = await sharp(portrait || brand, { limitInputPixels: 16_000_000 }).resize(292,292,{fit:"cover"}).ensureAlpha().png().toBuffer();
  } else {
    const initials = Array.from(hero.trim()).slice(0,2).join("").toUpperCase() || "R";
    const letters = await text(initials, 118, "#e2f9b5", 216);
    artwork = await sharp({ create:{ width:292,height:292,channels:4,background:"#284733" } }).composite([{input:letters,gravity:"center"}]).png().toBuffer();
  }
  const face = await sharp(artwork).composite([{input:circle,blend:"dest-in"}]).png().toBuffer();
  const halo = Buffer.from('<svg width="312" height="312"><circle cx="156" cy="156" r="155" fill="#152b1c" stroke="#b6f655" stroke-width="2"/></svg>');
  const layers: OverlayOptions[] = [
    {input:mark,left:54,top:45},{input:wordmark,left:129,top:62},{input:label,left:62,top:189},
    {input:name,left:58,top:249},{input:handle,left:62,top:370},{input:halo,left:820,top:156},
    {input:face,left:830,top:166},{input:domain,left:60,top:555},{input:chain,left:932,top:557}
  ];
  return sharp(backdrop).composite(layers).png().toBuffer();
}

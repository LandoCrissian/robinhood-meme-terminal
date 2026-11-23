import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { creatorCard, socialMetadata, tokenCard } from "../social";
import { profileShareIntent, type PublicCreatorProfile } from "../profiles";
import { shareImagePath, anonymousReadHeaders } from "./social-pages";
import { renderShareImage } from "./social-image";

const walletAddress = "0x1111111111111111111111111111111111111111" as const;
const profile: PublicCreatorProfile = {username:"test_creator",displayName:"Avery & Co",walletAddress,chainId:4663,bio:"",xHandle:null,links:[],avatarUrl:null,createdAt:"",updatedAt:""};

test("creator shares have separate owner and visitor copy, one canonical URL and versioned artwork", () => {
  const card = creatorCard(profile);
  for (const owner of [true,false]) {
    const intent = new URL(profileShareIntent(profile,owner));
    assert.equal(intent.searchParams.get("url"),"https://www.rmtlaunch.fun/u/test_creator");
    assert.match(intent.searchParams.get("text")!,owner ? /^Find me/ : /Avery & Co’s profile/);
    assert.deepEqual(intent.searchParams.get("text")!.match(/@rmtlaunch/gi),["@RMTLaunch"]);
    assert.deepEqual([...intent.searchParams.keys()].sort(),["text","url"]);
  }
  const image = shareImagePath(card);
  assert.match(image,/^\/share\/u\/test_creator\/[0-9a-f]{24}\.png$/);
  assert.notEqual(image,shareImagePath({...card,artwork:"another version"}));
  assert.notEqual(image,shareImagePath({...card,name:"A new name"}));
  assert.notEqual(image,shareImagePath(card,"rmt-card-v1"));
  for (const displayName of ["@RMTLaunch", "promo.test", "https://example.com", ""]) {
    const intent = new URL(profileShareIntent({...profile,username:"rmtlaunch",displayName}));
    assert.deepEqual(intent.searchParams.get("text")!.match(/@rmtlaunch/gi),["@RMTLaunch"]);
    assert.doesNotMatch(intent.searchParams.get("text")!,/promo\.test|example\.com/);
  }
  assert.equal(creatorCard({...profile,username:null}).path,"/creator/"+walletAddress);
  const incoming = anonymousReadHeaders(new Headers({host:"example.invalid",cookie:"private",origin:"https://example.com","x-forwarded-host":"example.invalid"}));
  assert.deepEqual([...incoming.keys()].sort(),["host","x-forwarded-host"]);
});

test("token cards bind their token address and identity, render artwork, and fall back to initials",async () => {
  const card = tokenCard({token:walletAddress,name:"Avery & Co",symbol:"AVERY",projectURI:"https://example.invalid/untrusted"});
  const image = shareImagePath(card), url = "https://www.rmtlaunch.fun/launches/" + walletAddress;
  const metadata = socialMetadata(card.path,card.name,"Token page",image,card.identity);
  assert.equal(metadata.alternates?.canonical,url);
  assert.equal(metadata.openGraph?.url,url);
  assert.match(image,/^\/share\/launches\/0x[0-9a-f]{40}\/[0-9a-f]{24}\.png$/);
  const portrait = await sharp({create:{width:32,height:32,channels:3,background:"#d02d6f"}}).webp().toBuffer();
  const rendered = await renderShareImage(card,portrait);
  const info = await sharp(rendered).metadata();
  assert.deepEqual([info.format,info.width,info.height],["png",1200,630]);
  const center = await sharp(rendered).extract({left:976,top:312,width:1,height:1}).removeAlpha().raw().toBuffer();
  assert.ok(center[0]>180 && center[1]<75);
  assert.notDeepEqual(rendered,await renderShareImage(card,null));
});

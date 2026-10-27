import assert from "node:assert/strict";
import {createCannaCatSpotReader,observeCannaCatAmount,type CannaCatSpot} from "./cannacat-observation";
async function main() {
let now=1_000_000,calls=0;
const spot:CannaCatSpot={chainId:4663,sqrtPriceX96:1000n*2n**96n,blockNumber:100n,blockHash:"0x"+"a".repeat(64),observedAtMs:now};
const read=createCannaCatSpotReader(async()=>{calls++;await Promise.resolve();return{...spot,observedAtMs:now};},()=>now);
await Promise.all(Array.from({length:20},()=>read()));assert.equal(calls,1,"Concurrent passive observations coalesce");
await read();assert.equal(calls,1,"Fresh observation is reused independently of wallet/amount");
now+=15_001;await read();assert.equal(calls,2,"Expired spot evidence is refreshed");
const token=observeCannaCatAmount({...spot,observedAtMs:now},{side:"buy",tokenAmountAtomic:(10000n*10n**18n).toString(),ethInputAtomic:null},now);
assert.equal(token.expectedOutputAtomic,(10000n*10n**18n).toString());assert(BigInt(token.inputAmountAtomic)>10n**16n);
const eth=observeCannaCatAmount({...spot,observedAtMs:now},{side:"buy",tokenAmountAtomic:"0",ethInputAtomic:(10n**15n).toString()},now);
assert.equal(eth.expectedOutputAtomic,(9975n*10n**17n).toString());
const sell=observeCannaCatAmount({...spot,observedAtMs:now},{side:"sell",tokenAmountAtomic:(10n**18n).toString(),ethInputAtomic:null},now);
assert.equal(sell.expectedOutputAtomic,"997500000000");assert.equal(sell.feeEstimateAtomic,"2500000000");
for(const bad of [0n,-1n,2n**160n])assert.throws(()=>observeCannaCatAmount({...spot,sqrtPriceX96:bad},{side:"sell",tokenAmountAtomic:"1",ethInputAtomic:null},now));
assert.throws(()=>observeCannaCatAmount({...spot,observedAtMs:now-60_001},{side:"sell",tokenAmountAtomic:"1",ethInputAtomic:null},now));
assert.throws(()=>observeCannaCatAmount({...spot,observedAtMs:now+1},{side:"sell",tokenAmountAtomic:"1",ethInputAtomic:null},now));
assert.throws(()=>observeCannaCatAmount({...spot,observedAtMs:now},{side:"sell",tokenAmountAtomic:"0",ethInputAtomic:null},now));
assert.throws(()=>observeCannaCatAmount({...spot,observedAtMs:now},{side:"sell",tokenAmountAtomic:(2n**256n).toString(),ethInputAtomic:null},now));
let failures=0;const broken=createCannaCatSpotReader(async()=>{failures++;throw new Error("Synthetic outage");},()=>now);
await assert.rejects(broken());await assert.rejects(broken());assert.equal(failures,2,"Failure never permanently locks the shared read");
console.log(JSON.stringify({result:"PASS",checks:16,concurrentReaders:20,passiveZeroXCalls:0,synthetic:true}));
}
void main().catch(error=>{console.error(error);process.exitCode=1;});

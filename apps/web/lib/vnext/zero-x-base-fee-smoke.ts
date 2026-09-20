import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { decodeFunctionData, encodeFunctionData, getAddress, keccak256, parseAbi, zeroAddress, type Hex } from "viem";
import { verifyZeroXEncodedFee, decodeZeroXExecutableMinimum, inspectZeroXRoute } from "../server/vnext-zero-x-execution-decoder";
import { zeroXFeeAsset, RMT_ZERO_X_USDG as usdg, ZERO_X_NATIVE_TOKEN, toZeroXToken, createVNextZeroXProviderNativeFee } from "./zero-x-settlement";
import { mutateZeroXActions, ppmRuntime } from "./zero-x-provider-native-fee-smoke";
const fixture = createRequire(import.meta.url)("../../../../.github/scripts/zerox-execution-fixture.cjs");
const project = getAddress("0x1139d423C1706BDeaD91f03507F521635591eD92");
const weth = getAddress("0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73");
const recipient = getAddress("0x0000000000000000000000000000000000010000");
const holder = getAddress("0x0000000000001fF3684f28c67538d4D072C22734");
const other = getAddress("0x0000000000000000000000000000000000023456");
const basic = parseAbi(["function BASIC(address token,uint256 proportion,address pool,uint256 offset,bytes data)"]);
const transfer = parseAbi(["function transfer(address recipient,uint256 amount) returns(bool)"]);
let positive=0, negative=0;
for (const [sell,buy,expected] of [[usdg,project,usdg],[project,usdg,usdg],[zeroAddress,project,zeroAddress],[project,zeroAddress,zeroAddress],
  [usdg,zeroAddress,usdg],[zeroAddress,usdg,zeroAddress],[project,weth,project],[weth,project,weth]] as const) {
  assert.equal(zeroXFeeAsset(sell,buy),expected);
  const body={sellToken:toZeroXToken(sell),buyToken:toZeroXToken(buy),sellAmount:"1000000",minBuyAmount:"990000000000000",
    actionBasisForTest:1000000n,fees:{integratorFee:{token:toZeroXToken(expected),amount:expected===sell?"2500":"2500000000000"},zeroExFee:{token:toZeroXToken(sell),amount:"1500"}},transaction:{to:holder}};
  const input={target:holder,data:fixture.encodeQuote(body,recipient) as Hex,inputAsset:sell,outputAsset:buy,inputAmountAtomic:body.sellAmount,recipient,
    valueAtomic:sell===zeroAddress?body.sellAmount:"0",runtimeHash:keccak256(ppmRuntime),expectedOutputAtomic:"1000000000000000",providerFeeAsset:sell,providerFeeAtomic:"1500"};
  const fee=verifyZeroXEncodedFee(input);assert.equal(fee.token,expected);assert.equal(fee.numerator,"2500");assert.equal(fee.denominator,"1000000");
  assert.equal(decodeZeroXExecutableMinimum(input).minimumAtomic,body.minBuyAmount);positive++;
  const evidence=createVNextZeroXProviderNativeFee({inputAsset:sell,outputAsset:buy,userGrossInputAtomic:body.sellAmount,expectedOutputAtomic:input.expectedOutputAtomic,protectedOutputAtomic:body.minBuyAmount,
    recipient,quotedFeeAmountAtomic:body.fees.integratorFee.amount,authorizationState:"indicative"});
  assert.equal(evidence.feeAsset,expected);assert.equal(evidence.requestSellToken,toZeroXToken(sell));
  assert.equal(evidence.providerInputAtomic,expected===sell?"997500":"1000000");
  if(expected!==sell)assert.throws(()=>createVNextZeroXProviderNativeFee({inputAsset:sell,outputAsset:buy,userGrossInputAtomic:body.sellAmount,expectedOutputAtomic:input.expectedOutputAtomic,protectedOutputAtomic:body.minBuyAmount,recipient,authorizationState:"indicative"}));
  for(const change of [
    (x:any[])=>{x[0]=toZeroXToken(expected===sell?buy:sell);},
    (x:any[])=>{x[1]=0n;},(x:any[])=>{x[1]=2501n;},(x:any[])=>{x[1]=2499n;},
    (x:any[])=>{x[3]=123n;},
    (x:any[])=>{if(x[4]==="0x")x[2]=other;else x[4]=encodeFunctionData({abi:transfer,functionName:"transfer",args:[other,0n]});},
    (x:any[])=>{x[2]=holder;},
  ]) {
    const data=mutateZeroXActions(input.data,a=>{const args=[...decodeFunctionData({abi:basic,data:a[fee.position]}).args];change(args);a[fee.position]=encodeFunctionData({abi:basic,functionName:"BASIC",args:args as any});});
    assert.throws(()=>verifyZeroXEncodedFee({...input,data}));negative++;
  }
  for(const change of [(a:Hex[])=>{a.splice(fee.position,1);},(a:Hex[])=>{a.push(a[fee.position]);},(a:Hex[])=>{a[fee.position]="0x38c9c147";}]) {
    assert.throws(()=>verifyZeroXEncodedFee({...input,data:mutateZeroXActions(input.data,change)}));negative++;
  }
  const opaque=mutateZeroXActions(input.data,a=>{a.splice(expected===sell?2:1,0,"0x12345678");});
  assert.equal(verifyZeroXEncodedFee({...input,data:opaque}).token,expected);
  assert.equal(inspectZeroXRoute({...input,data:opaque}).status,"ROUTE_INTROSPECTION_PARTIAL");positive++;
}
assert.notEqual(zeroXFeeAsset(weth,project),zeroAddress,"wrapped ETH is not native ETH");
assert.equal(toZeroXToken(zeroXFeeAsset(project,zeroAddress)),ZERO_X_NATIVE_TOKEN);
console.log(`Base-currency fees: ${positive} direction/opaque-route positives; ${negative} encoded-fee negatives (local synthetic).`);

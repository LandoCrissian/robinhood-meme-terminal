// Deterministic ABI fixtures, never live quote calldata. Runtime is public verified bytecode.
const { createRequire } = require('node:module');
const { encodeFunctionData, parseAbi, keccak256 } = createRequire(require('node:path').resolve(__dirname, '../../apps/web/package.json'))('viem');
const runtime = require('./fixtures/zerox-settler-runtime.json').runtime;
const settler = '0x0000000000000000000000000000000000012345';
const holder = '0x0000000000001ff3684f28c67538d4d072c22734';
const zero = '0x0000000000000000000000000000000000000000';
const native = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
const treasury = '0x61700479A4A1F62584Fd3ABA2c2b290EA727d2eC';
const provider = '0x0000000000000000000000000000000000023456';
const weth = '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73';
const holderAbi = parseAbi(['function exec(address operator,address token,uint256 amount,address target,bytes data) payable returns(bytes)']);
const settlerAbi = parseAbi(['function execute((address recipient,address buyToken,uint256 minAmountOut) slippage,bytes[] actions,bytes32 tag) payable returns(bool)']);
const actionsAbi = parseAbi(['function NATIVE_CHECK(uint256 deadline,uint256 msgValue)', 'function BASIC(address sellToken,uint256 bps,address pool,uint256 offset,bytes data)',
 'function TRANSFER_FROM(address recipient,((address token,uint256 amount) permitted,uint256 nonce,uint256 deadline) permit,bytes sig)',
 'function UNISWAPV3(address recipient,uint256 proportion,bytes path,uint256 amountOutMin)']);
const transferAbi = parseAbi(['function transfer(address to,uint256 amount) returns(bool)']);
function encodeQuote(body, recipient, marker = '0x12345678') {
  const nativeSell = body.sellToken.toLowerCase() === native;
  const basis = body.actionBasisForTest ?? 10000n;
  const action = (functionName,args) => encodeFunctionData({abi:actionsAbi,functionName,args});
  const basic = (token,rate,pool,offset,data) => action('BASIC',[token,rate,pool,offset,data]);
  const transfer = (token,rate,to) => token.toLowerCase()===native ? basic(token,rate,to,0n,'0x')
    : basic(token,rate,token,36n,encodeFunctionData({abi:transferAbi,functionName:'transfer',args:[to,0n]}));
  const actions = [nativeSell
    ? action('NATIVE_CHECK',[BigInt(Math.floor(Date.now()/1000)+600),BigInt(body.sellAmount)])
    : action('TRANSFER_FROM',[settler,{permitted:{token:body.sellToken,amount:BigInt(body.sellAmount)},nonce:0n,deadline:2n**64n-1n},'0x'])];
  const rmtFeeToken = body.fees?.integratorFee?.token ?? body.sellToken;
  const outputFee = rmtFeeToken.toLowerCase() !== body.sellToken.toLowerCase();
  if (!outputFee) actions.push(transfer(rmtFeeToken,basis/400n,treasury));
  const fee = body.fees?.zeroExFee;
  if(fee?.token.toLowerCase()===body.sellToken.toLowerCase()) actions.push(transfer(body.sellToken,basis*15n/10000n,provider));
  if(nativeSell) actions.push(basic(native,basis,weth,4n,'0xd0e30db0'+'0'.repeat(64)));
  const path = (nativeSell?weth:body.sellToken)+'00000bb8'+'0'.repeat(40)+(body.buyToken.toLowerCase()===native?weth:body.buyToken).slice(2);
  actions.push(action('UNISWAPV3',[settler,basis,path,0n]));
  if(body.buyToken.toLowerCase()===native) actions.push(basic(weth,basis,weth,4n,'0x2e1a7d4d'+'0'.repeat(64)));
  if(fee?.token.toLowerCase()===body.buyToken.toLowerCase()) actions.push(transfer(body.buyToken,basis*15n/10000n,provider));
  if (outputFee) actions.push(transfer(rmtFeeToken,basis/400n,treasury));
  const data = encodeFunctionData({ abi: settlerAbi, functionName: 'execute', args: [{ recipient,
    buyToken: body.buyToken, minAmountOut: BigInt(body.executableMinimumForTest ?? body.minBuyAmount) }, body.actionsForTest ?? actions, keccak256(marker)] });
  return body.transaction.to.toLowerCase() === holder ? encodeFunctionData({ abi: holderAbi, functionName: 'exec', args: [settler, nativeSell ? zero : body.sellToken, BigInt(body.sellAmount), settler, data] }) : data;
}
module.exports = { runtime, settler, encodeQuote };

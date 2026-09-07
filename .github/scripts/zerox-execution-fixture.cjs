// Deterministic ABI fixtures, never live quote calldata. Runtime is public verified bytecode.
const { createRequire } = require('node:module');
const { encodeFunctionData, parseAbi, keccak256 } = createRequire(require('node:path').resolve(__dirname, '../../apps/web/package.json'))('viem');
const runtime = require('./fixtures/zerox-settler-runtime.json').runtime;
const settler = '0x0000000000000000000000000000000000012345';
const holder = '0x0000000000001ff3684f28c67538d4d072c22734';
const zero = '0x0000000000000000000000000000000000000000';
const native = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
const holderAbi = parseAbi(['function exec(address operator,address token,uint256 amount,address target,bytes data) payable returns(bytes)']);
const settlerAbi = parseAbi(['function execute((address recipient,address buyToken,uint256 minAmountOut) slippage,bytes[] actions,bytes32 tag) payable returns(bool)']);
const actionsAbi = parseAbi(['function NATIVE_CHECK(uint256 deadline,uint256 msgValue)', 'function BASIC(address sellToken,uint256 bps,address pool,uint256 offset,bytes data)']);
function encodeQuote(body, recipient, marker = '0x12345678') {
  const nativeSell = body.sellToken.toLowerCase() === native;
  const actions = [encodeFunctionData({ abi: actionsAbi, functionName: 'NATIVE_CHECK', args: [BigInt(Math.floor(Date.now()/1000)+600), BigInt(nativeSell ? body.sellAmount : 0)] })];
  const data = encodeFunctionData({ abi: settlerAbi, functionName: 'execute', args: [{ recipient,
    buyToken: body.buyToken, minAmountOut: BigInt(body.executableMinimumForTest ?? body.minBuyAmount) }, actions, keccak256(marker)] });
  return body.transaction.to.toLowerCase() === holder ? encodeFunctionData({ abi: holderAbi, functionName: 'exec', args: [settler, nativeSell ? zero : body.sellToken, BigInt(body.sellAmount), settler, data] }) : data;
}
module.exports = { runtime, settler, encodeQuote };

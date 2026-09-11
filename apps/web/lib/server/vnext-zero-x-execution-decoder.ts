import { TradeExecutionFailure } from "../vnext/trade-failure";
import { decodeFunctionData, getAddress, parseAbi, toFunctionSelector, zeroAddress, type Address, type Hex } from "viem";
import { fromZeroXToken } from "../vnext/zero-x-settlement";

// RobinHoodSettler, official 0x commit 95184a23336b52d99aaa528c5b1259e3bb04eafe.
// Sourcify's recompiled runtime exactly matched eth_getCode on chain 4663.
// Settler._execute calls _checkSlippageAndTransfer AFTER all actions/fees.
// Unknown runtimes are NOT authorized by ABI compatibility alone.
export const ZERO_X_SLIPPAGE_SETTLER_RUNTIME_HASH = "0xb6c0bf3b83bc9ae4f6ed65a4f5f6c188eb3e4258d8d3b3705dff4ac02ed4a966";
const HOLDER = getAddress("0x0000000000001fF3684f28c67538d4D072C22734");
const holderAbi = parseAbi(["function exec(address operator,address token,uint256 amount,address target,bytes data) payable returns(bytes)"]);
const settlerAbi = parseAbi(["function execute((address recipient,address buyToken,uint256 minAmountOut) slippage,bytes[] actions,bytes32 tag) payable returns(bool)"]);
const earlySlippage = toFunctionSelector("CHECK_SLIPPAGE(bool)");

export function decodeZeroXExecutableMinimum(input: {
  target: Address; data: Hex; inputAsset: Address; outputAsset: Address;
  inputAmountAtomic: string; recipient: Address; valueAtomic: string;
}) {
  try {
    let target = input.target;
    let data = input.data;
    const native = input.inputAsset === zeroAddress;
    if (BigInt(input.valueAtomic) !== (native ? BigInt(input.inputAmountAtomic) : 0n)) throw new Error();
    if (getAddress(target) === HOLDER) {
      const decoded = decodeFunctionData({ abi: holderAbi, data });
      const [operator, token, amount, forwardedTarget, forwardedData] = decoded.args;
      if (amount.toString() !== input.inputAmountAtomic || getAddress(operator) !== getAddress(forwardedTarget)
        || getAddress(token) !== input.inputAsset || getAddress(forwardedTarget) === HOLDER) throw new Error();
      target = getAddress(forwardedTarget);
      data = forwardedData;
    } else if (!native) throw new Error();
    const { args: [slippage, actions] } = decodeFunctionData({ abi: settlerAbi, data });
    if (getAddress(slippage.recipient) !== getAddress(input.recipient)
      || fromZeroXToken(slippage.buyToken) !== input.outputAsset || slippage.minAmountOut <= 0n
      || actions.length === 0 || actions.length > 256
      // Reject early transfers: only the final, post-fee global check is admitted.
      || actions.some(action => action.length < 10 || action.slice(0, 10) === earlySlippage)) throw new Error();
    return { minimumAtomic: slippage.minAmountOut.toString(), settlerTarget: target };
  } catch {
    // Never include raw calldata or decoder exceptions in public diagnostics.
    throw new TradeExecutionFailure("EXECUTION_ENVELOPE_REJECTED");
  }
}

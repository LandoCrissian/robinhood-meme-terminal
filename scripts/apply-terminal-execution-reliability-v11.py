from pathlib import Path
import re


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected one exact match, found {count}: {old[:180]!r}")
    file.write_text(text.replace(old, new, 1))


def regex_once(path: str, pattern: str, replacement: str) -> None:
    file = Path(path)
    text = file.read_text()
    updated, count = re.subn(pattern, replacement, text, count=1, flags=re.S)
    if count != 1:
        raise SystemExit(f"{path}: expected one regex match, found {count}: {pattern[:180]!r}")
    file.write_text(updated)


SUSHI = "apps/web/app/external-sushi-quote-panel.tsx"
UNISWAP = "apps/web/app/external-uniswap-trade-panel.tsx"

for path in (SUSHI, UNISWAP):
    replace_once(
        path,
        'import { useTradeFeeEstimate } from "../lib/use-trade-fee-estimate";\n',
        'import { useTradeFeeEstimate } from "../lib/use-trade-fee-estimate";\n'
        'import { classifyTradeExecutionError } from "../lib/trade-execution-reliability";\n'
        'import { useTradeExecutionRecovery } from "../lib/use-trade-execution-recovery";\n'
        'import { useTradeQuoteFreshness } from "../lib/use-trade-quote-freshness";\n'
    )
    replace_once(
        path,
        'import type { AfterBuyProtectionSettings } from "../lib/after-buy-protection";\n',
        'import type { AfterBuyProtectionSettings } from "../lib/after-buy-protection";\n'
        'import { TradeExecutionStatus, TradePreflightFailure } from "./trade-execution-status";\n'
    )
    replace_once(
        path,
        '  const swapReceipt = useWaitForTransactionReceipt({ hash: swap.data, chainId: ROBINHOOD_CHAIN_ID });\n',
        ''
    )

amount_block = '''  const amountIn = useMemo(() => {
    if (!amount || !address) return 0n;
    try {
      if (side === "buy") return parseEther(amount);
      if (decimals === undefined) return 0n;
      return parseUnits(amount, decimals);
    } catch {
      return 0n;
    }
  }, [address, amount, decimals, side]);
'''

replace_once(
    SUSHI,
    amount_block,
    amount_block + '''  const execution = useTradeExecutionRecovery({
    wallet: address,
    token,
    pair,
    venue: "sushi",
    side,
    amountIn,
    submittedHash: swap.data
  });
  const swapReceipt = useWaitForTransactionReceipt({
    hash: execution.trackedHash,
    chainId: ROBINHOOD_CHAIN_ID,
    confirmations: 1
  });
  const approvalConfirmed = approvalReceipt.isSuccess && approvalReceipt.data?.status === "success";
  const approvalReverted = approvalReceipt.isSuccess && approvalReceipt.data?.status === "reverted";
  const swapConfirmed = swapReceipt.isSuccess && swapReceipt.data?.status === "success";
  const swapReverted = swapReceipt.isSuccess && swapReceipt.data?.status === "reverted";
'''
)

replace_once(
    UNISWAP,
    amount_block,
    amount_block + '''  const execution = useTradeExecutionRecovery({
    wallet: address,
    token,
    pair,
    venue: isV4 ? "uniswap-v4" : "uniswap-v3",
    side,
    amountIn,
    submittedHash: swap.data
  });
  const swapReceipt = useWaitForTransactionReceipt({
    hash: execution.trackedHash,
    chainId: ROBINHOOD_CHAIN_ID,
    confirmations: 1
  });
  const approvalConfirmed = approvalReceipt.isSuccess && approvalReceipt.data?.status === "success";
  const approvalReverted = approvalReceipt.isSuccess && approvalReceipt.data?.status === "reverted";
  const swapConfirmed = swapReceipt.isSuccess && swapReceipt.data?.status === "success";
  const swapReverted = swapReceipt.isSuccess && swapReceipt.data?.status === "reverted";
'''
)

replace_once(
    SUSHI,
    '''  useEffect(() => {
    if (!approvalReceipt.isSuccess) return;
    setMessage("Exact sell approval confirmed. Review and submit the swap next.");
    void allowance.refetch();
    setRefresh((value) => value + 1);
  }, [approvalReceipt.isSuccess]);

  useEffect(() => {
    if (!swapReceipt.isSuccess || !swap.data) return;
    setMessage("Sushi swap confirmed on Robinhood Chain.");
    if (handledSwap.current === swap.data) return;
    handledSwap.current = swap.data;
    onSwapConfirmed?.();
    void Promise.all([tokenBalance.refetch(), nativeBalance.refetch(), allowance.refetch()])
      .then(([refreshedToken]) => {
        const pending = pendingBuy.current;
        if (side !== "buy" || !pending || pending.beforeBalance === undefined || refreshedToken.data === undefined || decimals === undefined) return;
        const snapshot = confirmedBuyProtectionSnapshot({
          beforeBalance: pending.beforeBalance,
          afterBalance: refreshedToken.data,
          tokenDecimals: decimals,
          amountInWei: pending.amountInWei,
          ethUsd: pending.ethUsd,
          marketPriceUsd: market.priceUsd
        });
        if (snapshot) {
          setConfirmedBuy(snapshot);
          setConfirmedBuyProtectionSettings(pending.protectionSettings);
        }
      });
  }, [swapReceipt.isSuccess]);
''',
    '''  useEffect(() => {
    if (approvalConfirmed) {
      setMessage("Exact sell approval confirmed. Review and submit the swap next.");
      void allowance.refetch();
      setRefresh((value) => value + 1);
      return;
    }
    if (approvalReverted) execution.fail("Exact sell approval transaction reverted onchain.");
  }, [approvalConfirmed, approvalReverted]);

  useEffect(() => {
    if (swapReverted) {
      execution.fail("Sushi swap receipt status reverted onchain.");
      setQuote(undefined);
      setRefresh((value) => value + 1);
      return;
    }
    if (!swapConfirmed || !execution.trackedHash) return;
    execution.confirm();
    if (handledSwap.current === execution.trackedHash) return;
    handledSwap.current = execution.trackedHash;
    onSwapConfirmed?.();
    void Promise.all([tokenBalance.refetch(), nativeBalance.refetch(), allowance.refetch()])
      .then(([refreshedToken]) => {
        const pending = pendingBuy.current;
        if (side !== "buy" || !pending || pending.beforeBalance === undefined || refreshedToken.data === undefined || decimals === undefined) return;
        const snapshot = confirmedBuyProtectionSnapshot({
          beforeBalance: pending.beforeBalance,
          afterBalance: refreshedToken.data,
          tokenDecimals: decimals,
          amountInWei: pending.amountInWei,
          ethUsd: pending.ethUsd,
          marketPriceUsd: market.priceUsd
        });
        if (snapshot) {
          setConfirmedBuy(snapshot);
          setConfirmedBuyProtectionSettings(pending.protectionSettings);
        }
      });
  }, [swapConfirmed, swapReverted, execution.trackedHash]);

  useEffect(() => {
    if (approval.error) execution.fail(approval.error);
  }, [approval.error]);

  useEffect(() => {
    if (swap.error) execution.fail(swap.error);
  }, [swap.error]);

  useEffect(() => {
    if (swapReceipt.error && execution.trackedHash) execution.holdForReconciliation(swapReceipt.error);
  }, [swapReceipt.error, execution.trackedHash]);
'''
)

replace_once(
    UNISWAP,
    '''  useEffect(() => {
    if (!approvalReceipt.isSuccess) return;
    setMessage(
      approvalStage === "token" && isV4
        ? "Exact token approval confirmed. Continue to the short-lived Permit2 router approval."
        : "Exact sell approval confirmed. Review and submit the swap next."
    );
    void Promise.all([allowance.refetch(), permit2Allowance.refetch()]);
  }, [approvalReceipt.isSuccess, approvalStage, isV4]);

  useEffect(() => {
    if (!swapReceipt.isSuccess || !swap.data) return;
    setMessage("Swap confirmed on Robinhood Chain.");
    if (handledSwap.current === swap.data) return;
    handledSwap.current = swap.data;
    onSwapConfirmed?.();
    void Promise.all([tokenBalance.refetch(), nativeBalance.refetch(), allowance.refetch(), permit2Allowance.refetch()])
      .then(([refreshedToken]) => {
        const pending = pendingBuy.current;
        if (side !== "buy" || !pending || pending.beforeBalance === undefined || refreshedToken.data === undefined || decimals === undefined) return;
        const snapshot = confirmedBuyProtectionSnapshot({
          beforeBalance: pending.beforeBalance,
          afterBalance: refreshedToken.data,
          tokenDecimals: decimals,
          amountInWei: pending.amountInWei,
          ethUsd: pending.ethUsd,
          marketPriceUsd: market.priceUsd
        });
        if (snapshot) {
          setConfirmedBuy(snapshot);
          setConfirmedBuyProtectionSettings(pending.protectionSettings);
        }
      });
  }, [swapReceipt.isSuccess]);
''',
    '''  useEffect(() => {
    if (approvalConfirmed) {
      setMessage(
        approvalStage === "token" && isV4
          ? "Exact token approval confirmed. Continue to the short-lived Permit2 router approval."
          : "Exact sell approval confirmed. Review and submit the swap next."
      );
      void Promise.all([allowance.refetch(), permit2Allowance.refetch()]);
      return;
    }
    if (approvalReverted) execution.fail("Exact sell approval transaction reverted onchain.");
  }, [approvalConfirmed, approvalReverted, approvalStage, isV4]);

  useEffect(() => {
    if (swapReverted) {
      execution.fail("Uniswap swap receipt status reverted onchain.");
      setQuote(undefined);
      setRefresh((value) => value + 1);
      return;
    }
    if (!swapConfirmed || !execution.trackedHash) return;
    execution.confirm();
    if (handledSwap.current === execution.trackedHash) return;
    handledSwap.current = execution.trackedHash;
    onSwapConfirmed?.();
    void Promise.all([tokenBalance.refetch(), nativeBalance.refetch(), allowance.refetch(), permit2Allowance.refetch()])
      .then(([refreshedToken]) => {
        const pending = pendingBuy.current;
        if (side !== "buy" || !pending || pending.beforeBalance === undefined || refreshedToken.data === undefined || decimals === undefined) return;
        const snapshot = confirmedBuyProtectionSnapshot({
          beforeBalance: pending.beforeBalance,
          afterBalance: refreshedToken.data,
          tokenDecimals: decimals,
          amountInWei: pending.amountInWei,
          ethUsd: pending.ethUsd,
          marketPriceUsd: market.priceUsd
        });
        if (snapshot) {
          setConfirmedBuy(snapshot);
          setConfirmedBuyProtectionSettings(pending.protectionSettings);
        }
      });
  }, [swapConfirmed, swapReverted, execution.trackedHash]);

  useEffect(() => {
    if (approval.error) execution.fail(approval.error);
  }, [approval.error]);

  useEffect(() => {
    if (swap.error) execution.fail(swap.error);
  }, [swap.error]);

  useEffect(() => {
    if (swapReceipt.error && execution.trackedHash) execution.holdForReconciliation(swapReceipt.error);
  }, [swapReceipt.error, execution.trackedHash]);
'''
)

replace_once(
    SUSHI,
    '''  const quoteIsFresh = Boolean(
    quote
    && BigInt(quote.quoteExpiresAt) > BigInt(Math.floor(Date.now() / 1000) + 15)
    && quote.amountIn === amountIn.toString()
  );
''',
    '''  const quoteFreshness = useTradeQuoteFreshness({
    deadline: quote?.quoteExpiresAt,
    bufferSeconds: 15,
    enabled: Boolean(quote && quote.amountIn === amountIn.toString()),
    onRefreshNeeded: () => {
      setQuote(undefined);
      setStatus("loading");
      setRefresh((value) => value + 1);
    }
  });
  const quoteIsFresh = Boolean(
    quote
    && quote.amountIn === amountIn.toString()
    && quoteFreshness.isFresh
  );
'''
)

replace_once(
    UNISWAP,
    '''  const quoteIsFresh = Boolean(
    quote
    && BigInt(quote.deadline) > BigInt(Math.floor(Date.now() / 1000) + 30)
    && quote.amountIn === amountIn.toString()
  );
''',
    '''  const quoteFreshness = useTradeQuoteFreshness({
    deadline: quote?.deadline,
    bufferSeconds: 30,
    enabled: Boolean(quote && quote.amountIn === amountIn.toString()),
    onRefreshNeeded: () => {
      setQuote(undefined);
      setStatus("loading");
      setRefresh((value) => value + 1);
    }
  });
  const quoteIsFresh = Boolean(
    quote
    && quote.amountIn === amountIn.toString()
    && quoteFreshness.isFresh
  );
'''
)

for path in (SUSHI, UNISWAP):
    replace_once(
        path,
        '  const busy = approval.isPending || approvalReceipt.isLoading || swap.isPending || swapReceipt.isLoading;\n'
        '  const preflightReady = isTradePreflightReady(feeEstimate);\n',
        '  const approvalConfirmationUnavailable = Boolean(approval.data && approvalReceipt.error);\n'
        '  const busy = approval.isPending || approvalReceipt.isLoading || swap.isPending || swapReceipt.isLoading\n'
        '    || execution.unresolved || approvalConfirmationUnavailable;\n'
        '  const preflightReady = isTradePreflightReady(feeEstimate);\n'
        '  const preflightFailure = feeEstimate.status === "unavailable" ? feeEstimate.failure : undefined;\n'
    )

regex_once(
    SUSHI,
    r'  const submit = \(\) => \{.*?\n  \};\n\n  const quoteState:',
    '''  const submit = () => {
    setMessage("");
    execution.clearFailure();
    if (execution.unresolved || approvalConfirmationUnavailable) return;
    if (!quoteIsFresh) {
      setMessage("The protected Sushi quote expired before wallet review. RMT is requesting a fresh route.");
      setQuote(undefined);
      setStatus("loading");
      setRefresh((value) => value + 1);
      return;
    }
    if (!accountReady || !address || chainId !== ROBINHOOD_CHAIN_ID || !quote || insufficient || busy || !confidenceReady || !preflightReady) return;
    recordExperienceStage("wallet_review_started");
    if (needsApproval) {
      approval.writeContract({
        address: token,
        abi: erc20Abi,
        functionName: "approve",
        args: [SUSHI_RED_SNWAPPER, amountIn],
        chainId: ROBINHOOD_CHAIN_ID
      });
      return;
    }
    if (quote.executable !== true || !("router" in quote) || !("calldata" in quote)) return;
    if (side === "buy") {
      pendingBuy.current = {
        beforeBalance: tokenBalance.data,
        amountInWei: amountIn,
        ethUsd: feeEstimate.ethUsd,
        protectionSettings: { ...afterBuyProtection.settings }
      };
    }
    swap.sendTransaction({
      account: address,
      chainId: ROBINHOOD_CHAIN_ID,
      to: quote.router,
      data: quote.calldata,
      value: BigInt(quote.value)
    });
  };

  const quoteState:'''
)

regex_once(
    UNISWAP,
    r'  const submit = \(\) => \{.*?\n  \};\n\n  const quoteState:',
    '''  const submit = () => {
    setMessage("");
    execution.clearFailure();
    if (execution.unresolved || approvalConfirmationUnavailable) return;
    if (!quoteIsFresh) {
      setMessage("The protected Uniswap quote expired before wallet review. RMT is requesting a fresh route.");
      setQuote(undefined);
      setStatus("loading");
      setRefresh((value) => value + 1);
      return;
    }
    if (!accountReady || !address || chainId !== ROBINHOOD_CHAIN_ID || !quote || insufficient || busy || !confidenceReady || !preflightReady) return;
    recordExperienceStage("wallet_review_started");
    if (needsTokenApproval) {
      setApprovalStage("token");
      approval.writeContract({
        address: token,
        abi: erc20Abi,
        functionName: "approve",
        args: [tokenApprovalSpender, amountIn],
        chainId: ROBINHOOD_CHAIN_ID
      });
      return;
    }
    if (needsPermit2Approval) {
      setApprovalStage("permit2");
      approval.writeContract({
        address: PERMIT2_ADDRESS,
        abi: permit2Abi,
        functionName: "approve",
        args: [
          token,
          ROBINHOOD_UNIVERSAL_ROUTER,
          amountIn > MAX_UINT160 ? MAX_UINT160 : amountIn,
          Math.floor(Date.now() / 1000) + 1_200
        ],
        chainId: ROBINHOOD_CHAIN_ID
      });
      return;
    }
    if (side === "buy") {
      pendingBuy.current = {
        beforeBalance: tokenBalance.data,
        amountInWei: amountIn,
        ethUsd: feeEstimate.ethUsd,
        protectionSettings: { ...afterBuyProtection.settings }
      };
    }
    swap.sendTransaction({
      account: address,
      chainId: ROBINHOOD_CHAIN_ID,
      to: quote.router,
      data: quote.calldata,
      value: BigInt(quote.value)
    });
  };

  const quoteState:'''
)

for path, pending_label, confirming_label in (
    (SUSHI, "Sushi transaction pending — do not resubmit", "Confirming Sushi swap…"),
    (UNISWAP, "Uniswap transaction pending — do not resubmit", "Confirming swap…")
):
    regex_once(
        path,
        r'  const buttonLabel = busy\n    \? approval\.isPending \|\| approvalReceipt\.isLoading \? "Confirming exact approval…" : "[^"]+"',
        '  const buttonLabel = execution.unresolved\n'
        f'    ? "{pending_label}"\n'
        '    : approvalConfirmationUnavailable\n'
        '      ? "Approval status unknown — check chain"\n'
        '      : busy\n'
        f'        ? approval.isPending || approvalReceipt.isLoading ? "Confirming exact approval…" : "{confirming_label}"'
    )

for path in (SUSHI, UNISWAP):
    replace_once(
        path,
        '          <button\n            className={`externalUniswapSubmit ${side}`}\n',
        '          <TradePreflightFailure failure={preflightFailure} />\n'
        '          <button\n            className={`externalUniswapSubmit ${side}`}\n'
    )

status_block = '''      {approvalConfirmationUnavailable && approval.data && (
        <TradeExecutionStatus
          status="confirmation-unavailable"
          hash={approval.data}
          failure={classifyTradeExecutionError(approvalReceipt.error)}
          rawError={approvalReceipt.error?.message}
          onRecheck={() => void approvalReceipt.refetch()}
        />
      )}
      {execution.status !== "idle" && (
        <TradeExecutionStatus
          status={execution.status}
          hash={execution.trackedHash ?? (approvalReverted ? approval.data : undefined)}
          record={execution.record}
          recovered={execution.recovered}
          failure={execution.failure}
          rawError={execution.rawError}
          onRecheck={execution.trackedHash ? () => void swapReceipt.refetch() : undefined}
        />
      )}
'''

for path in (SUSHI, UNISWAP):
    regex_once(
        path,
        r'      \{\(approval\.error \|\| approvalReceipt\.error \|\| swap\.error \|\| swapReceipt\.error\) && \(\n        <p className="externalUniswapError" role="alert">\n          \{approval\.error\?\.message \|\| approvalReceipt\.error\?\.message \|\| swap\.error\?\.message \|\| swapReceipt\.error\?\.message\}\n        </p>\n      \)\}\n',
        status_block
    )
    replace_once(path, 'swapReceipt.isSuccess && swap.data && (', 'swapConfirmed && execution.trackedHash && (')
    replace_once(path, '${EXPLORER}/tx/${swap.data}', '${EXPLORER}/tx/${execution.trackedHash}')
    replace_once(
        path,
        'side === "buy" && swapReceipt.isSuccess && swap.data && address && confirmedBuy && (',
        'side === "buy" && swapConfirmed && execution.trackedHash && address && confirmedBuy && ('
    )
    replace_once(path, 'transactionHash={swap.data}', 'transactionHash={execution.trackedHash}')
    replace_once(path, 'success={swapReceipt.isSuccess}', 'success={swapConfirmed}')

for path in (SUSHI, UNISWAP):
    text = Path(path).read_text()
    if 'useTradeExecutionRecovery' not in text or 'TradeExecutionStatus' not in text or 'swapReceipt.data?.status === "success"' not in text:
        raise SystemExit(f"{path}: execution reliability integration is incomplete")

print("terminal execution reliability v11 patch applied")

# Operations Safe #1 standalone release proposal

**Owner policy adoption required.** The approval recorded in issue #649 sets the fee ceiling conditional on the existing release gates. Task 061 authorizes implementation and evaluation of this narrower gate. The evaluator records readiness evidence without granting transaction approval. [Fee-ceiling approval](https://github.com/LandoCrissian/robinhood-meme-terminal/issues/649#issuecomment-6936656732) · [Task 061](https://github.com/LandoCrissian/robinhood-meme-terminal/issues/654)

## Exact scope

| Field | Reviewed value |
| --- | --- |
| Network and payer | Robinhood Chain 4663, `0x7E8E7D3Af28584a8b9eEDDbE16CD3308Bd1e76cA`, pinned MetaMask EIP-7702 delegation, type 2 |
| Destination and call | `0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67`, `createProxyWithNonce(address,bytes,uint256)`, zero ETH |
| Calldata Keccak-256 | `0x64c42b60490759e71c4777faab3ac157f5c565b6b379629bdaaec7e5352c2250` |
| Counterfactual Operations Safe | `0xAF9F10258b091719618c19D057F9cDAB72eFFd8b`, SafeL2 1.4.1, existing three governance owners, two approvals |
| Fixed network fee ceiling | 15,677,394,780,000 wei, from 391,739 gas at 40,020,000 wei per gas, zero priority fee |

The initializer verifies the pinned singleton and fallback handler, owner order, threshold and salt. The setup delegatecall target and data are empty and the payment fields are zero. The call reaches the pinned factory and standard Safe setup. Reserve, the RMT engine, fee activation, treasury funding and broader Safe actions are outside this proposal. The launch-engine release still requires both strict analysis jobs and the existing independent-review evidence. [Treasury configurations](../rmt-task046/treasury-safe-initializers.json) · [Launch-engine security](../../SECURITY.md)

## Before a separate transaction decision

1. Obtain explicit adoption of this exact standalone policy for Operations Safe #1. The original fee ceiling and identities remain binding.
2. Run `pnpm evaluate:operations-safe` when the owner is ready. Require fresh 4663 agreement on the sender, confirmed and pending nonce, delegation and runtime, infrastructure runtimes, decoded call, vacancy, fee components and approved ceiling. A mismatch, expired observation or over-ceiling recommendation stops consideration. An observed matching state has a short lifetime and can be refreshed when needed.
3. Request separate authorization for that exact current transaction. A technical pass alone conveys no signing or broadcast authority. Any subsequent wallet request must bind the same type, chain, sender, nonce, calldata, value and fee fields without substitutions. Review the wallet's effective signing capability through the separately authorized path.
4. After any separately authorized future execution, bind the canonical receipt to the original exact request. Check the pinned factory `ProxyCreation` log, predicted proxy, singleton, owners, threshold, module and guard state, and fallback handler. Keep the address as a prediction until verified receipt evidence is available. Keep the other queued operations under their own approvals.

The `operations-safe` CI job tests this evaluator with deterministic evidence. A current mainnet observation is a separate read-only check. CI and fork fixtures cannot approve the policy or a live transaction.

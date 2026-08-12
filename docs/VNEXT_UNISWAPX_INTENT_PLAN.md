# VNext UniswapX intent-plan foundation

Status: **server-only codec complete; wallet signing and order submission disabled**

This slice turns an already decoded and verified Robinhood Chain Dutch V3 order into a bounded authorization-plan model. It does not admit UniswapX to wallet authorization and does not change production routing.

The plan binds the exact chain, input and output assets, atomic amounts, recipient, protected output, order hash, Permit2 payload hash, Uniswap Permit2 deployment, Dutch V3 reactor, nonce and deadline. Parsing recomputes both the EIP-712 Permit2 payload hash and the Dutch V3 witness hash. It rejects changed domains, types, spender/reactor, swapper, recipient, input economics, output protection, source evidence, expiry or enablement state.

The client-safe plan deliberately excludes the encoded order and provider submission payload. Both `walletSignatureEnabled` and `orderSubmissionEnabled` are literal `false`, and `orderSubmissionRef` remains `null`.

Before a later release may request a wallet signature, RMT still needs:

1. an authenticated server endpoint that creates the plan from a fresh provider quote;
2. a short-lived server-side store for the exact encoded order and immutable submission payload, addressed only by an opaque reference;
3. a wallet-specific EIP-712 signing flow tested across supported Privy/external wallets;
4. signature recovery against the exact connected swapper before submission;
5. unchanged order-byte submission, fill tracking, expiry, cancellation/recovery semantics and provider kill switches;
6. adversarial preview rehearsal and separately authorized small-value mainnet proof.

Until those gates pass, direct Uniswap and Sushi remain the executable fallbacks and UniswapX remains observation-only.

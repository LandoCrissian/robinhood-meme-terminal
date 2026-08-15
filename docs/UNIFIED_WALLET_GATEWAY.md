# RMT unified wallet gateway

**Status: CURRENT — external-wallet connection boundary**

## Purpose

RMT exposes one terminal-level wallet control while preserving an exact external signing wallet for VNext. This gateway coordinates Privy connection/authentication with the Privy Wagmi adapter; it is not an execution provider and contains no signing or transaction-submission capability.

## Admission and discovery

The supported Privy wallet order is centralized as:

1. MetaMask
2. Coinbase Wallet
3. detected Ethereum wallets
4. WalletConnect

`detected_ethereum_wallets` is Privy's EIP-6963 discovery surface. Rabby is admitted through that supported surface on desktop and inside Rabby's mobile browser; RMT does not use Privy's deprecated `rabby_wallet` identifier. A wallet in-app browser narrows its connection prompt to the injected EIP-6963 wallet instead of reopening the general wallet catalog. A normal mobile Safari/Chrome session has no injected extension, so RMT offers explicit MetaMask and Rabby app handoffs that preserve the exact RMT URL, plus WalletConnect for other supported wallets.

## Exact active-wallet identity

An address alone does not identify a signing connector. MetaMask and Rabby can expose the same imported address at the same time. RMT therefore qualifies the browser-session wallet selection by:

- connector type;
- wallet client type;
- EIP-6963 reported identity;
- address.

The selected Privy `ConnectedWallet` is explicitly bound into Wagmi. If multiple connectors expose the active address and RMT has no exact session choice, the terminal fails closed and asks the trader to choose. It never silently chooses the first provider.

The preference is browser-session state only. It is not a key, signature, authorization or durable user profile.

## Authentication and trading boundary

- The terminal signer must be an external Ethereum wallet.
- Privy and Privy V2 embedded wallets are excluded from terminal signing.
- Terminal connection first connects an external wallet, then requests that exact wallet's SIWE authentication. It does not route traders through email, Google, passkey or embedded-wallet creation.
- A newly connected wallet is authenticated or linked before it becomes the selected trading wallet, preserving the server's exact authenticated-recipient check.
- The wallet owner still reviews and signs every approval and trade.
- Disconnect clears the selected connector, Wagmi connection and Privy session.

## Explicitly unchanged

This gateway does not change quote math, route ranking, provider admission, strict verification, approval amounts, calldata, wallet submission, recovery, Across funding, fee policy, treasury configuration or production environment gates. The separate MetaMask Agent Wallet/operator foundation is not part of this user-wallet path.

## Release evidence still required

Before calling the completion-gate wallet item complete, exercise supported desktop and mobile environments with MetaMask, Rabby/EIP-6963 and WalletConnect. Verify exact connector switching when two extensions expose the same address, wrong-network recovery, explicit signing, and reconnect behavior without changing production execution gates.

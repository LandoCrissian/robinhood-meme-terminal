# Robinhood Chain Testnet Deployment

This runbook documents the lightweight public RMT alpha stack currently used on Robinhood Chain testnet.

```text
TestnetGraduationAdapter
→ LowCostMemeLaunchFactoryV3
→ fixed-supply token + bonding-curve market + reward vault per launch
```

## What is live

- wallet-signed token launches
- fixed one-billion-token supply held by each market
- bonding-curve buys and sells
- a 1% market fee
- Simple and Community reward presets
- onchain reward claims
- factory launch and market trade feeds

## What is intentionally disabled

The lightweight `TestnetGraduationAdapter` always rejects graduation. The public alpha therefore does **not** create a DEX pool or migrate liquidity. Its configured target is intentionally unreachable so curve trading can be tested without accidentally invoking an incomplete migration path.

The repository also contains a guarded V4 graduation prototype. It is not the adapter behind the current public alpha and must not be described as an official or production Robinhood Chain DEX integration.

## Safety requirements

- Use a dedicated testnet-only wallet.
- Never commit or paste a private key or seed phrase.
- Confirm the RPC reports chain ID `46630` before broadcasting.
- Treat test ETH as valueless test infrastructure.
- Record every deployed address, transaction hash, block number, and source commit.
- Do not enable mainnet deployment without economic review, independent contract review, and a verified external DEX adapter.

## Public alpha deployment

The current verified factory fallback is recorded in `apps/web/lib/contracts.ts` together with its deployment start block. Hosting may override the factory with:

```bash
NEXT_PUBLIC_FACTORY_ADDRESS=0x...
NEXT_PUBLIC_FACTORY_START_BLOCK=...
```

After any deployment change, rebuild the web application and confirm:

1. the factory bytecode exists on chain `46630`
2. `launchSimple` and `launchCommunity` create a token, market, and reward vault
3. the token appears in Fresh launches
4. the token detail page resolves its market and vault from the factory event
5. buy and sell quotes execute with slippage and deadline protection
6. market fees accrue in the reward vault
7. an eligible wallet can claim its reward
8. every explorer link points to Robinhood Chain testnet

## Contract validation

```bash
cd packages/contracts
forge fmt --check
forge build
forge build --sizes --skip script --skip test
forge test -vvv
```

## Mainnet gate

Do not reuse the public alpha's disabled graduation adapter or test economics on mainnet. Mainnet requires a separately reviewed configuration, production DEX integration, locked governance/treasury controls, monitoring, an indexer, incident procedures, and an explicit deployment authorization.

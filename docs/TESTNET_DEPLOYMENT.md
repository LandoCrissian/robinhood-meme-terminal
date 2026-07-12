# Robinhood Chain Testnet Deployment

This runbook deploys `MemeLaunchFactory` to Robinhood Chain testnet only.

The testnet factory uses immutable low-value economics so the complete buy, graduation, and V4 migration loop can be exercised without pretending test assets have value:

- 1% curve fee
- 0.01 test ETH initial virtual reserve
- 1.073 billion virtual token reserve
- 0.001 test ETH graduation target

These are test parameters, not a mainnet proposal. Mainnet economics remain unset pending simulation and review.

## Safety requirements

- Use a dedicated testnet-only wallet.
- Never commit a private key or seed phrase.
- Confirm the RPC reports chain ID `46630` before broadcasting.
- Do not set `NEXT_PUBLIC_FACTORY_ADDRESS` until bytecode and `launchCount()` are verified.

## 1. Prepare the deployer

Fund a dedicated EVM wallet with Robinhood Chain testnet ETH using the currently documented official faucet or bridge flow.

Set the private key only in the current shell:

```bash
export DEPLOYER_PRIVATE_KEY=0x...
```

Optionally override the official testnet RPC:

```bash
export ROBINHOOD_TESTNET_RPC_URL=https://rpc.testnet.chain.robinhood.com/
```

## 2. Build and test

```bash
cd packages/contracts
forge fmt --check
forge build --sizes
forge test -vvv
```

## 3. Broadcast

```bash
bash scripts/deploy-testnet.sh
```

The script refuses to broadcast unless the RPC returns chain ID `46630`.

## 4. Record the deployment

From the Foundry broadcast output, record:

- factory contract address
- deployment transaction hash
- deployer address
- chain ID
- block number
- source commit SHA

Do not commit private keys or raw signed transactions.

## 5. Smoke test

```bash
export FACTORY_ADDRESS=0x...
bash scripts/smoke-test-factory.sh
```

The smoke test confirms:

- the RPC is Robinhood Chain testnet
- bytecode exists at the address
- `launchCount()` can be read

## 6. Configure the web application

Set the deployment address in the web hosting environment:

```bash
NEXT_PUBLIC_FACTORY_ADDRESS=0x...
```

Rebuild the application after changing this value. The browser launch button remains disabled when the address is missing or invalid.

## 7. First test launch

Use non-production treasury addresses and a disposable test token. Confirm that one transaction creates:

- a fixed-supply token
- a token-specific reward vault
- a `TokenLaunched` event containing both addresses

Only after the event, token balances, reward recipients, and claim accounting are verified should the deployment be treated as usable for the alpha.

# Private 2 ETH curve owner test

The review fixture runs on a fresh, in-memory Anvil chain 31337 forked from Base Sepolia at the pinned block in [the deployment identities fixture](../packages/contracts/test/fixtures/rmt-v4-deployment-identities.json). It uses official v4 testnet contracts and synthetic ETH. The local economics are 0.0004 ETH to the fixture operating recipient for creation, 2 ETH backing at graduation, 60/40 supply, a 1% curve trading fee, and 90/5/5 distribution of collected curve fees. Liquidity is permanently held by the graduation engine. These values and synthetic addresses are for review. The manual production LP collection proposal remains a minimum of twice the estimated transaction cost.

## Windows setup

Use a trusted private Wi-Fi network with the Windows operator and iPhone attached, and a fresh externally owned test-only wallet. The phone must be able to reach another device on that network. Use the Windows host's exact private IPv4 address and the phone's current Wi-Fi IPv4 address. The [gateway](../apps/web/scripts/launchpad-preview-gateway.ts) binds to the selected private interface and accepts only the configured peer. Both Next and administrative Anvil listen on loopback. Leave the router, port forwarding, public tunnels and firewall exposure unchanged. If the phone cannot reach the service with the existing private-network policy, stop the session.

From the branch root on Windows with PowerShell 7.4 or later, Node 22, pnpm 10.12.1, the pinned contract dependencies, Foundry and the checksum-verified solc 0.8.26 input described in the [contract review handoff](RMT_CURVE_TASK021_AUDIT_HANDOFF.md):

```powershell
pnpm install --frozen-lockfile
pnpm --filter web exec next build
./scripts/start-curve-owner-preview.ps1 -Address '<Windows IPv4>' `
  -PhoneAddress '<iPhone Wi-Fi IPv4>' -Wallet '<test-only public address>' `
  -Anvil '<absolute path to anvil.exe>' -Solc '<absolute path to verified solc>'
```

Leave the PowerShell session open. It prints the HTTPS origin, expiration, TLS profile and SHA-256 root fingerprint, along with file paths for the short-lived access code and the wallet RPC capability. Transfer the profile and access information privately to the phone owner. The wallet RPC URL contains a credential. Keep it out of chat, logs, screenshots and tickets. The session accepts one wallet, verifies chain 31337 and the deployed identities, enforces request limits, and accepts only signed transactions within the reviewed fixture policy. Routine shutdown or expiry closes the listeners and removes the session access files and TLS private key.

## iPhone acceptance

1. Verify the certificate fingerprint with the operator through a trusted channel. Install the session profile and enable full trust for its root under Settings → General → About → Certificate Trust Settings. Open the exact HTTPS origin in MetaMask's in-app browser. Unlock it with the private access code. Stop on a TLS warning, an unexpected origin or a network other than the configured test chain. [Apple certificate trust](https://support.apple.com/en-us/102390)
2. Connect the fresh test-only account. Add or switch to chain ID **31337** with the exact private HTTPS RPC printed by the fixture and ETH as the symbol. Check the connected account before every confirmation. MetaMask can add a custom network, but acceptance of this exact TLS setup, local route and capability URL is a physical-device check. [MetaMask custom networks](https://support.metamask.io/configure/networks/how-to-add-a-custom-network-rpc/)
3. Create a test token. Check the disclosed **0.0004 ETH** before signing and verify the receipt. Try rejecting a wallet prompt first. During a subsequent test, close or background the browser after submitting, capture the transaction hash from wallet activity and use **Recover wallet request** on return. Confirm the hash settles once. If a receipt or native trace is unavailable, preserve the pending request and let the operator diagnose it.
4. Buy and sell a small amount, verifying the account, quote, any limited approval and confirmed settlement. Open the launch fee information. Compare creator and platform fee buckets against the confirmed trade evidence. Creator claims use the connected creator account. The platform recipients are synthetic fixture accounts.
5. Agree explicitly to each local migration simulation with the Windows operator. Using the `LocalAdminRpc`, fixture `factory` from the deployment JSON, and the creator and token addresses, run this once per transition:

   ```powershell
   node packages/contracts/scripts/validate-curve-graduation-4663.mjs `
     --rpc '<LocalAdminRpc>' --solc '<verified solc>' --backing-wei 2000000000000000000 `
     --owner-test --simulate-creator --migrate-token '<token>' --creator '<creator>' --factory '<factory>'
   ```

   The command uses temporary local impersonation of the explicitly identified creator and fixture reviewers and advances the fork clock through the notice delay. No creator key is requested. Reload the token page after each transition, check V1 → V2 → V3 history and verify the same token and backing. Recover a pending transaction from the previous engine, if applicable. Record that governance activity as simulated.
6. Fill the curve to its 2 ETH backing threshold. A test buy budget of 3 ETH leaves room for fees and an unused-input refund. Verify the graduated pool, full PoolKey, original position custody and funded liquidity before swapping. Buy and sell via v4, including the scoped token and router approvals. Review accrued LP fees and manually collect and claim with the test assets. If fees are dust, record a manual deferral separately from a custody failure. Check that the position owner and principal liquidity remain the same after claims.
7. Close the session. Remove its RPC/network from MetaMask if it is no longer needed, remove the temporary root profile from the phone, and discard the access files. Preserve only redacted evidence such as local transaction and block hashes, UI screenshots with secrets absent, and outcomes.

## Index and provider operations

The local app uses one SQLite writer in the per-session folder. It verifies and indexes in bounded ranges when queried. For a repeatable restore drill while the fixture is still running, use the [Task 022 snapshot and restore commands](RMT_CURVE_TASK022_OPERATIONS.md#indexing-backups-and-incident-response) with that session's same curve pins and anchor, a fresh destination and authenticated SHA-256. Recheck canonical state before accepting a restored cursor. The SQLite snapshot preserves indexed data, and the in-memory Anvil state exists only for the life of its process. A new fixture requires a fresh store.

The Task 023 read-only probe at Robinhood block **113412054** observed matching block hash and state root from Robinhood public, Pocket, dRPC and Pinax. All four agreed on the sampled receipt and swap log. Pocket, dRPC and Pinax returned the pinned historical runtime by block hash and the same sampled native payout trace. Robinhood public returned a historical-state error and no trace method. PublicNode and dRPC separately observed the Ethereum batch delivery for batch 391069. Exact Robinhood L2 replay through that batch remains **unverified**, and hosted routing and indexing remain **unknown**. A healthy read on an alternate endpoint is evidence of read capability at the sampled block. Production failover still requires separately qualified operators, tested quotas, hash agreement, bounded canonical trace validation and outage policy. [Robinhood RPC documentation](https://docs.robinhood.com/chain/connecting/) · [Read-only probe](../apps/web/scripts/probe-robinhood-launch-readiness.ts)

The persistent production baseline is one durable writer, authenticated off-host snapshots and digest inventory, restored-checkpoint replay, and a monitored recovery procedure. A dedicated curve worker, sustainable provider quotas, independent canonical trace verification and L1 replay are release requirements. The [security disposition](RMT_CURVE_TASK023_SECURITY.md) retains the unchanged Slither gate and the findings requiring independent review. Physical-device acceptance is a separate release item.

# RMT Launch website preview and iPhone acceptance

The website showcase has labeled sample launches and review terms. It uses no wallet or chain connection. This runbook also starts a separate private, transactional fixture on chain **31337** using synthetic ETH and an in-memory fork of pinned Base Sepolia state. Keep the showcase, the private fixture and any future contract release as separate decisions.

## Legion setup

Use PowerShell 7.4 or later in the Task 026 worktree. The Legion already has Node 22, pnpm 10.12.1, Anvil 1.7.1 and the checksum-pinned Solidity 0.8.26 compiler used in #593. Verify the local inputs before building.

```powershell
Set-Location 'C:\Users\RMT\Documents\Codex\2026-11-11\rmt-task026-acceptance'
git rev-parse HEAD
$anvil = Join-Path $env:TEMP 'rmt-launch-foundry-native/node_modules/@foundry-rs/anvil-win32-amd64/bin/anvil.exe'
$solc = Join-Path $env:TEMP 'rmt-task019-solc-0.8.26.exe'
if (!(Test-Path -LiteralPath $anvil) -or !(Test-Path -LiteralPath $solc)) { throw 'The verified fixture tools are missing.' }
if ((Get-FileHash -LiteralPath $solc -Algorithm SHA256).Hash -ne '537FD8D8D4A0433A971BF456FC06F7B021CDCEE27B252F74DA49E0D8559AEB67') { throw 'Unexpected solc checksum.' }
& $anvil --version
node --version
pnpm --version
pnpm install --frozen-lockfile
if ($LASTEXITCODE -ne 0) { throw 'Pinned dependency installation failed.' }
pnpm --filter web exec next build
if ($LASTEXITCODE -ne 0) { throw 'The website build failed.' }
```

The worktree links `packages/contracts/lib` to the existing pinned Uniswap sources. If those local inputs are missing, follow the [pinned contract review setup](RMT_CURVE_TASK021_AUDIT_HANDOFF.md) before continuing. Confirm the displayed commit matches the draft PR under review.

### Read-only website on the Legion

Use a separate PowerShell session from the same worktree. This starts a preview at [http://127.0.0.1:3195](http://127.0.0.1:3195) on the Legion. Press Ctrl+C when finished.

```powershell
$env:RMT_LAUNCHPAD_SITE_MODE = 'showcase'
pnpm --filter web exec next start --hostname 127.0.0.1 --port 3195
```

### Private iPhone session

Connect the Legion and iPhone to the same trusted Wi-Fi. Confirm Windows lists the network as `Private` and check the Legion address. It was `10.0.0.22` during the local check. On iPhone, open Settings → Wi-Fi → ⓘ and copy its current IPv4 address.

```powershell
Get-NetConnectionProfile | Format-Table InterfaceAlias,NetworkCategory
Get-NetIPAddress -InterfaceAlias 'Wi-Fi' -AddressFamily IPv4 | Format-Table IPAddress,PrefixLength
```

Continue in the Legion setup session and leave it open while testing. The operator enters the iPhone address and selects one fresh test-only EOA. Use the previously supplied MetaMask test address if it still matches the account and is accepted as fresh by the fixture.

```powershell
Remove-Item Env:RMT_LAUNCHPAD_SITE_MODE -ErrorAction SilentlyContinue
$hostIp = Read-Host 'Legion IPv4 on the trusted Wi-Fi'
$phoneIp = Read-Host 'iPhone IPv4 on the same Wi-Fi'
$testWallet = Read-Host 'Public address of the authorized MetaMask test account'
./scripts/start-curve-owner-preview.ps1 -Address $hostIp -PhoneAddress $phoneIp `
  -Wallet $testWallet -Anvil $anvil -Solc $solc -GatewayPort 9443 -WebPort 3197 -AnvilPort 8547
```

The script starts the two-hour gateway for the exact phone address and prints the private `Url`, `IosProfile`, root fingerprint and paths to the access code and wallet RPC. Anvil and the Next backend bind only to `127.0.0.1`. The fixture verifies chain ID, runtime identities and the 2 ETH profile, then seeds the one test EOA with 10 synthetic ETH. It accepts only signed test transactions within the gateway policy. Use the generated HTTPS URL on the phone and leave `LocalAdminRpc` on the Legion. Use private transfer for the certificate profile and credentials. Keep the RPC URL, access code and wallet secrets out of chat, logs and screenshots.

If the gateway is unreachable, check the same Wi-Fi, exact phone IPv4, private-network status and whether a VPN or client isolation is affecting local reachability. If the profile or URL fails certificate validation, stop and record the device error. Use the existing network policy and avoid public tunnels or port forwarding.

## Owner checklist on iPhone

1. Verify the profile fingerprint with the operator and install the generated profile from Settings. Enable full trust for its root in Settings → General → About → Certificate Trust Settings. Allow MetaMask to reach the trusted Wi-Fi if iOS prompts for Local Network access. [Install a profile](https://support.apple.com/en-us/102400) · [Apple certificate trust](https://support.apple.com/en-us/102390) · [Apple Local Network settings](https://support.apple.com/en-us/102229)
2. Before adding the private RPC, turn off MetaMask Analytics under Settings → Security & Privacy and restart MetaMask. The RPC URL includes an access credential. In MetaMask **Explore**, open the exact private HTTPS origin, enter the UI access code and connect your test account. Switch to **31337**. If needed, add or replace its existing custom RPC with the exact generated wallet RPC and currency symbol ETH. Stop on any chain ID, RPC or account mismatch. [Private gateway wallet notes](RMT_LAUNCH_PRIVATE_PREVIEW.md) · [MetaMask mobile browser](https://support.metamask.io/configure/wallet/how-to-use-the-metamask-mobile-browser/) · [MetaMask custom networks](https://support.metamask.io/configure/networks/how-to-add-a-custom-network-rpc/)
3. Open **Create Token**, enter a new name and symbol, and review the provisional **0.0004 ETH** fee with gas shown separately. Reject one wallet confirmation, then review and confirm once. Check the confirmed launch under **My Launches**. Try returning from the wallet after backgrounding the browser. If the site lost the returned hash, copy it from MetaMask activity and use **Recover wallet request → Check transaction**. Check that it verifies the same transaction without another signature. If wallet activity shows a transaction but the site cannot recover it, record the hash and stop before signing another request. A delayed receipt or trace should remain pending.
4. Open the token page, accept the fixture trading terms, buy with a budget of about **0.12 test ETH** and sell **100 test tokens** once you hold them. Review and verify the exact token approval, trade settlement and curve fee credit. Rotate to landscape and back. Check that controls and verification notices stay usable without horizontal overflow.
5. Give the local operator the new token address and approve the simulated migration checkpoint. Run the command below once for V1 → V2, then once for V2 → V3. After each hop, refresh the same token page and check **Project version and migrations**, the active version and unchanged token address. If there is a pending trade from the previous version, recover it by its original hash. The operator temporarily impersonates the authorized creator and test reviewers in local Anvil and advances the simulation clock. This is fixture governance only.
6. Review a **3 test ETH** buy budget to fill the curve toward **2 ETH backing**, check the confirmed trade and its unused-input refund, then use **Review graduation → Confirm graduation in wallet**. Verify the shown original LP owner, position, liquidity and full pool identity. Try a **0.01 test ETH** v4 buy, then sell **100 test tokens** with the requested narrow token/router approvals. Review curve fee claim, LP fee collection and LP fee claim where eligible. Confirm the original position and liquidity are unchanged after claims. Record a missing fee or receipt separately from a principal or custody failure.
7. Record iPhone model, iOS and MetaMask versions, portrait/landscape, the step reached and the exact redacted error if any. Use local transaction hashes or screenshots with credentials removed. The operator stops the PowerShell session with Ctrl+C. Confirm the ports are closed, then remove the temporary root profile and generated 31337 RPC from MetaMask.

On the Legion, the following command should return no listeners after shutdown.

```powershell
Get-NetTCPConnection -LocalPort 9443,3197,8547 -State Listen -ErrorAction SilentlyContinue
```

### Operator-only migration

Open a second PowerShell session in the same worktree. Use the first session’s printed `Deployment` path and `LocalAdminRpc`, the test EOA and the exact token address copied from the private launch page. The command verifies the candidate and fixture bindings. Run one hop at a time.

```powershell
$solc = Join-Path $env:TEMP 'rmt-task019-solc-0.8.26.exe'
$deploymentPath = Read-Host 'Deployment JSON path printed by the running session'
$factory = (Get-Content -LiteralPath $deploymentPath -Raw | ConvertFrom-Json).factory
$token = Read-Host 'Private fixture token address'
$creator = Read-Host 'Public address of the authorized test account'
node packages/contracts/scripts/validate-curve-graduation-4663.mjs `
  --rpc 'http://127.0.0.1:8547/' --solc $solc --backing-wei 2000000000000000000 `
  --owner-test --simulate-creator --migrate-token $token --creator $creator --factory $factory
```

Chromium emulation and loopback settlement are engineering evidence. The physical iPhone session is a separate acceptance check. The [Task 025 verification report](RMT_CURVE_TASK025_VERIFICATION.md) records the unresolved security findings, audit scope, exact deployment inputs and operational blockers for funded testing.

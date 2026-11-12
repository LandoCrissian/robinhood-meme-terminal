# Private RMT Launch preview

The web app and indexer run side by side against a disposable Anvil fork of Base Sepolia on chain 31337. They share a dedicated persistent SQLite file. The preview gateway serves the launch UI, receipt verification, and five REST and MCP reads over private HTTPS. The Anvil administrative RPC and the web backend each listen on loopback.

## Hosting inventory

| Surface inspected | Evidence and disposition |
| --- | --- |
| Vercel | The RMT project is linked to production and has private Preview configuration. The other visible project has no prior deployment. Its first deployment can acquire Production status. The launchpad runtime stays disabled in all Vercel environments. [Vercel CLI behavior](https://github.com/vercel/vercel/issues/17069) |
| Railway | The connected RMT project exposes only its production environment. Its services and databases stay outside the preview. Adding a new persistent workload can incur usage charges. [Railway plans](https://docs.railway.com/pricing/plans) |
| Netlify and Upstash | The Netlify inventory provided no compatible isolated RMT Launch host with a persistent colocated worker. Upstash reported no active Box. The LAMMB and CannaCat hosts are outside this work. |
| Developer machine | A loopback HTTPS gateway can run with the existing web, SQLite and Foundry toolchain. Private device access needs a trusted HTTPS route from the iPhone, such as an existing tailnet or a TLS listener on the same private Wi-Fi. [Tailscale Serve](https://tailscale.com/docs/features/tailscale-serve?q=serve) |

## Set up a dedicated test session

1. Start a fresh Anvil process using the pinned Base Sepolia fork and `--accounts 0`. Use `--host 127.0.0.1` and a dedicated port. Deploy the V1 preview factory with the local helper’s `--sealed` option. It verifies the chain, fork anchor, official runtime hashes and dependency bindings before creating a disposable deployment signer in memory. Keeping the entire fork history in the same instance preserves receipt verification. [Contract runbook](../packages/contracts/scripts/LAUNCHPAD_LOCAL.md)
2. Pick a fresh test-only wallet. The operator needs its **public address**. Give it test ETH through the loopback Anvil administrative connection. Use a distinct, absolute SQLite database path for the preview, and copy the factory address, runtime hash and first block from the bootstrap output.
3. Configure an exact HTTPS origin, the test wallet address, two independently generated 32-byte random codes in lowercase hex, and a Unix expiration within four hours. Keep the codes and TLS key in the ignored local environment. Use either direct TLS on a private IPv4 address with a certificate valid for that IP or loopback behind an approved, private HTTPS terminator. Keep the gateway, web backend and Anvil on distinct ports. [Environment settings](../apps/web/.env.example)
4. Start the Next app on loopback and start the indexer with the same runtime settings. The persistent index and API quotas live in SQLite. The gateway passes only launchpad pages, build assets, launch REST endpoints and MCP. It applies separate limits for total traffic, RPC, signed submissions, traces and login attempts.
5. Start the gateway. It refuses to listen if Anvil reports any unlocked accounts, the local deployment pins fail verification, or TLS and listener settings disagree. A trusted terminator must preserve the configured HTTPS host in the upstream Host header. Use private access control at the terminator and keep the gateway’s loopback origin private.

Example commands from `apps/web` after a build, with an ignored `.env.preview.local` containing the settings.

```sh
node --env-file=.env.preview.local node_modules/next/dist/bin/next start -H 127.0.0.1 -p 3197
node --env-file=.env.preview.local --import tsx scripts/new-launchpad-indexer.ts
node --env-file=.env.preview.local --import tsx scripts/launchpad-preview-gateway.ts
```

The page access code sets an expiring HttpOnly, Secure cookie. The wallet RPC has its own unguessable path. It accepts bounded reads and simulations plus raw transactions signed by the one configured test wallet on chain 31337. Submissions are limited to the pinned factory, indexed launch tokens, and the pinned Uniswap Router and Permit2 paths. Administrative methods, unlocked-account sends, deployment transactions, foreign-chain signatures and unrelated legacy routes are refused. The gateway has no signing key. The two codes are test-session credentials.

## Windows private access

Use a trusted Wi-Fi network that both devices can reach. Check the Windows network category and current private IPv4 address. The direct TLS gateway checks the TCP peer against the attached subnet before the handshake. When the iPhone’s Wi-Fi address is available locally, set `RMT_LAUNCHPAD_PREVIEW_LAN_PEER` to admit only that address. A changed Windows or phone lease can require a fresh configuration. This check uses the socket address and ignores forwarding headers.

From the repository root, run the certificate helper in PowerShell 7. Set the gateway bind to that same address, its port to an unused port such as `9443`, and its origin to the exact `https://<address>:<port>`. Use the returned certificate and key paths in `RMT_LAUNCHPAD_PREVIEW_TLS_CERT` and `RMT_LAUNCHPAD_PREVIEW_TLS_KEY`.

```powershell
Get-NetConnectionProfile -InterfaceAlias 'Wi-Fi'
Get-NetIPAddress -InterfaceAlias 'Wi-Fi' -AddressFamily IPv4
$tls = ./scripts/new-launchpad-lan-certificate.ps1 -Address '<Windows Wi-Fi IPv4>'
```

The helper issues a four-hour IP-SAN leaf, writes the leaf key to ignored local scratch, and discards the issuing key. Its iPhone profile contains one public root certificate and an automatic removal date. Transfer only the profile through an existing private channel. Verify the matching certificate name and the SHA-256 fingerprint where the device exposes it. Keep the profile, access code and RPC capability separate. [Apple root payload](https://developer.apple.com/documentation/devicemanagement/certificateroot), [Apple profile removal](https://developer.apple.com/documentation/devicemanagement/toplevel)

Check listeners before sharing access. Only the gateway should bind the Wi-Fi address. Keep Anvil and Next on `127.0.0.1`. Leave shared Node firewall rules alone. If Windows blocks the connection, an administrator can add a temporary Private-profile inbound rule scoped to the gateway executable, exact Windows address and port, Wi-Fi interface, and iPhone IPv4, with edge traversal blocked. Existing broad allow rules remain effective alongside a new narrow allow. The gateway peer check still applies. Keep router forwarding disabled and remove any task-specific firewall rule when finished. [Microsoft firewall rule reference](https://learn.microsoft.com/en-us/powershell/module/netsecurity/new-netfirewallrule)

### Existing approved Tailscale alternative

Check the Windows and iPhone clients are signed into the approved tailnet, that access rules allow the intended phone, and that HTTPS is already enabled. Use the exact Serve HTTPS origin in preview configuration, leave the gateway on `127.0.0.1`, and leave direct TLS certificate, key, and LAN peer settings empty. The origin keeps the original `Host` and `Origin` checks. The gateway rejects Tailscale’s Funnel request marker and discards Tailscale and forwarding headers on the hop to Next.

```powershell
tailscale status
tailscale serve status --json
tailscale funnel status --json
# In an Administrator console, if the route is unused and the tailnet is approved.
tailscale serve --https=9443 http://127.0.0.1:3198
```

Keep Serve in the foreground. Confirm Serve status shows only the intended gateway route and no Funnel on that origin. Check the phone can reach it with Tailscale on and cannot reach it with Wi-Fi and Tailscale off. Serve certificates disclose the machine hostname in public Certificate Transparency logs. A certificate or account prompt means the operator must resolve an unmet tailnet prerequisite before proceeding. [Serve CLI](https://tailscale.com/docs/reference/tailscale-cli/serve), [Proxy source](https://github.com/tailscale/tailscale/blob/v1.104.6/ipn/ipnlocal/serve.go#L989-L1016), [Tailscale HTTPS](https://tailscale.com/docs/how-to/set-up-https-certificates)

## MetaMask on iPhone

1. Join the approved Wi-Fi or tailnet. For direct LAN TLS, install the matching profile and enable SSL trust for its CA in **Settings → General → About → Certificate Trust Settings**. A wallet’s native RPC can require iOS Local Network permission even when its in-app browser loads the site. If TLS or native RPC fails, record the failing step. [Install a profile](https://support.apple.com/en-us/102400), [Certificate trust](https://support.apple.com/en-us/102390), [Local Network privacy](https://developer.apple.com/documentation/technotes/tn3179-understanding-local-network-privacy)
2. In MetaMask, turn off Analytics under **Settings → Security & Privacy**, then fully restart the app before adding the private RPC. Sampled HTTP traces can retain URL paths while analytics is enabled. Open the bare preview origin in **Explore** and enter the separate UI access code from the Windows operator. [MetaMask analytics](https://support.metamask.io/privacy-and-security/how-to-manage-your-metametrics-settings/), [Restart behavior](https://github.com/MetaMask/metamask-mobile/blob/5e424d354d2f455607d4826c606ec3eda595001f/app/components/Views/Settings/SecuritySettings/Sections/MetaMetricsAndDataCollectionSection/MetaMetricsAndDataCollectionSection.tsx#L158-L184), [MetaMask browser](https://support.metamask.io/configure/wallet/how-to-use-the-metamask-mobile-browser/)
3. Connect the fresh test account and use the preview’s **Switch** prompt. The network is chain `31337` with test ETH and the exact authenticated RPC supplied by the preview. MetaMask may show a registry warning because the public chain list also uses 31337 for GoChain Testnet. Check the exact intended preview endpoint. If 31337 already exists or the session rotated, replace the stale default RPC in MetaMask first. RMT also checks the reviewed fork block hash before sending. [MetaMask custom networks](https://support.metamask.io/configure/networks/how-to-add-a-custom-network-rpc), [Registry entry](https://github.com/ethereum-lists/chains/blob/89b41dc98ed2e69be11dabca60380b8dc6c61e61/_data/chains/eip155-31337.json)
4. Review a launch, reject one wallet confirmation, then submit and verify funding. Buy, approve the exact Token and Permit2 allowances, sell, and claim fees. Switch away from the app and return. Use **Check receipt** for a saved hash. If RMT is still waiting for a hash from a reviewed request, copy its Transaction ID from MetaMask Activity and use RMT’s hash recovery field once a receipt exists. Record wallet/iOS versions, outcomes and receipt hashes. Exclude credentials, RPC settings and wallet diagnostics from evidence. [MetaMask Transaction ID](https://support.metamask.io/transactions-and-gas/transactions/how-to-find-a-transaction-id/)
5. Close the private gateway after testing, remove the test network and certificate profile, and expire both capabilities. A renewed session needs a new wallet RPC URL.

MetaMask source supports exact HTTPS endpoint validation, chain switching and single JSON-RPC requests for ordinary EOA signatures. This is compatibility research. The installed app still needs a trusted TLS connection, native RPC, a working Web Locks journal, and confirmation and recovery tests. The Playwright fixture uses disposable signatures and covers missing-hash recovery separately. Mainnet deployment, trading, and release stay locked. [MetaMask RPC validation](https://github.com/MetaMask/metamask-mobile/blob/5e424d354d2f455607d4826c606ec3eda595001f/app/core/RPCMethods/lib/ethereum-chain-utils.js#L171-L186), [MetaMask RPC transport](https://github.com/MetaMask/core/blob/2757b317ec5f8f3916968df1cba5d14ee93ee069/packages/network-controller/src/rpc-service/rpc-service.ts#L646-L670)

## Verified Windows LAN evidence

A direct HTTPS rehearsal on the Windows Wi-Fi address verified the IP SAN and normal certificate trust using the temporary CA. The authenticated app and config were available, the separate RPC capability reported chain 31337 and the configured test account’s fork balance, and invalid Host, Origin, Funnel, unsigned and administrative requests were rejected. Next and zero-account Anvil listened on loopback. This test originated on Windows. Reachability and the installed MetaMask behavior require the iPhone check above.

## Verified loopback evidence

The HTTPS gateway passed the complete Playwright journey with a disposable local wallet fixture. The fork reported zero unlocked accounts. The gateway refused administrative methods and unsigned RPC sends. After a rejected wallet prompt, the fixture submitted the signed launch and withheld its hash from the app. Recovery attached the wallet’s hash to the exact reviewed request and verified the receipt. The buy, both bounded sell approvals, native-settled sell, and fee claim each mined successfully. All five REST endpoints and all five tools through the official MCP client returned verified fork evidence over HTTPS.

The same five REST and MCP reads passed through the HTTPS gateway after restarting the web backend from a production build. A separate loopback server running that build with production settings and launching disabled returned no deployment or launch records. The public list and MCP initialization both returned HTTP 404 with no-store and noindex headers.

| Fixture transaction | Block | Receipt hash |
| --- | --- | --- |
| Create and fund the launch | 57648306 | `0x31322eae56f2f6a0b6bab2032bb7d5667a47b6480f0c2498548188d6c838b62d` |
| Buy | 57648307 | `0xaae465e51ac55cee6fe32e1953035e05e0ee86d513761b2e8536e5433c7dc58e` |
| Token approval | 57648308 | `0x3c04ad5d64755fe1f706684e44c539a7e7107add6909cfb7e7011bcdda81b25f` |
| Permit2 approval | 57648309 | `0xc6a425cce8b48754a594b060ac2cb6b89b61c91802f4a0f0958e9e6b119bc0cc` |
| Sell | 57648310 | `0xdc982bd2b51e78932b4709b8671d6581e4ce0f10efc7a11333e29c1954f1ef0e` |
| Claim creator fees | 57648311 | `0x0b2ed874a70690e67574d68c1ac597a2098109e311f175298ae98d0cef0a3499` |

The token is `0x418e6E999213DF7d7e3E496Ac9A6BB0744a5aa9E` on this disposable fork. The visual checks covered phone portrait, phone landscape and desktop. [Review](../evidence/rmt-launch-private-preview/create-review-phone.png), [rejection](../evidence/rmt-launch-private-preview/create-rejection-phone.png), [token page](../evidence/rmt-launch-private-preview/token-phone.png), [landscape](../evidence/rmt-launch-private-preview/token-phone-landscape.png).

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

## Physical iPhone checklist

- Connect the phone to the approved private route and open the HTTPS origin in the wallet’s in-app browser. For private LAN TLS, install and trust the operator-provided, short-lived CA only if that trust procedure is approved. [Apple certificate trust guidance](https://support.apple.com/en-us/102390)
- Enter the preview access code. In the fresh test wallet, add chain ID 31337 with the private wallet RPC URL and Test ETH. If the wallet already has chain 31337, confirm that its RPC is this preview. A matching chain ID alone cannot identify the fork.
- Create a launch and reject one confirmation before submitting. Confirm the receipt, check funded pool evidence, buy, approve the bounded sell allowances, sell, and claim accrued creator fees. Open the creator’s launch list.
- To exercise recovery, preserve the wallet’s transaction hash from Activity, return to the app with the request pending, and verify the hash against the original review. Record receipt hashes, browser and wallet versions, and successful or failed steps. Keep access codes, RPC URLs and device secrets out of the evidence.

The Playwright fixture exercises the same review and recovery UI with disposable local signatures. Physical-device evidence requires the iPhone operator and approved private connectivity. Mainnet deployment, trading, and release stay locked.

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

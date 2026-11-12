# RMT Launch baseline and preservation evidence

The implementation baseline is [`main` at `6d0b8103bdad95367445a38e5f5327458baa9ab2`](https://github.com/LandoCrissian/robinhood-meme-terminal/tree/6d0b8103bdad95367445a38e5f5327458baa9ab2). [PR #576](https://github.com/LandoCrissian/robinhood-meme-terminal/pull/576) at `f563870d9933b7cfa2035cdeaa138a5785da244d` supplies the scope reset and archives the old product instructions. [PR #575](https://github.com/LandoCrissian/robinhood-meme-terminal/pull/575) at `5ee50aa9a776dfa70cc2708ba7fa57394c0b229d` supplies the protected CannaCat integration and its validation history. Their base was the same `main` commit.

## Existing RMT token and curve

Read-only requests to the [Robinhood Chain public RPC](https://docs.robinhood.com/chain/connecting/) returned chain ID `4663`. State below was read at block `112195728`, hash `0xbd41906788af5446adf57ca1b89000a693994eea674b3e30da324d49320ed92f`, timestamp `2026-11-12T02:42:14Z`. The registry `0x27c0269e16209eee149e2738d0819a2633f44246` returned active factory `0x8e75c57079a01ce2094bc4187b78710887547651` and the version hash for `RMT_FACTORY_V6`. That factory returned `launchesPaused() = true` and `launchCount() = 2`.

| Binding | V6 official RMT issuance | V4 legacy issuance and V6 provenance anchor |
| --- | --- | --- |
| Factory and launch ID | `0x8e75c57079a01ce2094bc4187b78710887547651`, `0` | `0x88b86f10d874c2e3c8cfe63161ffa969f3273cd4`, `1` |
| ERC-20 | `0xdba33be56c89cc9fc014c4459028d7e5c7878671` | `0xab374d24afbd943a134adb381d9646e71c6f6c0c` |
| Curve | `0xb26fb775c0ac365d369bee9ac2e044c5d90ffbee` | `0xfeee90288a7037fbdb4ec5b05dc7cc5e762d5fb7` |
| Fee splitter or reward vault | `0x2f31b7f8beedbe63bb099701729500ec81389023` | `0xbe088735eac40654e42224406a018fc1c745bc7d` |
| Supply at snapshot | `1,000,000,000` | `1,000,000,000` |
| Curve real ETH reserve at snapshot | `0.056811053479943975 ETH` | `0.002822201317027282 ETH` |
| Curve graduation at snapshot | `graduated = false`, `liquidityMigrated = false` | `graduated = false`, `liquidityMigrated = false` |
| Creation receipt | [Successful transaction at block `10387857`](https://robinhoodchain.blockscout.com/tx/0x4eb7b596ccdf5d0aa5e4c8d0d50311df5108b44f47d9d39d09b1916524d825d5) | [Successful transaction at block `9156510`](https://robinhoodchain.blockscout.com/tx/0xe5cd6ed09a3cccae743b7c29c0ee0971f3797986bce171eadc3642de60b3410b) |

The V6 receipt sender is the deployment operator `0x7e8e7d3af28584a8b9eeddbe16cd3308bd1e76ca`. Its transaction calls `launchOfficialWhilePaused(string)` on the recorded factory. Its factory logs emit `TokenLaunchedV6` and `OfficialRMTMigrationLaunched` for the same launch ID, token and operator, with `officialMigration = true`. The migration event binds helper `0x287bb5f822aa721181edb0b6eebe9b3e201ec4b9` and the exact V4 token. The helper confirmed its immutable factory, launcher and legacy token, and `consumed() = true`. The other V6 launch has `officialMigration = false`. The V5 factory `0x25a92d8c79c38d07b0d3efd0ebe929d30e401cdd` returned `launchCount() = 0`. Its role in this provenance is the inherited identity reservation path.

The V6 curve and splitter independently returned the V6 token, curve and treasury bindings. The curve's actual ETH balance equaled its reported real reserve. Its token balance equaled the tracked inventory of `837994797660907738169516833` raw units. The curve reported `100` fee bps and the splitter reported `7000` creator-share bps, with the remainder going to protocol treasury `0x52c43239df8965eb27f26e115cc5ead11b35d5c3`. Read-only `quoteBuy` and `quoteSell` calls returned positive output for `0.001 ETH` and `1 RMT` respectively. The curve's reserved graduation PoolId is `0x752469c7db2ae1dfe84805da2544f49182a4e09bde952acb548a824f8eb8815b`. The [official StateView](https://developers.uniswap.org/docs/protocols/v4/deployments#robinhood-chain-4663) returned zero for the pool's square-root price, matching the raw PoolManager slot and the curve's ungraduated state.

[PR #229](https://github.com/LandoCrissian/robinhood-meme-terminal/pull/229) previously identified V6 launch 0 by address and its official-migration flag. [`e7360de`](https://github.com/LandoCrissian/robinhood-meme-terminal/commit/e7360de518d72e88bb823fd424363cd75d7c81eb) recorded its retirement as a Terminal product fixture and removed that special treatment. Its description of launch 0 as user-created conflicts with the successful factory receipt and immutable bindings above. The chain establishes the official V6 provenance, original curve and separate V4 issuance. Product visibility and execution release are separate decisions. The old `migration` function name describes identity authorization. The V6 token was created with its own supply, and existing V4 holders retain their original balances and claims.

### Reproduce the read-only checks

The factory return types and event signatures come from [IRMTLaunchFactoryV6](../packages/contracts/src/interfaces/IRMTLaunchFactoryV6.sol), [RMTLaunchFactoryV6](../packages/contracts/src/RMTLaunchFactoryV6.sol) and [LowCostMemeLaunchFactoryV4](../packages/contracts/src/LowCostMemeLaunchFactoryV4.sol). The documented Pinax endpoint `https://robinhood.rpc.pinax.network` also served the splitter reads at the pinned block after Robinhood's default RPC pruned that state. [Robinhood Chain RPC endpoints](https://docs.robinhood.com/chain/connecting/).

```bash
export ETH_RPC_URL=https://rpc.mainnet.chain.robinhood.com
snapshot=112195728
v6=0x8e75c57079a01ce2094bc4187b78710887547651
v4=0x88b86f10d874c2e3c8cfe63161ffa969f3273cd4
v6asset=0xdba33be56c89cc9fc014c4459028d7e5c7878671
v6curve=0xb26fb775c0ac365d369bee9ac2e044c5d90ffbee
v6splitter=0x2f31b7f8beedbe63bb099701729500ec81389023
v6helper=0x287bb5f822aa721181edb0b6eebe9b3e201ec4b9
v6creation=0x4eb7b596ccdf5d0aa5e4c8d0d50311df5108b44f47d9d39d09b1916524d825d5
v4creation=0xe5cd6ed09a3cccae743b7c29c0ee0971f3797986bce171eadc3642de60b3410b
v6pool=0x752469c7db2ae1dfe84805da2544f49182a4e09bde952acb548a824f8eb8815b
stateview=0xf3334192d15450cdd385c8b70e03f9a6bd9e673b
cast chain-id
cast block "$snapshot" hash
cast receipt "$v6creation" --json
cast receipt "$v4creation" --json
cast call "$v6" 'launchesPaused()(bool)' --block "$snapshot"
cast call "$v6" 'getLaunch(uint256)((address,address,address,bytes32,address,bytes32,uint32,uint64,bool))' 0 --block "$snapshot"
cast call "$v4" 'getLaunch(uint256)((address,address,address,bytes32,address,uint64))' 1 --block "$snapshot"
cast call "$v6helper" 'officialLegacyToken()(address)' --block "$snapshot"
cast call "$v6helper" 'consumed()(bool)' --block "$snapshot"
cast call "$v6asset" 'totalSupply()(uint256)' --block "$snapshot"
cast call "$v6curve" 'token()(address)' --block "$snapshot"
cast call "$v6curve" 'feeSplitter()(address)' --block "$snapshot"
cast call "$v6curve" 'realEthReserve()(uint256)' --block "$snapshot"
cast call "$v6curve" 'graduated()(bool)' --block "$snapshot"
cast call "$v6splitter" 'creatorShareBps()(uint16)' --block "$snapshot"
cast call "$v6splitter" 'launchToken()(address)' --block "$snapshot"
cast call "$v6splitter" 'authorizedMarket()(address)' --block "$snapshot"
cast call "$stateview" 'getSlot0(bytes32)(uint160,int24,uint24,uint24)' "$v6pool" --block "$snapshot"
```

The V6 factory runtime keccak256 was `0x274321493d48091b4443e007b8335a93a977e67dffe67d6147ff8557a1e58830`. The V6 token and curve minimal proxies returned `0x49cd48d0204b35d27e6fca131febe8ce5aff6cd0c2fb6c5c21d5f0ad616e99e9` and `0x3ec5037b6e888342142eaca480943c4a5724a85e32f56ecaa0c761e8af5fa387`. These are observed runtime identifiers. The [deployment record](MAINNET_V6_DEPLOYMENT.md) explains the incomplete exact-source publication on Blockscout.

## Separate Uniswap dependencies

The [new engine deployment identity fixture](../packages/contracts/test/fixtures/rmt-v4-deployment-identities.json) records distinct PoolManager, PositionManager, Universal Router, Permit2, Quoter and StateView pins for Base Sepolia and Robinhood mainnet against [Uniswap’s official deployments](https://developers.uniswap.org/docs/protocols/v4/deployments). The local fork selects Base Sepolia’s Universal Router 2.0 at `0x492e6456d9528771018deb9e87ef7750ef184104`. The local deployment helper requires an Anvil loopback URL, chain `31337`, the configured fork block and the pinned runtime hashes before deploying the new factory. Robinhood mainnet pins document dependency provenance for future review.

## Baseline route and runtime inventory

The baseline tracks 40 `page.tsx` files including `/` and 67 API route handlers. The families below identify product entry points and their relevant dependencies. The tracked tree, rather than the number of navigation items, is the baseline for cleanup.

| Baseline surface | Runtime entry and dependencies | Preservation or retirement boundary |
| --- | --- | --- |
| `/`, `/vnext` | `VNextTerminalShell` imports market universe, directory, selected asset workspace and execution recovery. Responsive presentations import project cards, chain pulse, capital flow, distribution planner and wallet controls. The directory hook reads `/api/vnext/market-directory`, `/market-search`, `/asset-identity` and `/api/markets/external`. Asset workspace loads core, enrichment, visual and market views. | Launch browsing can lose broad reads when it stops mounting these paths. Dedicated legacy deep links still need explicit compatibility review. Keep artwork, chart primitives, wallet authority and journal semantics. |
| `/launch`, `/launches`, `/project/[address]`, `/market/[address]`, `/token/[address]` | Paused creation page, launch intelligence proxy and address-qualified detail/redirects. Root can also resolve `market` and `launch` query parameters. `/api/vnext/launches` and `/api/launch-origin/[token]` read legacy indexers. | Preserve address bindings and history. New launch discovery uses its own versioned source. A V6 event never represents a new engine launch. |
| `/nft`, `/nft/[projectId]`, `/nft/[projectId]/[tokenId]`, `/projects`, `/projects/[projectId]` | NFT layouts and server ownership/marketplace readers, `/api/projects/[projectId]/ownership`, `/api/nft/mint-*`, artwork and catalog metadata. Old public chrome and sitemap advertised the routes independently. | Remove public product entry points and any remaining active imports after checking project/token references and mint consumer contracts. Keep historical NFT contract and deployment data. |
| `/markets/robinhood-chain/**`, `/robinhood-chain`, `/explore`, `/runners` | Market inventory and chain-wide discovery. VNext external-market and asset identity code includes RWA detection, provider adapters, and indexer enrichment. `/api/vnext/chain-pulse`, `/capital-flow`, `/api/markets/wallet-constellation` provide broad analytics. | Remove forward public discovery and polling where safe. Keep identity, rate-limit, runtime and stock-token execution exclusions in shared execution. |
| `/profile`, `/invite/[code]`, `/watchlist`, community, creator and admin paths | `ProfileProvider`, Firebase session bridge, Firestore records/listeners, community, creator media, review/consent, scheduled availability and media signing APIs. `Providers` mounts profile compatibility on admin/deploy prefixes and experience telemetry globally. | Remove unrelated public surfaces and root runtime dependency after checking operator/deploy tools. Preserve Firestore, moderation, withdrawal and consent evidence. |
| `/portfolio`, `/?panel=portfolio`, `/protection` and distribution/guard paths | Wallet reads, execution records, guarded recovery, portfolio, position guards and distribution. `Providers`, `rmt-identity`, `wallet-config`, and `speed-wallet-provider` provide connector/Privy authority. | Retain wallet and recovery. Remove unrelated distribution entry points without reviving retired preparation routes or deleting saved state. |
| `/status`, `/support`, `/risks`, `/terms`, `/privacy`, `/api/health` | Operational, legal and help endpoints. Shared trade acknowledgement is mounted separately from the broader product chrome. | Preserve the terms/risks and transaction support required by active execution. |
| `/deploy-*`, `/activate-consent-testnet`, `/mainnet-smoke`, `/rescue` | Operator deployment, verification and recovery tooling. Source flags and deployed settings have separate authority. | Preserve deployment source and evidence. Excluding operator tools from launch navigation does not revoke access or change any environment. |

## CannaCat compatibility and overlapping PRs

PR #575 adds `POST` and `OPTIONS` on `/api/embed/cannacat/[operation]` for `quotes`, `verify`, `authorize` and `native-settlement-trace`. Its operation handlers import the corresponding `/api/vnext/*` handlers. Preserve the canonical Privy linked-wallet authentication, exact approved origin, `ZERO_X_ONLY` profile, provider/runtime/fee checks, committed authorization, receipt and native trace verification. The exact asset is `0x1139d423c1706bdead91f03507f521635591ed92` against native ETH on chain `4663`. Keep `apps/web/lib/embed/`, the SDK builder, wallet controller and selected-provider code, the execution journal, the server-only historical trace reader/archive, and the associated validation. An unresolved journal record remains a duplicate-prevention boundary. No launchpad flow should sign or replay it.

The `native-settlement-trace` handler, trace readers/archive, `rmt-identity.tsx`, `connected-wallet-state.ts`, `wallet-connection-controller.ts`, `vnext-defillama.ts`, `wallet-constellation.ts`, package manifests, and lockfile intersect with product cleanup. The remaining NFT and Project route changes in #575 concern those older browser surfaces. Excluding those route changes from launchpad work does not require changing #575 or the LAMMB companion. The embedded SDK bundle is generated separately from the public page tree. The companion pins an exact SDK artifact digest, so changing RMT or building locally cannot serve as evidence of companion deployment or acceptance.

Other relevant open work at baseline included [#573](https://github.com/LandoCrissian/robinhood-meme-terminal/pull/573) and [#574](https://github.com/LandoCrissian/robinhood-meme-terminal/pull/574) for Next dependency updates, [#572](https://github.com/LandoCrissian/robinhood-meme-terminal/pull/572) for NFT/market browsing, [#566](https://github.com/LandoCrissian/robinhood-meme-terminal/pull/566) for bounded historical launch throughput, [#553](https://github.com/LandoCrissian/robinhood-meme-terminal/pull/553) for poolless identity, [#540](https://github.com/LandoCrissian/robinhood-meme-terminal/pull/540) for quote/recovery consistency, and [#534](https://github.com/LandoCrissian/robinhood-meme-terminal/pull/534) for a CannaCat route proof. These PRs do not authorize changes to their branches or their production switches.

Existing terminal browser suites assert the old home DOM, market views, NFT navigation, and VNext query URLs. They can still exercise a preserved compatibility entry where applicable. A launchpad-specific browser test should exercise the new root and verify unrelated calls are absent. Keep exact settlement, authorization and duplicate-prevention assertions. The focused CannaCat workflow tests the independent SDK and server boundary, Chrome and Edge browser fixtures with a 15-minute observation run, and historical WebKit recovery. Synthetic wallet state in these suites does not establish real-wallet acceptance.

## Operational retirement after a release decision

- The production V6 worker/API uses `apps/indexer/railway.json` and Railway PostgreSQL. It remains the documented V6 discovery source. Preserve its checkpoint, trade history and health probes. There are separate Railway configs for `apps/external-origin-indexer`, `apps/market-indexer`, `apps/nft-indexer` and `apps/nft-marketplace-indexer`. The [September 30 Railway metadata](architecture/evidence/2026-09-30/railway-live-scope.json) lists the V6, market-shadow, NFT and NFT-marketplace services and database identities. Verify current consumers, retention, rollback and service configuration before any separate retirement action.
- `.github/workflows/production-health.yml` schedules liveness every five minutes and `production-readiness.yml` schedules hourly deep readiness. The IndexNow incremental and seed workflows are `main` push-triggered. Reconcile their expected route set and canonical URLs with any approved rollout. The creator-media cron endpoint requires a secret and feature switch. A route's existence establishes neither a configured schedule nor permission to disable it.
- Firestore rules, indexes, profile/consent/moderation evidence, media records, trade journals, contract verification and deployment evidence are separate from route availability. Review their retention and read access before changing providers, credentials, schedules or services. Keep LAMMB's domain, repository, deployment, schedules and data outside the RMT retirement work.

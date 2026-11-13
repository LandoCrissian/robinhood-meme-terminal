# RMT Launch architecture boundary

**Status:** CURRENT PRODUCT DIRECTION

**Owner decision:** 2026-11-11. **Audited base:** `6d0b8103bdad95367445a38e5f5327458baa9ab2`.

RMT is a token launchpad, not a general market operating layer. This explicit owner decision supersedes the old terminal/NFT product roadmap and the rule that unrelated terminal completion must precede launch work. It does not waive security, authorize release, or assert that the deployed application already matches this scope.

## Fixed boundaries

1. Preserve the existing UI, branding, mobile ergonomics and useful token/trading components.
2. Preserve the existing RMT token and curve. New third-party launches must be a separately versioned engine; do not reopen or mutate the legacy factory as a shortcut.
3. Keep LAMMB Empires independent. Preserve generic wallet and settlement protections while retiring dedicated CannaCat integration dependencies.
4. Own the launch factory, launch records and product. Using shared Uniswap liquidity infrastructure is not outsourcing token creation to Pons, nor does it require building a private DEX.
5. Remove unrelated product lanes in dependency-aware, tested stages. Do not treat hidden navigation as complete source/service removal.

## New-launch flow

User-confirmed creation -> standard token deployment -> canonical v4 pool initialization -> disclosed, actually funded liquidity -> verified liquidity-position custody/lock -> canonical launch event -> immediate confirmed RMT launch record -> independently observed third-party indexing/routing.

The [local implementation](RMT_LAUNCH_V4_LOCAL.md) uses one atomic launch transaction. For any future alternative, otherwise incomplete funding must be clearly non-live. The initial engineering candidate is hookless v4 for compatibility. Token supply, quote asset, seed liquidity, initial price/range, LP custody and fees need explicit design and security review; no values are approved by this document. A token-only liquidity range is not proof of an existing quote-asset reserve.

Retain the full chain-qualified v4 PoolKey and PoolId rather than treating a pool as an independent pair-contract address. Onchain availability, discovery and route availability are distinct states.

## Existing execution remains protected

The compatibility runtime retains its existing ZERO_X_ONLY provider boundary, explicit wallet confirmation, recipient binding, strict firm-quote verification, simulation and settlement/recovery. Direct v4 launch/pool creation is a separate domain; source existence does not authorize a new public trading route. Keep Stock Token execution exclusion wherever the old route remains reachable.

Existing fee schedules, treasury addresses and historical splits are neither modified nor automatically copied into new-launch economics. Preserve deployed source, manifests, receipts, journals and user data. Resolve the old-token identity inconsistency before any address-specific migration or relabeling.

## Change control

A draft PR may implement and test the requested cleanup. No automatic merge, production deployment, environment mutation, cloud shutdown, contract transaction, fee/provider activation or destructive migration. Runtime removal requires affected imports/routes/jobs/consumers to be checked, not merely documentation changes. Source verification and independent security review remain separate evidence.

[Active system map](ACTIVE_SYSTEM_MAP.md) distinguishes observed code from target scope. [Reset audit and acceptance](RMT_LAUNCHPAD_RESET_2026-11-11.md) supplies the staged work. The previous architecture is preserved verbatim in [the historical snapshot](archive/terminal-scope-2026-11-11/ARCHITECTURE_FREEZE.md), including incomplete acceptance and historical release boundaries; its product roadmap is superseded, not its factual history.

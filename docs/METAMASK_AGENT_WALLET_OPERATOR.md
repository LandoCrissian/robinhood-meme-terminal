# MetaMask Agent Wallet operator foundation

**Status:** OPERATOR FOUNDATION — transaction capability not authorized
**Scope:** local Codex/developer tooling only; not an RMT production runtime

## Purpose and boundary

This foundation gives an RMT operator or Codex a structured, programmatic interface to MetaMask Agent Wallet. It does not replace VNext's external-wallet architecture and it is not a VNext execution provider.

```text
RMT user execution != RMT operator Agent Wallet
```

The web application must not shell out to `mm`, depend on the operator's local session, send user trade intent to a developer machine, or treat the Agent Wallet address as a Privy/external-wallet identity. A future RMT integration requires a separate architecture and security decision.

The foundation does not activate Position Guard, autonomous user trading, wallet submission, production routing, provider admission, production fee collection, scheduled execution, or any treasury action.

## Official tooling

- npm package: [`@metamask/agent-wallet`](https://www.npmjs.com/package/@metamask/agent-wallet) (`mm`)
- official skills source: [`MetaMask/agent-skills`](https://github.com/MetaMask/agent-skills)
- installed Codex skill: `metamask-agent-wallet`
- repository preflight: `pnpm preflight:metamask-agent-wallet`

The CLI and skill are installed at user scope outside this repository. No generated skill, CLI session, wallet, or credential files belong in Git.

Verified locally on 2026-08-16:

| Component | Result |
| --- | --- |
| Node | `22.23.1` (CLI minimum: `22.18`) |
| MetaMask Agent Wallet CLI | `6.1.0` |
| MetaMask Codex skill | `7.1.0`, targets CLI `6.1.0` |
| `mm doctor --json` | CLI/skill compatible; production environment; authenticated and initialized |
| Active wallet | server wallet `0xe29e…a51d` |
| Trading mode | Guard Mode |
| Policy | Robinhood `4663`/`46630` allowed; rolling 24-hour outflow limit is `0` USD |

## Security model

The only approved initial model is:

```text
server-wallet + Guard Mode
```

- Do not use Beast Mode.
- Do not use BYOK for this foundation.
- Never import Landon's MetaMask seed phrase or an existing private key.
- Never store a mnemonic, private key, CLI/refresh token, password, wallet secret, or one-time login credential in the repository, `.env`, documentation, fixtures, logs, commits, or PR comments.
- Keep MetaMask's session storage outside RMT.
- Do not fund the Agent Wallet until its address, Guard Mode, policy, network support, and human approval boundary are reviewed.
- Guard Mode policy exceptions or policy broadening may require MFA. That escalation is a safety control, not authorization for RMT autonomy.
- Transaction simulation or threat scanning, when reported by MetaMask for a particular operation, supplements rather than replaces RMT's provider-specific verification.

The repository preflight contains only a static allowlist of read-only `mm` commands. It has no execution flag and always reports `transactionUseAuthorized: false` and `safeForTransactionUse: false`.

## Robinhood Chain evidence

Live capability truth must come from the installed CLI's authenticated `mm chains list --json` response. Package release notes or the mere presence of a chain are not sufficient.

Current live verification result from `mm chains list --json`:

| Network | Required identity | Live CLI status | Features | Relay | Swap |
| --- | --- | --- | --- | --- | --- |
| Robinhood Chain mainnet | `eip155:4663` | PRESENT — canonical name `Robinhood Chain` | `swap` | `false` | ADVERTISED BY CLI |
| Robinhood Chain testnet | `eip155:46630` | PRESENT — canonical name `Robinhood Chain Testnet` | none | `false` | NOT ADVERTISED |

The CLI's mainnet `swap` feature flag proves that the installed Agent Wallet version advertises Robinhood swap capability. It does not prove that a particular pair has a quote, that an execution is safe, or that RMT has authorized Agent Wallet transaction use. Both Robinhood networks report `relaySupported: false`; testnet advertises no features.

If `features` omits `swap`, RMT must report Agent Wallet swap support as unavailable even though chain 4663 exists. `NO_QUOTES` from a future quote-only probe means no route at that moment; it does not by itself mean the chain is unsupported.

## Read-only preflight

Run:

```bash
pnpm preflight:metamask-agent-wallet
```

The script inspects only:

- CLI presence/version;
- `mm doctor` and skill compatibility;
- authentication and initialization status;
- authenticated chain-registry entries for 4663 and 46630;
- exact chain features and relay field;
- active wallet address, wallet mode, trading mode, policy readability, and policy-template readability when initialized.

Unknown or malformed security-relevant fields fail closed. The current verified result is read-only ready: authenticated, initialized, server wallet selected, Guard Mode active, policy readable, and both Robinhood identities valid. The result still hard-codes `transactionUseAuthorized: false` and `safeForTransactionUse: false`.

## Human activation checkpoint

Authentication and initialization are complete. The wallet remains unfunded and its rolling 24-hour outflow limit remains zero. Before any future funds or transaction capability can be enabled, Landon must separately authorize a reviewed transaction-use phase that:

1. Re-verifies, read-only:
   - `mm doctor --json`
   - `mm chains list --json`
   - `mm wallet address --json`
   - `mm init show --json`
   - `mm wallet trading-mode get --json`
   - `mm wallet policy get --json`
   - `mm wallet policy template --json`
2. Runs `pnpm preflight:metamask-agent-wallet` and reviews all blockers and warnings.
3. Defines narrow address and outflow policy limits for an exact approved purpose. Any policy broadening must use MetaMask's normal MFA review. Do not enable Beast Mode.
4. Reviews the exact funding source, amount, chain, recipient, recovery model and maximum loss before funding.
5. Adds a task-specific command boundary with simulation, threat checks and human confirmation. Do not add a generic execute switch to this preflight.
6. Obtains a separate explicit owner authorization before every signing, approval, transfer, swap, deployment or other submitted transaction unless a later, independently reviewed policy explicitly authorizes a narrower automated action.

No funds or transaction capability may be enabled merely because the technical preflight becomes healthy.

## Position Guard — future assessment only

MetaMask Agent Wallet could eventually be evaluated as an execution agent for a separately authorized Position Guard design because it exposes structured wallet operations and Guard Mode policy controls. That possibility does not bypass Position Guard's onchain order protections, VNext verification, exact recipient/calldata controls, or human authorization requirements. PR #297 remains separate and unchanged; this foundation implements no Position Guard integration.

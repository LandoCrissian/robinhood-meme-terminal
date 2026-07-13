# RMT Incident Response

Status: operational draft for mainnet beta  
Owner: RMT protocol operators  
Review cadence: before beta, after every incident, and after every factory version

## Objectives

1. Protect users from submitting additional harmful transactions.
2. Preserve onchain and application evidence.
3. Coordinate the three governance signers.
4. Communicate facts without speculation.
5. Use only powers that actually exist in deployed contracts.
6. Publish a post-incident record after containment.

## Severity

### SEV-0 — critical

Confirmed asset loss, exploitable contract behavior, malicious factory/version activation, compromised governance signer quorum, broken graduation settlement, or active phishing through the official interface.

Immediate actions: mark the public status degraded, disable affected interface actions where possible, notify all signers, preserve logs and transaction hashes, publish a short warning, and engage the independent reviewer.

### SEV-1 — high

Repeated failed launches/trades, reward accounting mismatch, migration failure without confirmed loss, registry/RPC inconsistency, or compromise of one signer.

Actions within 30 minutes: pause affected UI paths where possible, validate onchain state through an independent RPC and explorer, rotate non-contract credentials, and prepare user guidance.

### SEV-2 — degraded

Indexer lag, metadata failure, external price outage, wallet-connection issue, or incorrect non-transactional display.

Actions: label degraded data, keep unaffected onchain actions available only when their preflight remains reliable, and record the incident.

## First 15 minutes

- Record UTC start time and reporter.
- Capture affected URL, wallet address, contract, transaction hash, block, and network.
- Check version registry, active factory, contract bytecode, RPC head, recent events, and status endpoint.
- Do not ask for private keys or seed phrases.
- Stop automated deployments and unrelated governance proposals.
- Contact at least two governance signers through independent channels.
- Determine whether the issue is interface-only, data-plane, wallet/provider, or contract-level.

## Containment boundaries

The interface can disable buttons and publish warnings, but it cannot reverse transactions. The version registry can coordinate future factories after its delay; it cannot rewrite existing tokens, markets, vaults, or liquidity. Never promise recovery or use an undisclosed emergency path.

## Evidence checklist

- transaction and internal-call traces
- emitted events and block numbers
- contract bytecode and verified source state
- registry active/pending factory and activation time
- market reserves, token balances, reward accounting, and adapter balances
- RPC responses from at least two providers
- deployment SHA and Vercel deployment identity
- screenshots with secrets removed

## Communications

Initial notice: what is affected, when it began, what users should stop doing, and when the next update will arrive. Do not speculate about cause or losses. Use the website status page and official social account. Security details stay private until containment.

## Recovery

- reproduce the issue on a fork
- add a regression test
- obtain reviewer confirmation for contract-level changes
- deploy through the registry delay and 2-of-3 governance when a new factory is required
- re-enable UI paths gradually
- publish resolved status and a postmortem with timeline, impact, cause, remediation, and remaining risk

## Required before broad beta

- dedicated private security email
- named primary and backup incident leads
- tested signer contact tree
- monitoring alerts delivered to two people
- public status update workflow
- external auditor escalation contact

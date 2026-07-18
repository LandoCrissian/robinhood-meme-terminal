# RMT consent migration rehearsal terms — testnet v1

Version: `RMT-CONSENT-MIGRATION-TESTNET-V1`

These terms apply only to the RMT consent-migration rehearsal deployed on Robinhood Chain testnet, chain ID `46630`. The rehearsal is experimental software for testing wallet authorization, token accounting, direct LP-position ownership, refunds, pausing, and deployment verification.

By submitting a rehearsal transaction, the connected wallet confirms all of the following:

1. It is using only valueless test tokens supplied for this rehearsal and will not send ETH, production tokens, bridged assets, or anything expected to have monetary value.
2. It controls the tokens it approves and is not attempting to access, claim, recover, withdraw, or redirect assets owned by another person or contract.
3. It reviewed the exact chain, router, accounting session, token pair, position manager, pool, fee tier, tick range, desired amounts, minimum amounts, minimum liquidity, deadline, and deployment-bound terms hash shown before confirmation.
4. A successful transaction mints a new test position directly to the calling wallet. RMT does not custody the position or choose another beneficiary.
5. Any unused amount from a successful transaction must return to the calling wallet in the same atomic transaction. A failed verification reverts the entire transaction.
6. Tokens sent directly to the router, accounting session, venue, manager, or pool may be permanently inaccessible. Tokens must move only through the reviewed rehearsal flow.
7. The rehearsal venue is an RMT-operated, Sushi V3 ABI-compatible test fixture. It is not an official Sushi deployment, Robinhood product, endorsement, partnership, production AMM, investment product, yield product, recovery service, bridge, or promise of future support.
8. Test results do not establish production safety, profitability, legal compliance, token value, liquidity, price quality, or mainnet readiness. Smart-contract, wallet, network, RPC, indexing, and interface failures remain possible.
9. RMT may keep the rehearsal paused, pause it again, replace the test deployment, or discontinue the interface. The deployed contracts are not upgradeable and cannot be changed in place.
10. No person should rely on this rehearsal for financial, investment, tax, or legal decisions. A separate reviewed release, independent security assessment, and qualified legal review are required before any real-value use.

The deployment-specific acceptance hash is derived from the immutable contract configuration and the Keccak-256 hash of the exact UTF-8 bytes of this file. Editing this file creates a different document and requires a new deployment/version; it does not change any already deployed acceptance hash.

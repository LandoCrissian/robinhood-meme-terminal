# SafeL2 1.4.1 isolated earnings fixture

`runtime.json` materializes the unchanged SafeL2 singleton, proxy factory and
compatibility handler from the already committed
`docs/evidence/mobile-signing/safe-runtime-4663.json.gz`. The JSON records that
archive's SHA-256, original observation/block and exact official runtime hashes.
The test checks each code hash before creating a real proxy with the official
factory and initializer on chain 31337. Test owners use genuine EIP-712
signatures; no production owner is impersonated or asked to sign.

The bytecode is unmodified Safe software under **LGPL-3.0-only**. Its
[corresponding source, version 1.4.1](https://github.com/safe-global/safe-smart-account/tree/v1.4.1)
retains the original authors and build configuration. LGPL and GPL license
texts accompany this fixture. No Safe implementation is linked into or added
to the RMT production deployment closure by these tests.

These tests prove local contract execution, beneficiary attribution and quorum
enforcement. They do not establish hosted Safe app support or physical-phone
acceptance on Robinhood Chain.

The Safe LP tests fund and credit the actual ledger through its authorized
test engine using synthetic assets. Real Uniswap v4 funding, harvesting and
permanent position custody remain separate regressions in
`RMTV4CurveGraduationV1.t.sol` and `RMTV4SharedPoolSettlement.t.sol`; this fixture
does not claim a newly executed joint Safe/mainnet-fork lifecycle.

# MetaMask delegation 1.3.0 test runtime

The compressed public bytecode fixture is stored at
`apps/launch-website/lib/server/claim-delegate-runtime.test.json.gz`. It records
the exact deployed `EIP7702StatelessDeleGator` 1.3.0 runtime at
`0x63c0c19a282a1B52b07dD5a65b58948A07DAE32B`, hash
`0xa06befcb6f1d7b6c566a607d9d5d932f9b267f3470e55940225c6ee9c4c5e6b0`.
Official Robinhood and Pocket public RPCs corroborated its unmodified bytes
at block 117601397, hash
`0x31afb21d824e4cfbb437cf59a4f5a49448304631afc0538f2162fa441f6d5903`.

The corresponding source is MetaMask Delegation Framework commit
[`bfbdf9795a976833ed2fa000baf42fbb83958b03`](https://github.com/MetaMask/delegation-framework/tree/bfbdf9795a976833ed2fa000baf42fbb83958b03),
particularly
[`src/EIP7702/EIP7702StatelessDeleGator.sol`](https://github.com/MetaMask/delegation-framework/blob/bfbdf9795a976833ed2fa000baf42fbb83958b03/src/EIP7702/EIP7702StatelessDeleGator.sol).
Its SPDX expression is **MIT AND Apache-2.0**. Unmodified upstream MIT and
Apache 2.0 license notices accompany this fixture; original authorship and
copyright are retained. No MetaMask branding, application code or UI is copied.

The isolated test installs these public implementation bytes and the standard
`0xef0100` designator on a freshly generated synthetic account using Anvil
state controls. Genuine test-key type-2 transactions exercise the existing
delegated-account path. They carry no new EIP-7702 authorization list. No
owner key, owner signature, production delegation change or mainnet
transaction is involved. Revoked/replaced state is also synthetic.

This is a test dependency, not a new protocol deployment or an expansion of
the RMT contract compiler closure. Copying bytecode, local execution and
source correspondence do not establish an independent security audit or
physical wallet acceptance.

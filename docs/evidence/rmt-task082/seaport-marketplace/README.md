# Seaport 1.6 source and market evidence

**BLOCKED_NO_BROADCAST. No current order or acquisition route is approved.**

The official and Pocket Robinhood providers corroborated block **118311199**, hash `0x34328dc4ce9c3d49debc95a21b2827a217165be696e466e2f0a70af61e07d8c3`, timestamp **2026-11-19 15:10:16 UTC**. The [raw observation](independent-source-4663.json.gz) preserves chain, runtime, domain, conduit, canonical historical receipt and public API responses. No transaction or owner signature was requested.

## Independent source reproduction

Blockscout remained unavailable, but [Sourcify's current v2 public API](https://sourcify.dev/server/v2/contract/4663/0x0000000000000068F116a894984e2DB1123eB395?fields=all) supplied source/compiler inputs. The old Sourcify repository endpoints returned 404; that is preserved separately from the working v2 API. RMT independently ran checksum-pinned **solc 0.8.24** and reconstructed Seaport's 23,981-byte runtime. All executable bytes and 12 named immutable bindings match both actual providers. Name/version/type hashes, chain, deployment-bound domain, controller, conduit creation-code hash and the deterministic TLOAD canary are checked. The compiler uses Cancun, viaIR, optimizer 9,999,999 and bytecodeHash `none`.

The canonical controller's [Ethereum source record](https://sourcify.dev/server/v2/contract/1/0x00000000F9490004C11Cef243f5400493c00Ad63?fields=all) was independently compiled with **solc 0.8.14**. Its executable code and the embedded Conduit match Robinhood. Two exact **53-byte CBOR metadata** differences are retained and explicitly applied to compare complete on-chain hashes. The original metadata's IPFS fetch returned 403, so this is **not** a claim to have rebuilt the original metadata input. The controller/conduit source qualification remains explicit; a strict production policy may reject it. The verifier must never turn an executable-byte match into permission to omit source or proxy checks.

| Contract | Actual runtime Keccak-256 |
| --- | --- |
| Seaport `0x0000000000000068F116a894984e2DB1123eB395` | `0x95809b70c9659c30188db5fdd87103e24b1a55379af8c851fca393aba0224a00` |
| Controller `0x00000000F9490004C11Cef243f5400493c00Ad63` | `0x880348b652e7cce91216153a4d0107e70c77b92192f3d7a127ff1f1351961948` |
| OpenSea conduit `0x963f00d3ff000064ffcba824b800c0000000c300` | `0x069efdc9b946a332dce9951324fa197268e3ff0e00e44c6bf36049fc53113a41` |

`source-manifest.json` pins every source, compiler binary and structured input. `*-input.json.gz` contains unmodified source content with explicit output requests; `*-compiled.json.gz` is independently produced bytecode/ABI, not a hosted assertion. The full public source API responses are retained to reproduce provenance. The exact compiler invocations and both current-provider equality assertions are in `scripts/seaport-verification/provenance-rebuild.mjs`.

Source licenses are MIT according to each source's SPDX declaration and compiler metadata. Copied source is confined to these archival compiler inputs; it is not imported into the RMT production contract tree. [The upstream license and copyright notice](UPSTREAM_LICENSE.txt) are retained. Public source/addresses are not a professional security audit.

## Execution constraints

- The observed wrapped-native asset is a **TransparentUpgradeableProxy**, not an immutable WETH9 contract. Its proxy runtime alone is insufficient; implementation, EIP1967 administration and upgrade policy need their own admission. No ERC20 production route follows from its symbol or address.
- Seaport 1.6 transfers ERC721 with `transferFrom`, **without an ERC721 safe-receiver callback**. ERC1155 uses `safeTransferFrom`. Existing acquisition V1 only tracks its own synthetic venue's guarded purchases. Forced ERC721 arrival would be untracked; ERC1155 outside its expected receive window is rejected. It is not a Seaport-compatible accounting/custody vault.
- The recorded historical fill is a WETH **bid** with a nonzero signed zone. It is neither a current open listing nor part of the strict FULL_OPEN NFT sell subset. Its fee/royalty consideration is historical evidence only. No LAMMB order or purchase is authorized.
- Current listing access still returned 401. No real current seller authorization, executable order, marketplace accounting policy or production RMT receiver is admitted. ERC2981 is an RMT admission check, not a royalty guarantee supplied by Seaport.

The new `packages/contracts/seaport-verification/test/fixtures` receiver is explicitly **chain-31337-only test custody**, not a production acquisition implementation. It invokes the genuine source-derived Seaport, checks actual NFT ownership/quantity, and exposes no outgoing NFT or arbitrary-call path. Its absence of a reviewed project budget/notice controller is intentionally a production-route blocker. Foundry execution results belong in the parent acceptance report after CI actually runs them; local compilation alone does not prove execution.

[Fresh WETH proxy bindings](wrapped-native-proxy-current-4663.json.gz) at block **118318351** corroborate implementation `0xc6b81b429797e0f555440b70cd99e032d7ae947e`, ProxyAdmin `0xa3acd31afb851b4eb9dad00f5204c01d924267df`, and its observed owner `0x2A153c6A1B66DBc930a8d7017230ab0253005C09` through both providers. Source, signer/quorum and upgrade policy for that authority are **not** established by those reads. An earlier request at the already-aged block118311199 failed on the official provider's historical-state availability; the fresh successful observation does not establish archive retention. A separate initial fresh attempt had an unavailable owner getter on one provider. Neither failure was treated as a zero address or accepted corroboration.

## Reproduction and scan boundary

```sh
node scripts/seaport-verification/provenance-rebuild.mjs \
  --solc-seaport /pinned/solc-0.8.24 --solc-controller /pinned/solc-0.8.14 \
  --offline --output /outside/repository/source-proof.json
node scripts/seaport-verification/fixture-compile.mjs --solc /pinned/solc-0.8.26 \
  --output packages/contracts/seaport-verification/official-artifacts.json
forge test --root packages/contracts/seaport-verification --use /pinned/solc-0.8.26 -vvv
node --test scripts/seaport-verification/provenance-rebuild.test.mjs
```

Omit `--offline` only for fresh bounded, read-only provider observations. Original fixed-identifier endpoints are used; this CLI never accepts wallet keys, marketplace calldata or an arbitrary URL. All real signing and broadcasting remain absent.

The unchanged Gitleaks 8.30.1 raw scan produced **nine** generic-key observations: the public OpenSea conduit identifier and the exact historical WETH/NFT contract references. [Original redacted scanner rows](raw-gitleaks-report.json.gz) and [individual public-data bindings](public-data-classification.json) preserve the failure before compression. No unclassified observation was archived. This is not a zero-finding raw scan or clearance of the separate history/security gates.

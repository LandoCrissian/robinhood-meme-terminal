# Across funding trust rebind — 2026-08-20

This evidence records a read-only revalidation of the existing Ethereum, Arbitrum, Base to Robinhood USDG funding scope. It does not enable quotes, wallet authorization, or submission.

Official contract source: `https://docs.across.to/chains-and-contracts`

EIP-1967 implementation slot: `0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc`

| Chain | Proxy | Proxy runtime hash | Implementation | Implementation runtime hash | Evidence block | Evidence block hash |
| --- | --- | --- | --- | --- | ---: | --- |
| Ethereum (1) | `0x5c7BCd6E7De5423a257D81B442095A1a6ced35C5` | `0x932cddc50793da935ccf915651ad67f6b746e9936fcc5614f0ff492563782c75` | `0x456Ac26E5ec083EE9889eBa0d1a0A582502B8e84` | `0x94cc890a705ae8f4b973b6531b201fcd53c6bcbefba7caa12d1812f6fcede5bf` | 25800117 | `0x184b42d83764a82e7b9121faca5e4181335b5f3836fe749a0338dcc540750585` |
| Arbitrum (42161) | `0xe35e9842fceaCA96570B734083f4a58e8F7C5f2A` | `0x932cddc50793da935ccf915651ad67f6b746e9936fcc5614f0ff492563782c75` | `0xcfCDA84333431BCC9155f2368B8362F0d1dfF8c9` | `0xa860f20748abfdf98f4e55411b5db7630457bec1abfb5d88f1ecd5f25b4ec24b` | 496695413 | `0xf7b9419163aa2e6192beef6cfe7c825e3b665f8c364d28f762fc73096e90cc81` |
| Base (8453) | `0x09aea4b2242abC8bb4BB78D537A67a245A7bEC64` | `0x932cddc50793da935ccf915651ad67f6b746e9936fcc5614f0ff492563782c75` | `0xf23C6C04A2B88e8651FE99bbDccbB5C9D306e6B0` | `0xb36f3bbdffcc931890a4354aa13c9756f032cf6f968d1d1a9604cb3ece9eb480` | 50242535 | `0x173788716d9f7ca55787ae992aea08894aa5e6a3dc7367deb22bde8febf70e90` |
| Robinhood (4663) | `0xD29C85F15DF544bA632C9E25829fd29d767d7978` | `0xbad165a67f16d7be75d8197acdecb912517a516ce0ca2249dee18cd643577f61` | `0x1771c470d41b8c39338450C380bf2C080a2CEdD8` | `0x14f3a4a73c4a0aa5499d7ae7c3a11c0195bc769d46ff8e62b0c614faee8a95ed` | 41884302 | `0x71f71f823eab1901185e87595f6d39679e8f167f040c2db7ddf05a077ef08962` |

All four proxy addresses and proxy runtime hashes remain unchanged from the 2026-08-11 evidence. All four implementation addresses and implementation runtime hashes changed, so the old implementation pins are stale.

Each observation pinned an explicit block, read proxy bytecode, the EIP-1967 implementation slot, and implementation bytecode at that block, then reread the block hash. The local checkout did not expose the production dedicated authenticated RPC credentials; public fallback RPCs were used for this development evidence. Production readiness remains independently fail-closed unless all dedicated authenticated RPC configuration and exact manifest-matching environment pins are present.

Swap API discovery authority is `/swap/chains`, `/swap/tokens`, and `/swap/approval`. `/available-routes` is legacy comparison data only. The current read-only approximately 5-USDC route probes for all three admitted origins returned direct `bridgeableToBridgeable` evidence, zero application fee, the admitted source SpokePool target, and the exact Robinhood USDG output identity. Provider simulation remained false for the intentionally unfunded diagnostic wallet, so RMT correctly rejects those probes as live authorization evidence.

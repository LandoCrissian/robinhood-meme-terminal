# Exact public history additions

The original full-history detector and its 17 immutable public-identity records remain unchanged. Task 091 adds five observed public matches: four explorer verification job identifiers captured from the normal source-publication API responses, and the Solidity type name in the classifier's exact source-expression proof. All raw findings and exit 1 remain visible.

The four identifiers are bound to source commit `e36af6bb627a22ca33b8da435dda1ac94b9c49b5`, original Git blob/line identities, actual response hashes, exact contract targets and compiler-input/payload hashes. The type is bound to classifier commit `f5d5edeb728594911aa983202031d14ce1952e18`, its exact blob/line and the original 66-source compiler input. No arbitrary job identifier, token-shaped string, path or future commit is admitted.

`scripts/security/public-task091-identities.mjs` delegates all original observations to their unchanged verifier and reconciles only these five additions. Missing, duplicate, altered or unknown findings fail; generated canaries still fail. The existing CI entry runs all prior tests plus the new immutable-evidence refusal cases. Neither detector configuration nor the historical ignore file changed.

[Exact immutable identities](exact-public-identities.json) and the retained original raw report are inputs to this review. The final CI artifact supplies the unchanged full-history raw scan, classification and canary evidence on the draft's exact head. This is public-data adjudication after a raw failure, not a clean-scan or financial-acceptance claim.

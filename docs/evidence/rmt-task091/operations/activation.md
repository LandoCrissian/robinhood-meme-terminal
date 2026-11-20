# Minimum core creator activation

The production read-only deployment remains accepted and unchanged. Current
provider identity and the three Production binding metadata records match the
accepted Netlify/Railway resources. [Current observations](control-plane-observation.json)
and [backup inventory](railway-backups.json) are read-only captures.

**Owner creation remains blocked** by the pending canonical factory publication,
current production recovery acceptance and current physical-iPhone creation
review. [Exact operator and device actions](acceptance.json) are the remaining
operational handoff. PostgreSQL has no provider backup, backup schedule or PITR;
the earlier encrypted owner-local backup has no verified off-device recovery.
There are no registered Railway SSH keys or existing public database proxy, so
the current lock cannot be queried from this laptop without adding access.
[observe-writer.sql](observe-writer.sql) is a bounded READ ONLY observation for
the existing authorized private console. No access was added.

After those gates and the owner's separate creation approval, prepare one
reviewable Netlify Production change retaining the existing three read bindings.
Use the plan's already-approved default scopes; keep the read token secret.
The four additional server settings are:

| Key | Exact value or evidence-bound content |
| --- | --- |
| `RMT_CURVE_PRODUCTION_PREPARATION` | `rmt-curve-fixed-supply-security-v2-4663-task066` |
| `RMT_CURVE_PRODUCTION_RELEASE` | Exact UTF-8 JSON below, populated only from accepted records |
| `RMT_CURVE_PRODUCTION_RELEASE_SHA256` | SHA-256 of those exact JSON bytes |
| `RMT_CURVE_PRODUCTION_EXECUTION` | `owner-creation-approved` |

The release schema is `profile`, `chainId:4663`,
`origin:"https://www.rmtlaunch.fun"`,
`compilerInputSha256:"66aa27a8f98a395ba76cbf770a890107a56c60af4a5975bfdadd349c84273e10"`,
`factoryRuntimeHash:"0x519d55e694263866896e05023834b124829173f13f42c5aea7e3ca2200c5a091"`,
five SHA-256 fields (`ownerCreationApprovalSha256`,
`fullSourceVerificationSha256`, `operationalAcceptanceSha256`,
`l1FinalityPolicyAcceptanceSha256`, `indexingRecoveryAcceptanceSha256`), and
`publication:{transactionHash,blockNumber,blockHash}` from the verified
**execution** receipt. No placeholder or hash of this handoff is an acceptance
attestation. A valid release JSON cannot be finalized while those records are
missing. `curve-production.ts` enforces exact keys, origin, hash, runtimes,
bindings, two independent current providers and at least 20 L2 blocks after the
canonical publication. This does not independently prove Ethereum L1 finality;
the named policy requires a genuine owner decision on that limitation.

Select the exact artifact in the new owner approval: either the already accepted
website source `b79515752ef42e88850ac2cea953955a3bb03087`, server ZIP SHA-256
`08d237501b2c16de95627a3e773d9092cc3050c155e39c2d33449503b564c345`,
with this reviewed binding diff, or a newly built, tested and hash-bound artifact
from the exact Task091 release head. The accepted ZIP is not a Task091 artifact:
Task091 updates the earnings-readiness explanation while preserving the literal
execution block and HTTP 404. Record whichever source/ZIP is actually approved;
do not relabel the existing bytes. The earlier read-only rollout approval grants
no financial activation authority. No deployment or setting change is performed
by Task091.
After an approved activation, require hosted config `owner-creation-only`, fresh
authenticated discovery and unchanged server authority checks before the owner
uses `/create-token`: `RMT`, `RMT`, empty URI, no separate treasury, share `0`.
Only the owner reviews and sends the original wallet request. Verify its exact
canonical receipt and new-engine indexed registration; never resubmit on timeout.
Publication enables direct public onchain creation even while the website stays
disabled. It is irreversible; disabling website flags does not undo publication.
Maintain fix-forward recovery of journals and records.

**Production trading and claims are a separate source gap.** The existing config
explicitly returns `trading:"disabled", claims:"disabled"`, the production
earnings HTTP handler always returns 404, and its execution switch is a literal
`false`. Only synthetic 31337 trade/claim execution is implemented. The isolated
economic lifecycle passes, but changing any environment flag cannot activate a
complete 4663 website trade/claim flow. The existing production claim verifier is
read-only. This PR cannot honestly call general financial website activation
ready. Safe beneficiary claims have synthetic proof; Safe website CREATE remains
unsupported. Keep all fixtures, profiles and optional Treasury/NFT/Reclaim flags
unset. No governance signature, broadcast, RMT creation or financial activation
occurred.

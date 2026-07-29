# RMT collaborator consent protocol

## Purpose

RMT collaborators must be able to review the exact credit, role, wallet, proposed share, asset revision, network, terms, and expiration before signing. A creator cannot mark another person as accepted.

This protocol does not mint, list, license, transfer, approve, charge, pay, or guarantee revenue.

## Invitation binding

Each invitation uses EIP-712 typed data and binds:

- schema version;
- project slug and asset identifier;
- deterministic asset revision hash;
- collaborator name, role, and exact EVM wallet;
- proposed share in basis points;
- chain ID;
- expiration no more than 30 days away;
- consent terms hash;
- one-time random nonce.

Changing any bound field changes the invitation digest and signature.

## Storage and visibility

The complete invitation is stored privately below:

`projectAssignments/{projectSlug}/assets/{assetId}/consentInvitations/{invitationId}`

Only the assigned creator and RMT administrator can read it. The invitation link carries the same creator-supplied fields in its URL fragment, which browsers do not send as part of the normal page request. Anyone who receives or copies that link can still read those fields, so creators must use a trusted delivery channel.

A separate public marker at:

`creatorConsentStatuses/{invitationId}`

contains only the fingerprint, project, asset, expiration, and `pending`, `revoked`, `accepted`, or `rejected` status. It excludes collaborator name, wallet, role, share, signature, and private rights information. The signing page fails closed when this marker is missing, mismatched, unavailable, or revoked.

Private invitation and public marker creation/revocation are atomic. Firestore rules reject one-sided state changes.

## Response states

Current states:

1. `pending`: the creator saved an invitation and RMT can verify its public revocation marker.
2. `revoked`: the creator atomically revoked the private invitation and public marker.
3. `expired`: derived from the signed expiration; it cannot be reversed by a browser or wallet.
4. `accepted`: RMT received and verified the invited wallet's signed acceptance while the invitation was pending and the revision was unchanged.
5. `rejected`: RMT received and verified the invited wallet's signed rejection under the same conditions.

The trusted server receipt:

- receives the response before expiration;
- verifies the signer against the invited wallet;
- rejects a revoked invitation;
- makes an exact retry idempotent and rejects a different response after finalization;
- rechecks the unchanged asset revision;
- stores the action, signature, signer, signed response time, and server receipt time in the private invitation record.

An offline `respondedAt` value is signed but is not trustworthy proof of when RMT received the response. It cannot be used to backdate an expired response.

## Creator flow

1. Save a valid private asset revision.
2. Add a collaborator name, role, and wallet.
3. Prepare a seven-day link.
4. RMT stores the private invitation and public status atomically.
5. Send the link directly to the invited wallet owner.
6. The collaborator connects the exact wallet and signs acceptance or rejection.
7. The browser submits the encoded response to RMT's same-origin receipt endpoint.
8. RMT records an accepted or rejected final state after every server check passes.
9. The creator can inspect the saved receipt state. Release readiness recognizes only accepted receipts for the exact current revision, wallet, role, name, and proposed share.

## Threat model

- A modified packet fails its digest check.
- A different wallet fails signer recovery.
- A response for another nonce, asset revision, action, share, role, or chain fails.
- A creator cannot write `accepted` or `rejected` through Firestore; only the Admin-backed receipt endpoint can finalize.
- A creator cannot mutate an invitation after creation.
- A creator can revoke only a pending invitation, and cannot restore it.
- Invitation records and status markers cannot be deleted through the client.
- A missing or unreachable revocation marker disables signing.
- A copied link exposes its creator-supplied contents to the recipient; it is not a secret-bearing authentication token.

## Remaining production work

- Configure a dedicated least-privilege Firebase Admin credential in the production host; without it the endpoint fails closed with `503`.
- Replace the single-instance request limiter with a durable distributed limiter if abuse or traffic warrants it.
- Creator and collaborator notifications.
- Signed collaborator-initiated revocation policy before release freeze.
- Immutable accepted-consent manifest consumed by future collection and split contracts.
- Privacy, legal, and independent security review before marketplace execution.

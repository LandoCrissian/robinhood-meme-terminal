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

contains only the fingerprint, project, asset, expiration, and `pending` or `revoked` status. It excludes collaborator name, wallet, role, share, signature, and private rights information. The signing page fails closed when this marker is missing, mismatched, unavailable, or revoked.

Private invitation and public marker creation/revocation are atomic. Firestore rules reject one-sided state changes.

## Response states

Current states:

1. `pending`: the creator saved an invitation and RMT can verify its public revocation marker.
2. `revoked`: the creator atomically revoked the private invitation and public marker.
3. `expired`: derived from the signed expiration; it cannot be reversed by a browser or wallet.
4. `signed acceptance, unreceipted`: the invited wallet signed `accept` for the exact invitation.
5. `signed rejection, unreceipted`: the invited wallet signed `reject` for the exact invitation.

The final `accepted` or `rejected` state is deliberately not implemented. It requires a trusted server receipt that:

- receives the response before expiration;
- verifies the signer against the invited wallet;
- rejects a revoked invitation;
- rejects a response used more than once;
- rechecks the unchanged asset revision;
- stores the signature and server receipt time immutably.

An offline `respondedAt` value is signed but is not trustworthy proof of when RMT received the response. It cannot be used to backdate an expired response.

## Creator flow

1. Save a valid private asset revision.
2. Add a collaborator name, role, and wallet.
3. Prepare a seven-day link.
4. RMT stores the private invitation and public status atomically.
5. Send the link directly to the invited wallet owner.
6. The collaborator connects the exact wallet and signs acceptance or rejection.
7. The collaborator returns the encoded response.
8. The creator can verify the signature locally.

The creator UI may display valid cryptographic evidence, but release readiness stays blocked until the trusted receipt service exists.

## Threat model

- A modified packet fails its digest check.
- A different wallet fails signer recovery.
- A response for another nonce, asset revision, action, share, role, or chain fails.
- A creator cannot write `accepted` through Firestore.
- A creator cannot mutate an invitation after creation.
- A creator can revoke only a pending invitation, and cannot restore it.
- Invitation records and status markers cannot be deleted through the client.
- A missing or unreachable revocation marker disables signing.
- A copied link exposes its creator-supplied contents to the recipient; it is not a secret-bearing authentication token.

## Remaining production work

- Trusted response receipt endpoint with Firebase and wallet-signature verification.
- Abuse controls and rate limits.
- Idempotent response storage.
- Creator and collaborator notifications.
- Signed collaborator-initiated revocation policy before release freeze.
- Immutable accepted-consent manifest consumed by future collection and split contracts.
- Privacy, legal, and independent security review before marketplace execution.

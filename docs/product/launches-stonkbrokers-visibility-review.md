# StonkBrokers discovery visibility review

Authorized production base: `8d776b23369e94dbb86722d5b279c343f802958d`.

## Established boundary

Actual public captures at 375, 390, 430 and 1440 showed only **All sources**
and **pons**. The first page contained 50 Pons entries and no StonkBrokers
entries. The authenticated producer and public web API returned the same
first-page composition. A source-specific bounded query returned 40 genuine
StonkBrokers entries: 33 BONDING, five LAUNCHED and two GRADUATED, with no
next cursor. Six previously independently verified production samples from
the STONK, SPCX and WETH pads remained present with unchanged states.

These counts describe the observed indexed snapshot, not complete all-time
coverage. The lowest first-page launch block was 79,312,267; the highest
StonkBrokers launch block was 79,163,746. The existing descending launch-block
and launch-ID ordering correctly places those StonkBrokers records beyond
page one. Source identifiers and all three lifecycle states survive the
producer, reader validation, public API and row presentation.

The first loss is the discovery component's source-navigation construction:
it inferred available sources from the currently loaded entries. A correct
Pons-only first page therefore hid a genuinely indexed StonkBrokers source.
Direct production SQL inspection was unavailable through the existing access;
the authenticated persisted-directory read establishes producer availability.
No database access or configuration was provisioned for this investigation.

## Correction

The server establishes available sources independently of page/search contents.
Already validated entries establish their own source. For a missing source
recognized in producer source-status metadata, the existing authenticated
reader performs a source-specific one-record query. Only a positively validated
indexed entry admits that filter. Configured sources, empty responses, invalid
provenance, failed reads and timeouts cannot invent availability.

There are at most two sequential one-record probes, using the reader's existing
bounded timeout and 15-second Next data cache. The usual Pons-only landing page
needs one StonkBrokers probe. No per-browser RPC discovery, producer query,
source manifest, checkpoint or lifecycle semantics change.

The existing chronological All view and cursor-based **More launches** action
remain unchanged. All does not promise alternating sources or complete history.
Source filters provide direct bounded access to older indexed records. The
scanner rows and exact-token workspace navigation retain their existing design.

## Previous acceptance correction

Earlier release evidence was **ACTUAL_PUBLIC_STONKBROKERS_ROW** in a
**DIFFERENT_PAGINATION_STATE**: the script opened exact-token search URLs before
capturing real StonkBrokers rows and testing navigation. It was neither synthetic
nor producer-only. Its unfiltered landing screenshots showed Pons-only rows.

That evidence proves actual row rendering and navigation from exact-token search.
It does not prove default source-filter discoverability. The earlier general
StonkBrokers presentation PASS overstated that part of acceptance. Preserve the
historical evidence; this review corrects its interpretation.

## Validation boundaries

Controlled regressions cover a Pons-only first page, empty search pages,
positive source-specific evidence, missing/invalid evidence, unavailable probes,
bounded sequential reads, and the actual rendered source-navigation links.
The visual suite separately exercises the Pons-only page at all four widths.
Those controlled tests are not production acceptance.

Pre-deployment browser acceptance uses the corrected local production build
with genuine records read from the unchanged production producer. It must be
reported separately from actual public-before captures. No corrected public
deployment is authorized by this task. Production-after acceptance remains a
future release gate.

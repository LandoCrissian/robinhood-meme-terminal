# Approval identity retry acceptance: clock-domain correction

Base: `a4d4560c77bf952ff4d7e6fc83d942dea8ffa770`.

The unmodified isolated identity-retry journey passed on desktop and mobile.
Adding 750 ms of post-approval authorization latency reproduced the failed
acceptance without changing application code. The browser's accelerated clock
was 9,847 ms ahead of the real Next server when the new swap plan arrived.
That plan was already expired by 699 ms according to the browser.

The captured sequence was approval authorization, one mocked approval request,
successful post-approval verification, injected IDENTITY_UNAVAILABLE, retry,
successful verification, and HTTP 200 swap authorization. There was no second
wallet handoff. The successful identity retry was not lost: fresh authority was
rejected because the fixture advanced only one side of its clock contract.

The identical 750 ms latency control passed on both viewports with client and
server time advancing together. Production freshness checks must not be weakened
to accommodate a synthetic clock mismatch. This correction changes acceptance
only, retaining exact-envelope, allowance, simulation and settlement assertions.
It adds healthy, multiple-transient, persistent-failure, account/chain-change
during retry, and UUID-restoration identity controls. Persistent failure remains
bounded to four read-only preparation attempts and never repeats approval.

No live-wallet root cause is claimed. No trading, directory, fee, authentication,
Production configuration, or execution-authority source is changed.

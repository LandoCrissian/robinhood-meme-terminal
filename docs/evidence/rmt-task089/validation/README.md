# Task 089 local validation

These are local worktree results on exact starting commit `78a76feb592ac136dbf74d4823c21db64a6d0313` plus this candidate's changes. They are separate from final-head GitHub CI, whose immutable job/artifact identities are recorded in the PR body after completion.

Gzipped primary Linux logs retain 27 proof/provenance tests, six compiler-helper tests, four initial-governance tests, 20 stage-policy tests, 72 readiness tests, both application typechecks and Knip. `proof-primary-verification.json` records the source-bound 22-finding verifier. Discovery's package separately retains its tests-first three-failure run, 47 focused passing tests and 327 full website tests.

Recovered-source Windows results use Node 22.23.2 and pnpm 10.12.1 with a full frozen installation: all 327 website tests, nine final RSC-helper tests, 92 combined policy/readiness tests, both application typechecks, whole-harness syntax and final Knip pass. Logs are retained here; `windows-results.json` records the principal exit codes.

The unchanged compiler-helper suite has five passes and one Windows failure: the symlink rejection test cannot create its setup symlink because Windows returns `EPERM`. No assertion was removed or skipped, and no elevated privilege was requested. The earlier Linux six-test pass is retained; ordinary Linux CI repeats the full suite and real native compiler smoke.

After adding the standalone reproducible archive-scan producer, the final inventory check found it unused. Registering that actual executable as a normal Knip entry corrected the issue; `knip-windows-final.txt` retains the passing result and the same two historical hints. No dependency ignore was added. `setup-observations.json` preserves earlier isolated setup limitations.

Journey counts observed before the provider's quota pause have different raw-artifact availability. Read [journey evidence limits](../journey/README.md) before treating those observations as reproducible reports. The new core CI matrix repeats all four final browser/layout combinations and the PostgreSQL drill; existing discovery and website/wallet-profile regressions remain enabled and unchanged.

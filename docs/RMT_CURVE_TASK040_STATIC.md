# Task 040 Slither source-mapping reproduction

The **46 vs 24 high-finding discrepancy is reproducible and explained**. Foundry put LF source bytes in its compiler build-info while the Windows working tree presented CRLF. Slither read the disk bytes to translate compiler byte offsets into source lines. In the CRLF run that translation moved findings away from pre-existing suppressions. The mismatch caused 22 additional high and four additional informational rows elsewhere in the tree. It made no change to executable code or detector logic.

## Source, tools and measured output

The source is [#592](https://github.com/LandoCrissian/robinhood-meme-terminal/pull/592) at `5fe80e04713cd0d72dedc087ede3a54ba2d6920d`, Solidity tree `e98de2eaedcf9d233bac0860094e7179db2ab562`. The cited Linux run checked out `0a3f123e9efa022e9574428c80156faac39b204f`, whose complete Git tree `c28c3f95ee7b46e0c1522d3ed92d1401902d9e63` matches #592. This identifies the actual workflow checkout behind the Linux link in Task 039. [Original Linux log](https://github.com/LandoCrissian/robinhood-meme-terminal/actions/runs/43511948049/job/132184137163) · [Merge Git object](https://api.github.com/repos/LandoCrissian/robinhood-meme-terminal/git/commits/0a3f123e9efa022e9574428c80156faac39b204f)

The controlled pair ran in the same Windows x64 environment using Python 3.14.8, Slither 0.11.5, Crytic Compile 0.3.11, and byte-identical Foundry build-info with SHA-256 `c1f58d697b7d1a584996930f03605fb991400a363e643805296e8df3e67684c0`. That build-info uses Forge 1.7.1 and native Solidity 0.8.26+commit.8a97fa7a. Its 173 source inputs include 96 first-party files. Every first-party compiler input matched its frozen Git blob byte for byte. Every Windows disk source differed from its LF compiler input, and all 173 matched after converting CRLF to LF. The installed compiler hashes and flags remain pinned by the existing handoff. [Compiler pins](RMT_CURVE_TASK039_REVIEW_HANDOFF.md#exact-source-and-build-inputs)

| Run | Contracts / detectors | Total findings | High findings | Gate |
| --- | ---: | ---: | --- | --- |
| Recorded GitHub Linux, native build | 244 / 101 | 290 | 24 = 18 active + 6 standalone escrow | Failed |
| Windows, same build-info and CRLF disk bytes | 244 / 101 | 316 | 46 = same 24 + 22 elsewhere | Failed |
| Windows, same build-info and LF disk bytes | 244 / 101 | 290 | 24 = same 18 active + 6 standalone escrow | Failed |
| Windows, fresh Foundry compile and LF disk bytes | 244 / 101 | 290 | 24 = same 18 active + 6 standalone escrow | Failed |
| Exact 4663 compiler closure from Task 039, imports visible | 76 / 101 | 215 | 22 = same 18 active + 4 imported dependency findings | Failed |

The comparison key uses detector, impact, confidence, element type/name and relative source byte start/length. All 290 LF results occur in the CRLF results by that key. All 290 LF descriptions also occur in the hosted Linux transcript. The 26 CRLF-only rows comprise seven `arbitrary-send-eth`, eleven `reentrancy-balance`, four `reentrancy-eth` and four informational `low-level-calls` findings. Recalculating their source mapping from the LF bytes and running Slither 0.11.5's original `has_ignore_comment` returned true for all 26. The original filter was identical in both runs. Both stages contained no triage database. The fresh Windows compile also reproduces all 290 LF finding descriptions with the original compile and gate flags. Its build-info SHA-256 is `b9bc4b48b83b9cd4f548f7f90721f4d732eff61ec56d50a888ae12e4d0f4c8c2`. It has the same 173 input source texts. The scratch copy discovers different unused auto remappings, so it is supplemental detector evidence. Use the byte-identical build-info pair for the causal comparison and the pinned 4663 manifest for deployment bytecode. [Release closure and separate historical gaps](RMT_CURVE_TASK039_STATIC_ANALYSIS.md)

The compressed reproduction archive contains both controlled runs, the additional fresh Windows run, the source-relevant portion of the hosted Linux gate log and a comparison manifest. The Windows output retains detector IDs and findings, with temporary paths and line endings normalized. Archive SHA-256 `c73e7c4c71f5c81e72deed91b245cb5d7a8f39b62d5227c3b08586a82c68e40d`. [Raw reproduction logs and row comparison](evidence/rmt-task040/static/slither-source-mapping.tar.gz)

For example, the `DirectLaunchFeeSplitter._split` function starts at source line 200, directly after its existing `reentrancy-eth` annotation on line 199. At the compiler's byte offset 9,323, the CRLF remapping reported the span at lines 195–206. Slither checked the line before that shifted start and missed the annotation. Crytic Compile's Foundry parser takes the compiler AST from build-info, and its later source lookup loads file bytes from disk. Slither translates the compiler offsets with those bytes and evaluates existing line annotations with the result. [Frozen source location](https://github.com/LandoCrissian/robinhood-meme-terminal/blob/5fe80e04713cd0d72dedc087ede3a54ba2d6920d/packages/contracts/src/DirectLaunchFeeSplitter.sol#L198) · [Crytic Build-info loader](https://github.com/crytic/crytic-compile/blob/0.3.11/crytic_compile/platform/hardhat.py#L69) · [Crytic disk source lookup](https://github.com/crytic/crytic-compile/blob/0.3.11/crytic_compile/crytic_compile.py#L427) · [Slither source mapping](https://github.com/crytic/slither/blob/0.11.5/slither/core/source_mapping/source_mapping.py#L129) · [Slither annotation evaluation](https://github.com/crytic/slither/blob/0.11.5/slither/core/slither_core.py#L418)

The staged “LF” copy in Task 039 did not actually contain LF bytes. The local `git archive` for the example file produced 13,157 bytes with 268 CRLFs under `core.autocrlf=true`. Repeating it with `git -c core.autocrlf=false archive` produced the exact 12,889-byte Git blob with zero CRLFs. Checking the bytes matters even for a Git archive.

## Reproduce without any change to the gate

Use the [existing dependency and compiler setup](RMT_CURVE_TASK039_STATIC_ANALYSIS.md#reproduce) in a clean isolated #592 checkout. From its `packages/contracts`, build fresh with the pinned compiler. Assign the resulting single build-info file and an unused scratch path (whose name includes none of the workflow's excluded path patterns).

```sh
export FOUNDRY_SOLC="$PINNED_SOLC"
export FOUNDRY_OFFLINE=true
forge build --build-info --skip './test/**' './script/**' --force
# BUILD_INFO points to the new out/build-info/*.json file.
# NEW_SCRATCH is an unused absolute directory.
python - "$BUILD_INFO" "$PWD/foundry.toml" "$NEW_SCRATCH" <<'PY'
import json
import sys
from pathlib import Path

info, config, scratch = map(Path, sys.argv[1:])
raw = info.read_bytes()
build = json.loads(raw)
for source_mode in ("compiler-lf", "windows-crlf"):
    output = scratch / source_mode
    output.mkdir(parents=True, exist_ok=False)
    (output / "out/build-info").mkdir(parents=True)
    (output / "out/build-info" / info.name).write_bytes(raw)
    (output / "foundry.toml").write_bytes(config.read_bytes())
    for name, item in build["input"]["sources"].items():
        file = Path(name)
        assert file.parts[0] in {"src", "lib"} and ".." not in file.parts
        data = item["content"].encode("utf-8")
        assert b"\r\n" not in data
        dest = output / file
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(data if source_mode == "compiler-lf" else data.replace(b"\n", b"\r\n"))
PY

filter='(lib/|test/|script/|broadcast/|src/BondingCurveMarket.sol|src/LaunchRewardVault.sol|src/MemeLaunchFactory.sol|src/LowCostMemeLaunchFactory.sol|src/LowCostMemeLaunchFactoryV2.sol|src/LowCostMemeLaunchFactoryV3.sol|src/clone/CloneBondingCurveMarket.sol)'
for source_mode in compiler-lf windows-crlf; do
  (
    cd "$NEW_SCRATCH/$source_mode" || exit 1
    python -m slither . --ignore-compile --fail-high --filter-paths "$filter" \
      --json "../$source_mode.json" > "../$source_mode.log" 2>&1
  )
  printf '%s Slither exit: %s\n' "$source_mode" "$?"
done
```

The controlled replay uses `--ignore-compile` only to force both diagnostics to consume the same AST. The workflow continues to compile and run with its original severity gate and filter. For release review, verify the checkout source bytes match the compiler inputs and keep the line-accurate full-tree analysis alongside the separate 4663 closure. Existing inline annotations and the V1 and V2 historical analysis-coverage gaps remain visible to the reviewer. The count resolution changes neither the disposition of the active findings nor the independent review requirement.

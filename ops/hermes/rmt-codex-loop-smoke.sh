#!/usr/bin/env bash
set -euo pipefail

# Disposable host-side regression smoke for rmt-codex-loop.sh. It creates only
# temporary repositories and never uses the caller's checkout as a task target.

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
runner="$script_dir/rmt-codex-loop.sh"
skill="$script_dir/../../.agents/skills/rmt-control-plane/SKILL.md"
scratch="$(mktemp -d "${TMPDIR:-/tmp}/rmt-loop-smoke.XXXXXX")"
trap 'rm -rf -- "$scratch"' EXIT

fail() {
  printf 'FAIL: %s\n' "$*" >&2
  exit 1
}

require_text() {
  local file="$1" text="$2"
  grep -Fq -- "$text" "$file" || fail "expected '$text' in $file"
}

remote="$scratch/origin.git"
clone="$scratch/normal"
linked="$scratch/linked"
git init --bare --initial-branch=main "$remote" >/dev/null
git clone --quiet "$remote" "$clone"
git -C "$clone" config user.name "RMT loop smoke"
git -C "$clone" config user.email "rmt-loop-smoke@example.invalid"
printf 'authority\n' > "$clone/AUTHORITY.txt"
git -C "$clone" add AUTHORITY.txt
git -C "$clone" commit --quiet -m "smoke base"
base_sha="$(git -C "$clone" rev-parse HEAD)"
git -C "$clone" push --quiet origin main

drift_sha="$(printf 'smoke drift candidate\n' | git -C "$clone" commit-tree "$(git -C "$clone" rev-parse 'HEAD^{tree}')" -p "$base_sha")"
git -C "$clone" push --quiet origin "$drift_sha:refs/rmt-smoke/drift"
git -C "$clone" worktree add --quiet --detach "$linked" "$base_sha"

fake_codex="$scratch/fake-codex.sh"
cat > "$fake_codex" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
case "${SMOKE_ACTION:?}" in
  write)
    mkdir -p ops/hermes/canary
    printf 'PASS\n' > ops/hermes/canary/SMOKE.txt
    ;;
  task-mutation)
    printf 'mutated\n' >> "$SMOKE_TASK_FILE"
    ;;
  validator-mutation)
    printf '# mutated\n' >> "$SMOKE_VALIDATOR_FILE"
    ;;
  branch-switch)
    git switch --quiet --detach HEAD
    ;;
  branch-ref)
    git branch rmt-forbidden-smoke-branch
    ;;
  commit)
    mkdir -p ops/hermes/canary
    printf 'committed\n' > ops/hermes/canary/SMOKE.txt
    git add ops/hermes/canary/SMOKE.txt
    git -c user.name='RMT guard smoke' -c user.email='guard@example.invalid' commit --quiet -m 'forbidden smoke commit'
    ;;
  tag)
    git tag rmt-forbidden-smoke-tag
    ;;
  out-of-scope)
    printf 'forbidden\n' > FORBIDDEN.txt
    ;;
  main-drift)
    git --git-dir="$SMOKE_REMOTE" update-ref refs/heads/main "$SMOKE_DRIFT_SHA"
    ;;
  *)
    printf 'Unknown smoke action: %s\n' "$SMOKE_ACTION" >&2
    exit 2
    ;;
esac
EOF
chmod +x "$fake_codex"

validator_template="$scratch/validator-template.sh"
cat > "$validator_template" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
test "$(cat "$1/ops/hermes/canary/SMOKE.txt")" = PASS
EOF
chmod +x "$validator_template"

case_number=0
run_case() {
  local label="$1" repo="$2" action="$3" expected="$4"
  case_number=$((case_number + 1))
  local task_id="smoke-${case_number}-${label}"
  local case_root="$scratch/cases/$task_id"
  local task_file="$case_root/task.md"
  local validator="$case_root/validator.sh"
  local worktrees="$case_root/worktrees"
  local runs="$case_root/runs"
  local output="$case_root/output.log"
  mkdir -p "$case_root"
  printf 'Create the allowed smoke fixture only.\n' > "$task_file"
  cp "$validator_template" "$validator"
  chmod +x "$validator"

  set +e
  RMT_REPO_ROOT="$repo" \
  RMT_WORKTREE_ROOT="$worktrees" \
  RMT_RUN_ROOT="$runs" \
  CODEX_BIN="$fake_codex" \
  SMOKE_ACTION="$action" \
  SMOKE_TASK_FILE="$task_file" \
  SMOKE_VALIDATOR_FILE="$validator" \
  SMOKE_REMOTE="$remote" \
  SMOKE_DRIFT_SHA="$drift_sha" \
    "$runner" \
      --task-id "$task_id" \
      --base-ref main \
      --base-sha "$base_sha" \
      --task-file "$task_file" \
      --validator "$validator" \
      --allow ops/hermes/canary/ \
      --max-iterations 1 \
      --max-minutes 5 > "$output" 2>&1
  local status=$?
  set -e

  require_text "$output" "$expected"
  if [ "$expected" = READY_FOR_OWNER_REVIEW ] && [ "$status" -ne 0 ]; then
    fail "$label should pass"
  fi
  if [ "$expected" != READY_FOR_OWNER_REVIEW ] && [ "$status" -eq 0 ]; then
    fail "$label should stop"
  fi

  if git -C "$clone" worktree list --porcelain | grep -Fqx "worktree $worktrees/$task_id"; then
    git -C "$clone" worktree remove --force "$worktrees/$task_id"
  fi
  git -C "$clone" branch -D "agent/$task_id" >/dev/null 2>&1 || true
  git -C "$clone" branch -D rmt-forbidden-smoke-branch >/dev/null 2>&1 || true
  git -C "$clone" tag -d rmt-forbidden-smoke-tag >/dev/null 2>&1 || true
  git --git-dir="$remote" update-ref refs/heads/main "$base_sha"
  printf 'PASS: %s\n' "$label"
}

run_rejected_repo_case() {
  local label="$1" repo="$2"
  case_number=$((case_number + 1))
  local case_root="$scratch/cases/rejected-$case_number-$label"
  mkdir -p "$case_root"
  printf 'read only\n' > "$case_root/task.md"
  cp "$validator_template" "$case_root/validator.sh"
  chmod +x "$case_root/validator.sh"
  set +e
  RMT_REPO_ROOT="$repo" CODEX_BIN="$fake_codex" \
    "$runner" --task-id "rejected-$case_number-$label" --base-ref main --base-sha "$base_sha" \
      --task-file "$case_root/task.md" --validator "$case_root/validator.sh" \
      --allow ops/hermes/canary/ > "$case_root/output.log" 2>&1
  local status=$?
  set -e
  [ "$status" -ne 0 ] || fail "$label should be rejected"
  require_text "$case_root/output.log" STOP_FOR_OWNER_REVIEW
  printf 'PASS: %s\n' "$label"
}

if grep -Eq '^platforms:' "$skill"; then
  fail "repo-local control-plane skill must not be platform-restricted"
fi
require_text "$skill" 'requires_toolsets: [terminal]'
require_text "$runner" 'max_iterations=3'
require_text "$runner" '[ "$max_iterations" -gt 6 ]'
if grep -En '^[[:space:]]*git[[:space:]].*[[:space:]](commit|push|merge)([[:space:]]|$)' "$runner"; then
  fail "runner contains a prohibited Git mutation command"
fi
printf 'PASS: Windows skill metadata and bounded runner policy\n'

mkdir -p "$scratch/not-git"
run_rejected_repo_case non-git "$scratch/not-git"
run_rejected_repo_case bare "$remote"
run_case normal-clone "$clone" write READY_FOR_OWNER_REVIEW
run_case linked-worktree "$linked" write READY_FOR_OWNER_REVIEW
run_case task-mutation "$clone" task-mutation STOP_VALIDATOR_ERROR
run_case validator-mutation "$clone" validator-mutation STOP_VALIDATOR_ERROR
run_case branch-switch "$clone" branch-switch STOP_SCOPE_VIOLATION
run_case new-branch "$clone" branch-ref STOP_SCOPE_VIOLATION
run_case new-commit "$clone" commit STOP_SCOPE_VIOLATION
run_case new-tag "$clone" tag STOP_SCOPE_VIOLATION
run_case out-of-scope "$clone" out-of-scope STOP_SCOPE_VIOLATION
run_case moving-main "$clone" main-drift STOP_FOR_OWNER_REVIEW

printf 'RMT_CONTROL_PLANE_STATIC_VALIDATION=PASS\n'

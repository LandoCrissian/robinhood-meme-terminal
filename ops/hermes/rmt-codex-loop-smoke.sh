#!/usr/bin/env bash
set -euo pipefail

# Disposable host-side regression smoke for the canonical model-neutral loop.
# It creates only temporary repositories and fake adapters; no inference runs.

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
runner="$script_dir/rmt-agent-loop.sh"
skill="$script_dir/../../.agents/skills/rmt-control-plane/SKILL.md"
scratch="$(mktemp -d "${TMPDIR:-/tmp}/rmt-loop-smoke.XXXXXX")"
trap 'rm -rf -- "$scratch"' EXIT

fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }
require_text() {
  if ! grep -Fq -- "$2" "$1"; then
    printf '%s\n' "--- $1 ---" >&2
    cat "$1" >&2
    fail "expected '$2' in $1"
  fi
}

remote="$scratch/origin.git"
clone="$scratch/normal"
linked="$scratch/linked"
git init --bare --initial-branch=main "$remote" >/dev/null
git clone --quiet "$remote" "$clone"
git -C "$clone" config user.name "RMT loop smoke"
git -C "$clone" config user.email "rmt-loop-smoke@example.invalid"
printf 'authority\n' > "$clone/AUTHORITY.txt"
printf 'bounded context\n' > "$clone/CONTEXT.txt"
git -C "$clone" add AUTHORITY.txt CONTEXT.txt
git -C "$clone" commit --quiet -m "smoke base"
base_sha="$(git -C "$clone" rev-parse HEAD)"
git -C "$clone" push --quiet origin main
drift_sha="$(printf 'smoke drift candidate\n' | git -C "$clone" commit-tree "$(git -C "$clone" rev-parse 'HEAD^{tree}')" -p "$base_sha")"
git -C "$clone" push --quiet origin "$drift_sha:refs/rmt-smoke/drift"
git -C "$clone" worktree add --quiet --detach "$linked" "$base_sha"

make_worker() {
  local path="$1" action="$2"
  {
    printf '#!/usr/bin/env bash\nset -euo pipefail\naction=%q\n' "$action"
    cat <<'EOF'
worktree="" task_file="" validator_file="" iteration=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --worktree) worktree="$2"; shift 2 ;;
    --task-file) task_file="$2"; shift 2 ;;
    --validator-file) validator_file="$2"; shift 2 ;;
    --iteration) iteration="$2"; shift 2 ;;
    --worker-file|--task-id|--base-sha|--allow|--context|--validator-evidence|--immutable-relative) shift 2 ;;
    *) exit 2 ;;
  esac
done
cd "$worktree"
case "$action" in
  write|secret-env)
    if [ "$action" = secret-env ] && [ "${RMT_SMOKE_FAKE_SECRET+x}" = x ]; then exit 91; fi
    mkdir -p ops/hermes/canary
    printf 'PASS\n' > ops/hermes/canary/SMOKE.txt
    ;;
  write-then-stop)
    if [ "$iteration" -eq 1 ]; then
      mkdir -p ops/hermes/canary
      printf 'PASS\n' > ops/hermes/canary/SMOKE.txt
    else
      exit 10
    fi
    ;;
  stop) exit 10 ;;
  error) exit 20 ;;
  task-mutation) printf 'mutated\n' >> "$task_file" ;;
  validator-mutation) printf '# mutated\n' >> "$validator_file" ;;
  worker-mutation) printf '# mutated\n' >> "$0" ;;
  branch-switch) git switch --quiet --detach HEAD ;;
  branch-ref) git branch rmt-forbidden-smoke-branch ;;
  commit)
    mkdir -p ops/hermes/canary
    printf 'committed\n' > ops/hermes/canary/SMOKE.txt
    git add ops/hermes/canary/SMOKE.txt
    git -c user.name='RMT guard smoke' -c user.email='guard@example.invalid' commit --quiet -m 'forbidden smoke commit'
    ;;
  tag) git tag rmt-forbidden-smoke-tag ;;
  out-of-scope) printf 'forbidden\n' > FORBIDDEN.txt ;;
  main-drift)
    remote_url="$(git remote get-url origin)"
    candidate="$(git ls-remote "$remote_url" refs/rmt-smoke/drift | cut -f1)"
    git --git-dir="$remote_url" update-ref refs/heads/main "$candidate"
    ;;
  *) exit 2 ;;
esac
EOF
  } > "$path"
  chmod +x "$path"
}

run_worker_gate_case() {
  local label="$1" action="$2" expected="$3" iterations="$4"
  case_number=$((case_number + 1))
  local task_id="gate-${case_number}-${label}"
  local case_root="$scratch/cases/$task_id" marker="$scratch/cases/$task_id/validator-invoked.log"
  local task_file="$case_root/task.md" validator="$case_root/validator.sh"
  local worker="$case_root/worker.sh" worktrees="$case_root/worktrees"
  local runs="$case_root/runs" output="$case_root/output.log"
  mkdir -p "$case_root"
  printf 'Exercise worker status gating only.\n' > "$task_file"
  cat > "$validator" <<EOF
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "\$RMT_LOOP_ITERATION" >> "$marker"
if [ "$action" = write-then-stop ] && [ "\$RMT_LOOP_ITERATION" -eq 1 ]; then
  test "\$(cat "\$1/ops/hermes/canary/SMOKE.txt")" = PASS
  exit 42
fi
exit 0
EOF
  chmod +x "$validator"
  make_worker "$worker" "$action"

  set +e
  RMT_REPO_ROOT="$clone" RMT_WORKTREE_ROOT="$worktrees" RMT_RUN_ROOT="$runs" \
    "$runner" --task-id "$task_id" --base-ref main --base-sha "$base_sha" \
      --task-file "$task_file" --validator "$validator" \
      --worker-adapter "$worker" --worker-kind LOCAL_PATCH \
      --worker-endpoint http://127.0.0.1:65535/v1 --worker-model smoke-local \
      --allow ops/hermes/canary/ --max-iterations "$iterations" --max-minutes 5 \
      > "$output" 2>&1
  local status=$?
  set -e
  [ "$status" -ne 0 ] || fail "$label must not pass"
  require_text "$output" "$expected"
  if grep -Fq READY_FOR_OWNER_REVIEW "$output"; then fail "$label was overridden by validator"; fi
  if [ "$action" = write-then-stop ]; then
    test "$(cat "$marker")" = 1 || fail "validator ran after worker stop"
  else
    [ ! -e "$marker" ] || fail "validator ran after worker error"
  fi
  git -C "$clone" worktree remove --force "$worktrees/$task_id" >/dev/null 2>&1 || true
  git -C "$clone" branch -D "agent/$task_id" >/dev/null 2>&1 || true
  printf 'PASS: %s\n' "$label"
}

validator_template="$scratch/validator-template.sh"
cat > "$validator_template" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
test "$RMT_LOOP_WORKER_KIND" = LOCAL_PATCH
test -n "$RMT_LOOP_WORKER_FILE"
test -n "$RMT_LOOP_WORKER_HASH"
test "$(cat "$1/ops/hermes/canary/SMOKE.txt")" = PASS
EOF
chmod +x "$validator_template"

case_number=0
run_case() {
  local label="$1" repo="$2" action="$3" expected="$4"
  case_number=$((case_number + 1))
  local task_id="smoke-${case_number}-${label}"
  local case_root="$scratch/cases/$task_id"
  local task_file="$case_root/task.md" validator="$case_root/validator.sh"
  local worker="$case_root/worker.sh" worktrees="$case_root/worktrees"
  local runs="$case_root/runs" output="$case_root/output.log"
  mkdir -p "$case_root"
  printf 'Create the allowed smoke fixture only.\n' > "$task_file"
  cp "$validator_template" "$validator"
  chmod +x "$validator"
  make_worker "$worker" "$action"

  set +e
  RMT_REPO_ROOT="$repo" \
  RMT_WORKTREE_ROOT="$worktrees" \
  RMT_RUN_ROOT="$runs" \
  RMT_SMOKE_FAKE_SECRET='must-not-cross-env-i' \
    "$runner" \
      --task-id "$task_id" \
      --base-ref main \
      --base-sha "$base_sha" \
      --task-file "$task_file" \
      --validator "$validator" \
      --worker-adapter "$worker" \
      --worker-kind LOCAL_PATCH \
      --worker-endpoint http://127.0.0.1:65535/v1 \
      --worker-model smoke-local \
      --allow ops/hermes/canary/ \
      --context CONTEXT.txt \
      --max-iterations 1 \
      --max-minutes 5 > "$output" 2>&1
  local status=$?
  set -e

  require_text "$output" "$expected"
  if [ "$expected" = READY_FOR_OWNER_REVIEW ] && [ "$status" -ne 0 ]; then fail "$label should pass"; fi
  if [ "$expected" != READY_FOR_OWNER_REVIEW ] && [ "$status" -eq 0 ]; then fail "$label should stop"; fi

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
  local root="$scratch/cases/rejected-$case_number-$label"
  mkdir -p "$root"
  printf 'read only\n' > "$root/task.md"
  cp "$validator_template" "$root/validator.sh"
  chmod +x "$root/validator.sh"
  make_worker "$root/worker.sh" write
  set +e
  RMT_REPO_ROOT="$repo" "$runner" \
    --task-id "rejected-$case_number-$label" --base-ref main --base-sha "$base_sha" \
    --task-file "$root/task.md" --validator "$root/validator.sh" \
    --worker-adapter "$root/worker.sh" --worker-kind LOCAL_PATCH \
    --worker-endpoint http://127.0.0.1:65535/v1 --worker-model smoke-local \
    --allow ops/hermes/canary/ > "$root/output.log" 2>&1
  local status=$?
  set -e
  [ "$status" -ne 0 ] || fail "$label should be rejected"
  require_text "$root/output.log" STOP_FOR_OWNER_REVIEW
  printf 'PASS: %s\n' "$label"
}

run_missing_worker_case() {
  local root="$scratch/cases/missing-worker"
  mkdir -p "$root"
  printf 'read only\n' > "$root/task.md"
  cp "$validator_template" "$root/validator.sh"
  chmod +x "$root/validator.sh"
  set +e
  RMT_REPO_ROOT="$clone" "$runner" \
    --task-id missing-worker --base-ref main --base-sha "$base_sha" \
    --task-file "$root/task.md" --validator "$root/validator.sh" \
    --worker-adapter "$root/absent.sh" --worker-kind LOCAL_PATCH \
    --worker-endpoint http://127.0.0.1:65535/v1 --worker-model smoke-local \
    --allow ops/hermes/canary/ > "$root/output.log" 2>&1
  status=$?
  set -e
  [ "$status" -ne 0 ] || fail "missing worker should be rejected"
  require_text "$root/output.log" STOP_R2_APPROVAL_REQUIRED
  printf 'PASS: missing worker adapter\n'
}

if grep -Eq '^platforms:' "$skill"; then fail "repo-local skill must not be platform-restricted"; fi
require_text "$skill" 'requires_toolsets: [terminal]'
require_text "$runner" 'max_iterations=3'
require_text "$runner" '[ "$max_iterations" -gt 6 ]'
require_text "$runner" 'V1 worker-kind must be LOCAL_PATCH.'
if grep -En '^[[:space:]]*git[[:space:]].*[[:space:]](commit|push|merge)([[:space:]]|$)' "$runner"; then
  fail "canonical runner contains a prohibited Git mutation command"
fi
printf 'PASS: Windows skill metadata and bounded model-neutral policy\n'

mkdir -p "$scratch/not-git"
run_rejected_repo_case non-git "$scratch/not-git"
run_rejected_repo_case bare "$remote"
run_missing_worker_case

host_location_root="$scratch/cases/host-location"
mkdir -p "$host_location_root/worktrees" "$host_location_root/runs"
printf 'read only\n' > "$host_location_root/task.md"
cp "$validator_template" "$host_location_root/validator.sh"
chmod +x "$host_location_root/validator.sh"
make_worker "$host_location_root/worktrees/forbidden-worker.sh" write
set +e
RMT_REPO_ROOT="$clone" RMT_WORKTREE_ROOT="$host_location_root/worktrees" RMT_RUN_ROOT="$host_location_root/runs" \
  "$runner" --task-id forbidden-host-location --base-ref main --base-sha "$base_sha" \
  --task-file "$host_location_root/task.md" --validator "$host_location_root/validator.sh" \
  --worker-adapter "$host_location_root/worktrees/forbidden-worker.sh" --worker-kind LOCAL_PATCH \
  --worker-endpoint http://127.0.0.1:65535/v1 --worker-model smoke-local \
  --allow ops/hermes/canary/ > "$host_location_root/output.log" 2>&1
host_location_status=$?
set -e
[ "$host_location_status" -ne 0 ] || fail "worker under worktree root should stop"
require_text "$host_location_root/output.log" 'outside the disposable worktree root'
printf 'PASS: worker host-controlled location\n'

run_case normal-clone "$clone" write READY_FOR_OWNER_REVIEW
run_case linked-worktree "$linked" write READY_FOR_OWNER_REVIEW
run_case sanitized-env "$clone" secret-env READY_FOR_OWNER_REVIEW
run_case task-mutation "$clone" task-mutation STOP_VALIDATOR_ERROR
run_case validator-mutation "$clone" validator-mutation STOP_VALIDATOR_ERROR
run_case worker-mutation "$clone" worker-mutation STOP_VALIDATOR_ERROR
run_case branch-switch "$clone" branch-switch STOP_SCOPE_VIOLATION
run_case new-branch "$clone" branch-ref STOP_SCOPE_VIOLATION
run_case new-commit "$clone" commit STOP_SCOPE_VIOLATION
run_case new-tag "$clone" tag STOP_SCOPE_VIOLATION
run_case out-of-scope "$clone" out-of-scope STOP_SCOPE_VIOLATION
run_case moving-main "$clone" main-drift STOP_FOR_OWNER_REVIEW
run_worker_gate_case worker-stop-cannot-be-overridden write-then-stop STOP_FOR_OWNER_REVIEW 2
run_worker_gate_case worker-error-cannot-be-overridden error STOP_VALIDATOR_ERROR 1

collision_root="$scratch/cases/collision"
mkdir -p "$collision_root/worktrees" "$collision_root/runs/collision"
printf 'preserve\n' > "$collision_root/runs/collision/old-evidence.txt"
printf 'read only\n' > "$collision_root/task.md"
cp "$validator_template" "$collision_root/validator.sh"
chmod +x "$collision_root/validator.sh"
make_worker "$collision_root/worker.sh" write
set +e
RMT_REPO_ROOT="$clone" RMT_WORKTREE_ROOT="$collision_root/worktrees" RMT_RUN_ROOT="$collision_root/runs" \
  "$runner" --task-id collision --base-ref main --base-sha "$base_sha" \
  --task-file "$collision_root/task.md" --validator "$collision_root/validator.sh" \
  --worker-adapter "$collision_root/worker.sh" --worker-kind LOCAL_PATCH \
  --worker-endpoint http://127.0.0.1:65535/v1 --worker-model smoke-local \
  --allow ops/hermes/canary/ > "$collision_root/output.log" 2>&1
collision_status=$?
set -e
[ "$collision_status" -ne 0 ] || fail "non-empty run collision should stop"
require_text "$collision_root/output.log" 'refusing to reuse'
printf 'PASS: run-directory collision\n'

printf 'RMT_CONTROL_PLANE_STATIC_VALIDATION=PASS\n'

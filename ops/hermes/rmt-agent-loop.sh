#!/usr/bin/env bash
set -euo pipefail

# RMT bounded model-neutral engineering loop.
#
# The host owns repository authority, exact-SHA isolation, immutable inputs,
# scope checks, iteration/time budgets, and the independent pass/fail validator.
# A worker adapter is an implementation mechanism only. This runner never
# commits, pushes, merges, deploys, changes production, signs, or broadcasts.

usage() {
  cat <<'EOF'
Usage:
  rmt-agent-loop.sh \
    --task-id <safe-id> \
    --base-ref <ref> \
    --base-sha <40-char-sha> \
    --task-file <host-side-path> \
    --validator <host-side-executable> \
    --worker-adapter <host-controlled-executable> \
    --worker-kind <LOCAL_PATCH|CODEX_OPTIONAL> \
    --allow <repo-path> [--allow <repo-path> ...] \
    [--context <repo-relative-text-file> ...] \
    [--worker-endpoint <http://127.0.0.1:port/v1>] \
    [--worker-model <model-id>] \
    [--max-iterations <1-6>] \
    [--max-minutes <5-120>]

Environment:
  RMT_REPO_ROOT       Existing RMT checkout. Defaults to this script's Git root.
  RMT_WORKTREE_ROOT   Defaults to ~/.rmt-agent/worktrees.
  RMT_RUN_ROOT        Defaults to ~/.rmt-agent/runs.
  RMT_AGENT_PYTHON    Optional exact host Python executable for Python adapters.

The worker receives only an explicit minimal environment and command arguments.
The validator receives:
  RMT_LOOP_WORKTREE
  RMT_LOOP_BASE_REF
  RMT_LOOP_BASE_SHA
  RMT_LOOP_TASK_ID
  RMT_LOOP_ITERATION
  RMT_LOOP_TASK_FILE / RMT_LOOP_TASK_HASH
  RMT_LOOP_VALIDATOR_FILE / RMT_LOOP_VALIDATOR_HASH
  RMT_LOOP_WORKER_FILE / RMT_LOOP_WORKER_HASH / RMT_LOOP_WORKER_KIND

The validator receives the worktree path as argv[1].
EOF
}

stop() {
  local state="$1"
  shift
  printf '\n%s\n' "$state" >&2
  if [ "$#" -gt 0 ]; then printf '%s\n' "$*" >&2; fi
  exit 20
}

normalize_host_file_path() {
  local input="$1"
  if command -v cygpath >/dev/null 2>&1; then
    cygpath -am "$input"
  else
    printf '%s/%s\n' "$(cd "$(dirname "$input")" && pwd)" "$(basename "$input")"
  fi
}

is_safe_repo_path() {
  local value="$1"
  [ -n "$value" ] || return 1
  [[ "$value" != /* ]] || return 1
  [[ "$value" != *\\* ]] || return 1
  [[ "$value" != .git && "$value" != .git/* ]] || return 1
  local segment
  IFS='/' read -r -a segments <<< "$value"
  for segment in "${segments[@]}"; do
    [ -n "$segment" ] || return 1
    [ "$segment" != . ] || return 1
    [ "$segment" != .. ] || return 1
  done
}

path_has_symlink_component() {
  local root="$1" relative="$2" current segment
  current="$root"
  IFS='/' read -r -a segments <<< "$relative"
  for segment in "${segments[@]}"; do
    current="$current/$segment"
    if [ -L "$current" ]; then return 0; fi
  done
  return 1
}

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="${RMT_REPO_ROOT:-$(git -C "$script_dir" rev-parse --show-toplevel 2>/dev/null || true)}"
worktree_root="${RMT_WORKTREE_ROOT:-$HOME/.rmt-agent/worktrees}"
run_root="${RMT_RUN_ROOT:-$HOME/.rmt-agent/runs}"

task_id=""
base_ref=""
base_sha=""
task_file=""
validator=""
worker_adapter=""
worker_kind=""
worker_endpoint=""
worker_model=""
max_iterations=3
max_minutes=60
declare -a allowed_paths=()
declare -a context_paths=()

while [ "$#" -gt 0 ]; do
  case "$1" in
    --task-id) task_id="${2:-}"; shift 2 ;;
    --base-ref) base_ref="${2:-}"; shift 2 ;;
    --base-sha) base_sha="${2:-}"; shift 2 ;;
    --task-file) task_file="${2:-}"; shift 2 ;;
    --validator) validator="${2:-}"; shift 2 ;;
    --worker-adapter) worker_adapter="${2:-}"; shift 2 ;;
    --worker-kind) worker_kind="${2:-}"; shift 2 ;;
    --worker-endpoint) worker_endpoint="${2:-}"; shift 2 ;;
    --worker-model) worker_model="${2:-}"; shift 2 ;;
    --allow) allowed_paths+=("${2:-}"); shift 2 ;;
    --context) context_paths+=("${2:-}"); shift 2 ;;
    --max-iterations) max_iterations="${2:-}"; shift 2 ;;
    --max-minutes) max_minutes="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) printf 'Unknown argument: %s\n' "$1" >&2; usage >&2; exit 2 ;;
  esac
done

if [ -z "$repo_root" ] || [ "$(git -C "$repo_root" rev-parse --is-inside-work-tree 2>/dev/null || true)" != true ]; then
  stop STOP_FOR_OWNER_REVIEW "RMT_REPO_ROOT is not a Git worktree."
fi
if [ "$(git -C "$repo_root" rev-parse --is-bare-repository 2>/dev/null || true)" != false ]; then
  stop STOP_FOR_OWNER_REVIEW "RMT_REPO_ROOT must not be a bare repository."
fi
git_common_dir="$(git -C "$repo_root" rev-parse --path-format=absolute --git-common-dir 2>/dev/null || true)"
if [ -z "$git_common_dir" ] || [ ! -d "$git_common_dir" ]; then
  stop STOP_FOR_OWNER_REVIEW "RMT_REPO_ROOT has no resolvable common Git directory."
fi
if ! git -C "$repo_root" remote get-url origin >/dev/null 2>&1; then
  stop STOP_FOR_OWNER_REVIEW "RMT_REPO_ROOT has no origin remote."
fi
if ! [[ "$task_id" =~ ^[A-Za-z0-9._-]+$ ]]; then
  stop STOP_FOR_OWNER_REVIEW "Unsafe or missing task id."
fi
if [ -z "$base_ref" ] || [[ "$base_ref" == -* ]] || [[ "$base_ref" == *".."* ]]; then
  stop STOP_FOR_OWNER_REVIEW "Unsafe or missing base ref."
fi
if ! [[ "$base_sha" =~ ^[0-9a-fA-F]{40}$ ]]; then
  stop STOP_FOR_OWNER_REVIEW "An exact 40-character base SHA is required."
fi
if [ -z "$task_file" ] || [ ! -f "$task_file" ]; then
  stop STOP_FOR_OWNER_REVIEW "Task file is missing or unreadable."
fi
if [ -z "$validator" ] || [ ! -f "$validator" ] || [ ! -x "$validator" ]; then
  stop STOP_VALIDATOR_ERROR "Validator must be an existing executable host file."
fi
if [ -z "$worker_adapter" ] || [ ! -f "$worker_adapter" ] || [ ! -x "$worker_adapter" ]; then
  stop STOP_R2_APPROVAL_REQUIRED "Worker adapter must be an existing executable host file."
fi
case "$worker_kind" in
  LOCAL_PATCH|CODEX_OPTIONAL) ;;
  *) stop STOP_FOR_OWNER_REVIEW "worker-kind must be LOCAL_PATCH or CODEX_OPTIONAL." ;;
esac
if [ "$worker_kind" = LOCAL_PATCH ]; then
  if ! [[ "$worker_endpoint" =~ ^http://(127\.0\.0\.1|localhost):[0-9]+/v1/?$ ]]; then
    stop STOP_FOR_OWNER_REVIEW "LOCAL_PATCH requires an explicit loopback-only OpenAI-compatible /v1 endpoint."
  fi
  [ -n "$worker_model" ] || stop STOP_FOR_OWNER_REVIEW "LOCAL_PATCH requires an explicit model id."
elif [ -n "$worker_endpoint" ]; then
  stop STOP_FOR_OWNER_REVIEW "Only LOCAL_PATCH may receive a local model endpoint."
fi
if [ "${#allowed_paths[@]}" -eq 0 ]; then
  stop STOP_FOR_OWNER_REVIEW "At least one allowed repository path is required."
fi
if [ "${#context_paths[@]}" -gt 8 ]; then
  stop STOP_FOR_OWNER_REVIEW "At most eight explicit context files are permitted."
fi
if ! [[ "$max_iterations" =~ ^[0-9]+$ ]] || [ "$max_iterations" -lt 1 ] || [ "$max_iterations" -gt 6 ]; then
  stop STOP_FOR_OWNER_REVIEW "max-iterations must be between 1 and 6."
fi
if ! [[ "$max_minutes" =~ ^[0-9]+$ ]] || [ "$max_minutes" -lt 5 ] || [ "$max_minutes" -gt 120 ]; then
  stop STOP_FOR_OWNER_REVIEW "max-minutes must be between 5 and 120."
fi
for allowed in "${allowed_paths[@]}"; do
  is_safe_repo_path "${allowed#./}" || stop STOP_FOR_OWNER_REVIEW "Unsafe allowed path: $allowed"
done
for context in "${context_paths[@]}"; do
  is_safe_repo_path "$context" || stop STOP_FOR_OWNER_REVIEW "Unsafe context path: $context"
done

mkdir -p "$worktree_root" "$run_root"
task_file="$(normalize_host_file_path "$task_file")"
validator="$(normalize_host_file_path "$validator")"
worker_adapter="$(normalize_host_file_path "$worker_adapter")"
repo_root_host="$(normalize_host_file_path "$repo_root/.rmt-repo-sentinel")"
repo_root_host="${repo_root_host%/.rmt-repo-sentinel}"
worktree_root="$(normalize_host_file_path "$worktree_root/.rmt-root-sentinel")"
worktree_root="${worktree_root%/.rmt-root-sentinel}"
run_root="$(normalize_host_file_path "$run_root/.rmt-root-sentinel")"
run_root="${run_root%/.rmt-root-sentinel}"
git_common_dir="$(normalize_host_file_path "$git_common_dir/.rmt-git-sentinel")"
git_common_dir="${git_common_dir%/.rmt-git-sentinel}"

worker_lower="${worker_adapter,,}"
worktree_root_lower="${worktree_root,,}"
git_common_lower="${git_common_dir,,}"
case "$worker_lower" in
  "$worktree_root_lower"/*) stop STOP_FOR_OWNER_REVIEW "Worker adapter must remain outside the disposable worktree root." ;;
  "$git_common_lower"/*) stop STOP_FOR_OWNER_REVIEW "Worker adapter may not live inside the Git common directory." ;;
esac

task_file_hash="$(git -C "$repo_root" hash-object --no-filters -- "$task_file" 2>/dev/null || true)"
validator_hash="$(git -C "$repo_root" hash-object --no-filters -- "$validator" 2>/dev/null || true)"
worker_hash="$(git -C "$repo_root" hash-object --no-filters -- "$worker_adapter" 2>/dev/null || true)"
if ! [[ "$task_file_hash" =~ ^[0-9a-f]{40}$ ]] || ! [[ "$validator_hash" =~ ^[0-9a-f]{40}$ ]] || ! [[ "$worker_hash" =~ ^[0-9a-f]{40}$ ]]; then
  stop STOP_VALIDATOR_ERROR "Unable to establish immutable task/validator/worker identities."
fi

worktree="$worktree_root/$task_id"
run_dir="$run_root/$task_id"
branch="agent/$task_id"

if [ -e "$worktree" ]; then
  stop STOP_FOR_OWNER_REVIEW "Task worktree already exists; refusing to reuse: $worktree"
fi
if git -C "$repo_root" show-ref --verify --quiet "refs/heads/$branch"; then
  stop STOP_FOR_OWNER_REVIEW "Task branch already exists; refusing to reuse: $branch"
fi
if [ -e "$run_dir" ]; then
  if [ ! -d "$run_dir" ] || [ -n "$(ls -A "$run_dir" 2>/dev/null)" ]; then
    stop STOP_FOR_OWNER_REVIEW "Task run directory already contains evidence; refusing to reuse: $run_dir"
  fi
fi
mkdir -p "$run_dir"

fetch_and_require_base() {
  if ! git -C "$repo_root" fetch --quiet origin "$base_ref"; then
    stop STOP_FOR_OWNER_REVIEW "Unable to refresh origin/$base_ref."
  fi
  local remote_sha
  remote_sha="$(git -C "$repo_root" rev-parse "origin/$base_ref" 2>/dev/null || true)"
  if [ "$remote_sha" != "$base_sha" ]; then
    stop STOP_FOR_OWNER_REVIEW "Base drift detected: origin/$base_ref is $remote_sha, task authorized $base_sha."
  fi
  git -C "$repo_root" cat-file -e "${base_sha}^{commit}" 2>/dev/null || stop STOP_FOR_OWNER_REVIEW "Authorized base SHA is unavailable locally."
}

fetch_and_require_base
git -C "$repo_root" worktree add -b "$branch" "$worktree" "$base_sha" >/dev/null

worktree="$(normalize_host_file_path "$worktree/.rmt-worktree-sentinel")"
worktree="${worktree%/.rmt-worktree-sentinel}"
worktree_lower="${worktree,,}"
case "$worker_lower" in
  "$worktree_lower"|"$worktree_lower"/*) stop STOP_FOR_OWNER_REVIEW "Worker adapter must remain outside the disposable task worktree." ;;
esac

total_context_bytes=0
for context in "${context_paths[@]}"; do
  context_file="$worktree/$context"
  if [ ! -f "$context_file" ] || path_has_symlink_component "$worktree" "$context"; then
    stop STOP_FOR_OWNER_REVIEW "Context must be an existing non-symlink text file: $context"
  fi
  context_bytes="$(wc -c < "$context_file" | tr -d '[:space:]')"
  if ! [[ "$context_bytes" =~ ^[0-9]+$ ]] || [ "$context_bytes" -gt 65536 ]; then
    stop STOP_FOR_OWNER_REVIEW "Context file exceeds the 64 KiB per-file bound: $context"
  fi
  total_context_bytes=$((total_context_bytes + context_bytes))
done
if [ "$total_context_bytes" -gt 65536 ]; then
  stop STOP_FOR_OWNER_REVIEW "Explicit context exceeds the 64 KiB total bound."
fi

expected_branch="$branch"
expected_head="$base_sha"
initial_local_refs="$(git -C "$repo_root" for-each-ref --format='%(refname) %(objectname)' refs/heads refs/tags | sort)"

require_host_inputs_unchanged() {
  local current_task_hash current_validator_hash current_worker_hash
  current_task_hash="$(git -C "$repo_root" hash-object --no-filters -- "$task_file" 2>/dev/null || true)"
  current_validator_hash="$(git -C "$repo_root" hash-object --no-filters -- "$validator" 2>/dev/null || true)"
  current_worker_hash="$(git -C "$repo_root" hash-object --no-filters -- "$worker_adapter" 2>/dev/null || true)"
  [ "$current_task_hash" = "$task_file_hash" ] || stop STOP_VALIDATOR_ERROR "Task contract changed during the run. Worktree preserved: $worktree"
  [ "$current_validator_hash" = "$validator_hash" ] || stop STOP_VALIDATOR_ERROR "Host validator changed during the run. Worktree preserved: $worktree"
  [ "$current_worker_hash" = "$worker_hash" ] || stop STOP_VALIDATOR_ERROR "Worker adapter changed during the run. Worktree preserved: $worktree"
}

require_git_identity() {
  local current_branch current_head task_branch_head current_local_refs
  current_branch="$(git -C "$worktree" symbolic-ref --quiet --short HEAD 2>/dev/null || true)"
  current_head="$(git -C "$worktree" rev-parse HEAD 2>/dev/null || true)"
  task_branch_head="$(git -C "$repo_root" rev-parse "refs/heads/$expected_branch" 2>/dev/null || true)"
  current_local_refs="$(git -C "$repo_root" for-each-ref --format='%(refname) %(objectname)' refs/heads refs/tags | sort)"
  [ "$current_branch" = "$expected_branch" ] || stop STOP_SCOPE_VIOLATION "Task worktree branch identity changed. Worktree preserved: $worktree"
  if [ "$current_head" != "$expected_head" ] || [ "$task_branch_head" != "$expected_head" ]; then
    stop STOP_SCOPE_VIOLATION "A worker commit or task-branch ref mutation was detected. Worktree preserved: $worktree"
  fi
  [ "$current_local_refs" = "$initial_local_refs" ] || stop STOP_SCOPE_VIOLATION "A local branch or tag ref changed during the run. Worktree preserved: $worktree"
}

changed_files() {
  {
    git -C "$worktree" diff --name-only "$base_sha" --
    git -C "$worktree" ls-files --others --exclude-standard
  } | sed '/^$/d' | sort -u
}

scope_check() {
  local file allowed normalized permitted violations=0
  while IFS= read -r file; do
    [ -n "$file" ] || continue
    permitted=0
    for allowed in "${allowed_paths[@]}"; do
      normalized="${allowed#./}"
      normalized="${normalized%/}"
      if [ "$file" = "$normalized" ] || [[ "$file" == "$normalized/"* ]]; then permitted=1; break; fi
    done
    if [ "$permitted" -ne 1 ]; then printf 'SCOPE VIOLATION: %s\n' "$file" >&2; violations=$((violations + 1)); fi
  done < <(changed_files)
  [ "$violations" -eq 0 ]
}

started_epoch="$(date +%s)"
last_validation_log=""
within_time_budget() {
  local now elapsed
  now="$(date +%s)"
  elapsed=$((now - started_epoch))
  [ "$elapsed" -lt $((max_minutes * 60)) ]
}

python_bin="${RMT_AGENT_PYTHON:-$(command -v python3 2>/dev/null || command -v python 2>/dev/null || true)}"
if [ -n "$python_bin" ]; then
  python_bin="$(normalize_host_file_path "$python_bin")"
  [ -f "$python_bin" ] || stop STOP_R2_APPROVAL_REQUIRED "RMT_AGENT_PYTHON is not an existing host executable."
fi
worker_path="/usr/bin:/mingw64/bin:/bin"
if [ -n "$python_bin" ]; then worker_path="$(dirname "$python_bin"):$worker_path"; fi
declare -a worker_command
case "${worker_adapter,,}" in
  *.py)
    [ -n "$python_bin" ] || stop STOP_R2_APPROVAL_REQUIRED "Python worker selected without an exact available Python interpreter."
    worker_command=("$python_bin" "$worker_adapter")
    ;;
  *) worker_command=("$worker_adapter") ;;
esac
system_root="${SYSTEMROOT:-${WINDIR:-C:\\Windows}}"
system_drive="${SYSTEMDRIVE:-C:}"
program_data="${PROGRAMDATA:-${system_drive}/ProgramData}"
temp_root="${TEMP:-${TMP:-/tmp}}"

printf 'RMT_LOOP_STARTED\n'
printf 'task=%s\nbase=%s\nbranch=%s\nworktree=%s\nworker_kind=%s\nworker_hash=%s\niterations=%s\nminutes=%s\n' \
  "$task_id" "$base_sha" "$branch" "$worktree" "$worker_kind" "$worker_hash" "$max_iterations" "$max_minutes"

for ((iteration=1; iteration<=max_iterations; iteration++)); do
  within_time_budget || stop STOP_BUDGET_EXHAUSTED "Wall-clock budget reached before iteration $iteration. Worktree preserved: $worktree"
  fetch_and_require_base
  require_host_inputs_unchanged
  require_git_identity

  worker_log="$run_dir/worker-$iteration.log"
  declare -a worker_args=(
    --worktree "$worktree"
    --task-id "$task_id"
    --base-sha "$base_sha"
    --iteration "$iteration"
    --task-file "$task_file"
    --validator-file "$validator"
    --worker-file "$worker_adapter"
  )
  for host_input in "$task_file" "$validator" "$worker_adapter"; do
    host_input_lower="${host_input,,}"
    repo_root_lower="${repo_root_host,,}"
    case "$host_input_lower" in
      "$repo_root_lower"/*)
        immutable_relative="${host_input#"$repo_root_host"/}"
        immutable_relative="${immutable_relative//\\//}"
        worker_args+=(--immutable-relative "$immutable_relative")
        ;;
    esac
  done
  for allowed in "${allowed_paths[@]}"; do worker_args+=(--allow "$allowed"); done
  for context in "${context_paths[@]}"; do worker_args+=(--context "$context"); done
  if [ -n "$last_validation_log" ]; then worker_args+=(--validator-evidence "$last_validation_log"); fi

  printf '\nITERATION %s/%s — IMPLEMENT (%s)\n' "$iteration" "$max_iterations" "$worker_kind"
  set +e
  env -i \
    PATH="$worker_path" \
    SYSTEMROOT="$system_root" \
    SYSTEMDRIVE="$system_drive" \
    WINDIR="$system_root" \
    PROGRAMDATA="$program_data" \
    TEMP="$temp_root" \
    TMP="$temp_root" \
    LANG=C.UTF-8 \
    LC_ALL=C.UTF-8 \
    PYTHONUTF8=1 \
    PYTHONIOENCODING=utf-8 \
    RMT_LOOP_WORKER_KIND="$worker_kind" \
    RMT_LOOP_WORKER_ENDPOINT="$worker_endpoint" \
    RMT_LOOP_WORKER_MODEL="$worker_model" \
      "${worker_command[@]}" "${worker_args[@]}" > >(tee "$worker_log") 2>&1
  worker_status=$?
  set -e

  require_host_inputs_unchanged
  require_git_identity
  scope_check || stop STOP_SCOPE_VIOLATION "Worker changed a path outside the task allowlist. Worktree preserved: $worktree"
  fetch_and_require_base
  require_host_inputs_unchanged
  require_git_identity

  validation_log="$run_dir/validator-$iteration.log"
  printf '\nITERATION %s/%s — VALIDATE\n' "$iteration" "$max_iterations"
  set +e
  RMT_LOOP_WORKTREE="$worktree" \
  RMT_LOOP_BASE_REF="$base_ref" \
  RMT_LOOP_BASE_SHA="$base_sha" \
  RMT_LOOP_TASK_ID="$task_id" \
  RMT_LOOP_ITERATION="$iteration" \
  RMT_LOOP_TASK_FILE="$task_file" \
  RMT_LOOP_TASK_HASH="$task_file_hash" \
  RMT_LOOP_VALIDATOR_FILE="$validator" \
  RMT_LOOP_VALIDATOR_HASH="$validator_hash" \
  RMT_LOOP_WORKER_FILE="$worker_adapter" \
  RMT_LOOP_WORKER_HASH="$worker_hash" \
  RMT_LOOP_WORKER_KIND="$worker_kind" \
    "$validator" "$worktree" > >(tee "$validation_log") 2>&1
  validator_status=$?
  set -e

  require_host_inputs_unchanged
  require_git_identity
  scope_check || stop STOP_SCOPE_VIOLATION "Out-of-scope changes detected after validation. Worktree preserved: $worktree"
  fetch_and_require_base
  require_host_inputs_unchanged
  require_git_identity

  if [ "$validator_status" -eq 0 ]; then
    printf '\nREADY_FOR_OWNER_REVIEW\n'
    printf 'task=%s\nbase=%s\nbranch=%s\nworktree=%s\nworker_kind=%s\niteration=%s\nchanged_files:\n' \
      "$task_id" "$base_sha" "$branch" "$worktree" "$worker_kind" "$iteration"
    changed_files | sed 's/^/  - /'
    printf 'worker_log=%s\nvalidator_log=%s\n' "$worker_log" "$validation_log"
    printf 'No commit, push, PR, merge, deployment, production mutation, signature, or transaction was performed by this runner.\n'
    exit 0
  fi

  last_validation_log="$validation_log"
  printf 'Validator exit: %s; worker exit: %s\n' "$validator_status" "$worker_status"
  if [ "$iteration" -eq "$max_iterations" ] || ! within_time_budget; then
    stop STOP_BUDGET_EXHAUSTED "Acceptance did not pass within the bounded loop. Worktree preserved: $worktree"
  fi
done

stop FAILED "Loop exited unexpectedly. Worktree preserved: $worktree"

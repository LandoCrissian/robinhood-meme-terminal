#!/usr/bin/env bash
set -euo pipefail

# RMT -> Codex local handoff.
#
# Creates a task-specific git worktree at an exact base SHA, runs Codex in that
# worktree, captures the transcript, then fails closed if Codex touched paths
# outside the explicitly allowed scope.
#
# It does NOT commit, push, open/merge a PR, deploy, change production config,
# or provide GitHub/wallet credentials to Codex.

usage() {
  cat <<'EOF'
Usage:
  codex-handoff.sh \
    --task-id <safe-id> \
    --base-sha <40-char-sha> \
    --task-file <path-to-task-contract> \
    --allow <repo-path> [--allow <repo-path> ...]

Optional environment:
  RMT_REPO_ROOT       Existing RMT checkout. Defaults to the git root containing this script.
  RMT_WORKTREE_ROOT   Agent worktrees. Defaults to ~/.rmt-agent/worktrees.
  RMT_RUN_ROOT        Local transcripts/state. Defaults to ~/.rmt-agent/runs.
  CODEX_BIN           Codex executable. Defaults to codex.

Examples:
  ./ops/nemohermes/codex-handoff.sh \
    --task-id issue-401 \
    --base-sha 0123456789abcdef0123456789abcdef01234567 \
    --task-file /tmp/issue-401.md \
    --allow docs/example.md
EOF
}

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="${RMT_REPO_ROOT:-$(git -C "$script_dir" rev-parse --show-toplevel 2>/dev/null || true)}"
worktree_root="${RMT_WORKTREE_ROOT:-$HOME/.rmt-agent/worktrees}"
run_root="${RMT_RUN_ROOT:-$HOME/.rmt-agent/runs}"
codex_bin="${CODEX_BIN:-codex}"

task_id=""
base_sha=""
task_file=""
declare -a allowed_paths=()

while [ "$#" -gt 0 ]; do
  case "$1" in
    --task-id)
      task_id="${2:-}"; shift 2 ;;
    --base-sha)
      base_sha="${2:-}"; shift 2 ;;
    --task-file)
      task_file="${2:-}"; shift 2 ;;
    --allow)
      allowed_paths+=("${2:-}"); shift 2 ;;
    -h|--help)
      usage; exit 0 ;;
    *)
      printf 'Unknown argument: %s\n' "$1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [ -z "$repo_root" ] || [ ! -d "$repo_root/.git" ]; then
  printf 'RMT_REPO_ROOT is not a normal git checkout: %s\n' "${repo_root:-unset}" >&2
  exit 2
fi

if ! [[ "$task_id" =~ ^[A-Za-z0-9._-]+$ ]]; then
  printf 'Unsafe or missing --task-id. Use only letters, digits, dot, underscore, and dash.\n' >&2
  exit 2
fi

if ! [[ "$base_sha" =~ ^[0-9a-fA-F]{40}$ ]]; then
  printf 'Missing or invalid --base-sha; an exact 40-character commit SHA is required.\n' >&2
  exit 2
fi

if [ -z "$task_file" ] || [ ! -f "$task_file" ]; then
  printf 'Missing or unreadable --task-file.\n' >&2
  exit 2
fi

if [ "${#allowed_paths[@]}" -eq 0 ]; then
  printf 'At least one --allow path is required for an R1 Codex handoff.\n' >&2
  exit 2
fi

if ! command -v "$codex_bin" >/dev/null 2>&1; then
  printf 'Codex CLI not found: %s\n' "$codex_bin" >&2
  exit 2
fi

if ! git -C "$repo_root" cat-file -e "${base_sha}^{commit}" 2>/dev/null; then
  printf 'Base SHA is not present in the local repository: %s\n' "$base_sha" >&2
  exit 2
fi

for allowed in "${allowed_paths[@]}"; do
  if [ -z "$allowed" ] || [[ "$allowed" = /* ]] || [[ "$allowed" == *".."* ]]; then
    printf 'Unsafe --allow path: %s\n' "$allowed" >&2
    exit 2
  fi
done

mkdir -p "$worktree_root" "$run_root"
worktree="$worktree_root/$task_id"
run_dir="$run_root/$task_id"
branch="agent/$task_id"

if [ -e "$worktree" ]; then
  printf 'Task worktree already exists; refusing to reuse it: %s\n' "$worktree" >&2
  exit 3
fi

if git -C "$repo_root" show-ref --verify --quiet "refs/heads/$branch"; then
  printf 'Task branch already exists; refusing to reuse it: %s\n' "$branch" >&2
  exit 3
fi

mkdir -p "$run_dir"

# Normalize the task-file path before changing directories.
task_file="$(cd "$(dirname "$task_file")" && pwd)/$(basename "$task_file")"

printf 'Creating isolated worktree\n'
printf '  repo:      %s\n' "$repo_root"
printf '  base:      %s\n' "$base_sha"
printf '  branch:    %s\n' "$branch"
printf '  worktree:  %s\n' "$worktree"

git -C "$repo_root" worktree add -b "$branch" "$worktree" "$base_sha"

prompt_file="$run_dir/codex-prompt.md"
{
  cat <<EOF
You are the implementation worker for bounded RMT development task: $task_id.

You are running in an isolated git worktree anchored to exact base commit:
$base_sha

Before making changes:
1. Read the repository-root AGENTS.md and obey it.
2. Read docs/RMT_AGENT_CONTROL_PLANE.md if present.
3. Read any deeper AGENTS.md files that govern files you may touch.
4. Verify the requested task is compatible with those authorities.

Hard boundaries for this handoff:
- Work only inside the current worktree.
- Modify only the explicitly allowed repository paths listed below.
- Do not commit, push, merge, force-push, deploy, publish, sign, trade, change production configuration, enable providers/fees/automation, or touch wallet/treasury material.
- Do not weaken tests, security checks, release gates, recipient binding, provider verification, or branch protections to make a task pass.
- If the task conflicts with repository authority or requires broader scope, stop and report BLOCKED instead of expanding authority.
- Run the task-required validation that is safe and available locally, and report exact pass/fail results.

Allowed write scope:
EOF
  for allowed in "${allowed_paths[@]}"; do
    printf -- '- %s\n' "$allowed"
  done
  cat <<'EOF'

Task contract follows:

--- BEGIN TASK CONTRACT ---
EOF
  cat "$task_file"
  cat <<'EOF'
--- END TASK CONTRACT ---

When finished, summarize files changed, validations run, failures/limitations, and anything requiring human review. Leave the worktree intact for the host validator.
EOF
} > "$prompt_file"

printf '\nStarting Codex handoff. Transcript: %s\n' "$run_dir/codex.log"
set +e
(
  cd "$worktree"
  "$codex_bin" exec --ephemeral --sandbox workspace-write < "$prompt_file"
) 2>&1 | tee "$run_dir/codex.log"
codex_status=${PIPESTATUS[0]}
set -e

changed_file_list="$run_dir/changed-files.txt"
{
  git -C "$worktree" diff --name-only "$base_sha" --
  git -C "$worktree" ls-files --others --exclude-standard
} | sed '/^$/d' | sort -u > "$changed_file_list"

violations=0
while IFS= read -r file; do
  [ -n "$file" ] || continue
  permitted=0
  for allowed in "${allowed_paths[@]}"; do
    normalized="${allowed#./}"
    normalized="${normalized%/}"
    if [ "$file" = "$normalized" ] || [[ "$file" == "$normalized/"* ]]; then
      permitted=1
      break
    fi
  done
  if [ "$permitted" -ne 1 ]; then
    printf 'SCOPE VIOLATION: %s\n' "$file" >&2
    violations=$((violations + 1))
  fi
done < "$changed_file_list"

printf '\nCodex handoff result\n--------------------\n'
printf 'codex_exit=%s\n' "$codex_status"
printf 'scope_violations=%s\n' "$violations"
printf 'worktree=%s\n' "$worktree"
printf 'branch=%s\n' "$branch"
printf 'changed_files=%s\n' "$changed_file_list"
printf 'transcript=%s\n' "$run_dir/codex.log"

if [ "$violations" -gt 0 ]; then
  printf 'BLOCKED: Codex touched files outside the admitted scope. Nothing was committed or pushed.\n' >&2
  exit 42
fi

if [ "$codex_status" -ne 0 ]; then
  printf 'BLOCKED: Codex exited non-zero. Nothing was committed or pushed.\n' >&2
  exit "$codex_status"
fi

printf 'READY FOR HOST VALIDATION: no out-of-scope paths detected. Nothing was committed or pushed.\n'

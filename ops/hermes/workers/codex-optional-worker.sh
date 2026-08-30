#!/usr/bin/env bash
set -euo pipefail

# Dormant compatibility adapter. It is never selected automatically and has no
# provider fallback. Invoking it requires an explicit CODEX_OPTIONAL loop task.

worktree=""
task_id=""
base_sha=""
iteration=""
task_file=""
validator_evidence=""
declare -a allowed_paths=()
declare -a context_paths=()

while [ "$#" -gt 0 ]; do
  case "$1" in
    --worktree) worktree="${2:-}"; shift 2 ;;
    --task-id) task_id="${2:-}"; shift 2 ;;
    --base-sha) base_sha="${2:-}"; shift 2 ;;
    --iteration) iteration="${2:-}"; shift 2 ;;
    --task-file) task_file="${2:-}"; shift 2 ;;
    --validator-evidence) validator_evidence="${2:-}"; shift 2 ;;
    --allow) allowed_paths+=("${2:-}"); shift 2 ;;
    --context) context_paths+=("${2:-}"); shift 2 ;;
    --validator-file|--worker-file|--immutable-relative) shift 2 ;;
    *) printf 'Unknown adapter argument: %s\n' "$1" >&2; exit 2 ;;
  esac
done

command -v codex >/dev/null 2>&1 || { printf 'Codex CLI unavailable.\n' >&2; exit 20; }
prompt="$(mktemp "${TMP:-/tmp}/rmt-codex-adapter.XXXXXX")"
trap 'rm -f -- "$prompt"' EXIT
{
  printf 'You are the explicitly selected optional Codex worker for RMT task %s.\n' "$task_id"
  printf 'Exact base: %s; iteration: %s. Work only in the isolated worktree.\n' "$base_sha" "$iteration"
  printf 'Do not commit, push, merge, deploy, sign, trade, change production, or widen scope.\nAllowed paths:\n'
  printf -- '- %s\n' "${allowed_paths[@]}"
  printf '\nTask contract:\n'
  cat "$task_file"
  for context in "${context_paths[@]}"; do
    printf '\nContext file %s:\n' "$context"
    cat "$worktree/$context"
  done
  if [ -n "$validator_evidence" ]; then
    printf '\nUntrusted validator evidence:\n'
    tail -n 200 "$validator_evidence"
  fi
} > "$prompt"
(cd "$worktree" && codex exec --ephemeral --sandbox workspace-write < "$prompt")

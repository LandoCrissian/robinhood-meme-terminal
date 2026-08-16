#!/usr/bin/env bash
set -euo pipefail

# Generate a SANITIZED, non-secret migration inventory for moving RMT development
# from one Mac to another. This script installs nothing, changes no git refs,
# performs no network calls, and never reads secret values.
#
# It writes only metadata needed to prove that the source Mac is safe to retire:
# git state, local-only commits/worktrees/stashes, tool versions, and the presence
# (not contents) of likely local configuration files.

usage() {
  cat <<'EOF'
Usage:
  export-source-mac-handoff.sh [--repo <path>] [--output <path>]

Defaults:
  --repo    git root containing this script
  --output  ~/.rmt-agent/handoffs/source-mac-YYYYMMDD-HHMMSS.md

Security:
  - Secret FILE CONTENTS are never read.
  - Environment values are never printed.
  - Remote URL userinfo/query strings are redacted.
  - The report is local by default. Review it before putting any portion on
    GitHub or into a chat.
EOF
}

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(git -C "$script_dir" rev-parse --show-toplevel 2>/dev/null || true)"
output=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    --repo)
      repo_root="${2:-}"; shift 2 ;;
    --output)
      output="${2:-}"; shift 2 ;;
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
  printf 'Not a normal git checkout: %s\n' "${repo_root:-unset}" >&2
  exit 2
fi
repo_root="$(cd "$repo_root" && pwd)"

stamp="$(date '+%Y%m%d-%H%M%S')"
if [ -z "$output" ]; then
  output="$HOME/.rmt-agent/handoffs/source-mac-$stamp.md"
fi
mkdir -p "$(dirname "$output")"

redact_url() {
  # Redact URL userinfo and query/fragment portions. SSH-style GitHub URLs are
  # preserved because they contain no credential material.
  printf '%s' "$1" \
    | sed -E 's#(https?://)[^/@]+@#\1[REDACTED]@#' \
    | sed -E 's#[?#].*$##'
}

cmd_version() {
  label="$1"
  command_name="$2"
  shift 2
  if command -v "$command_name" >/dev/null 2>&1; then
    value="$("$@" 2>/dev/null | head -n 1 || true)"
    printf -- '- %s: `%s`\n' "$label" "${value:-available}"
  else
    printf -- '- %s: `NOT FOUND`\n' "$label"
  fi
}

{
  printf '# RMT Source-Mac Migration Inventory\n\n'
  printf '> Sanitized local audit. Review before sharing. Secret values are intentionally absent.\n\n'
  printf '## Generation\n\n'
  printf -- '- Generated: `%s`\n' "$(date '+%Y-%m-%d %H:%M:%S %z')"
  printf -- '- Repository path: `%s`\n' "$repo_root"
  printf -- '- macOS: `%s`\n' "$(sw_vers -productVersion 2>/dev/null || printf unknown)"
  printf -- '- Architecture: `%s`\n' "$(uname -m 2>/dev/null || printf unknown)"
  printf -- '- Kernel: `%s`\n' "$(uname -r 2>/dev/null || printf unknown)"

  printf '\n## Git identity and remote\n\n'
  branch="$(git -C "$repo_root" symbolic-ref --quiet --short HEAD 2>/dev/null || printf DETACHED)"
  head_sha="$(git -C "$repo_root" rev-parse HEAD)"
  upstream="$(git -C "$repo_root" rev-parse --abbrev-ref --symbolic-full-name '@{upstream}' 2>/dev/null || true)"
  origin_url="$(git -C "$repo_root" remote get-url origin 2>/dev/null || true)"
  printf -- '- Branch: `%s`\n' "$branch"
  printf -- '- HEAD: `%s`\n' "$head_sha"
  printf -- '- Upstream: `%s`\n' "${upstream:-NONE}"
  printf -- '- Origin: `%s`\n' "$(redact_url "${origin_url:-NONE}")"

  printf '\n## Working tree\n\n'
  status="$(git -C "$repo_root" status --porcelain=v1 --untracked-files=all)"
  if [ -z "$status" ]; then
    printf 'CLEAN\n'
  else
    printf 'DIRTY — the new Mac must not be declared ready until every intentional local change is preserved or explicitly discarded by the owner.\n\n```text\n%s\n```\n' "$status"
  fi

  printf '\n## Local branches\n\n```text\n'
  git -C "$repo_root" for-each-ref \
    --format='%(refname:short) | %(objectname) | upstream=%(upstream:short) | %(upstream:track)' \
    refs/heads/ || true
  printf '```\n'

  printf '\n## Commits not reachable from any configured remote ref\n\n'
  local_only="$(git -C "$repo_root" log --branches --not --remotes --date=iso-strict --pretty=format:'%H | %ad | %s' 2>/dev/null || true)"
  if [ -z "$local_only" ]; then
    printf 'NONE DETECTED\n'
  else
    printf 'REVIEW REQUIRED — these commits exist only in local refs according to the current remote-tracking state.\n\n```text\n%s\n```\n' "$local_only"
  fi

  printf '\n## Stashes\n\n'
  stashes="$(git -C "$repo_root" stash list 2>/dev/null || true)"
  if [ -z "$stashes" ]; then
    printf 'NONE\n'
  else
    printf 'REVIEW REQUIRED\n\n```text\n%s\n```\n' "$stashes"
  fi

  printf '\n## Git worktrees\n\n```text\n'
  git -C "$repo_root" worktree list --porcelain || true
  printf '```\n'

  printf '\n## Local configuration-file presence\n\n'
  printf 'Paths only. Contents and values are not read. Transfer any required secret-bearing file out-of-band; never paste its values into GitHub or chat.\n\n```text\n'
  find "$repo_root" -maxdepth 4 -type f \( \
      -name '.env' -o -name '.env.*' -o -name '*.local' -o \
      -name '.npmrc' -o -name '.netrc' -o -name '*.pem' -o \
      -name '*.key' -o -name '*credentials*' -o -name '*secret*' \
    \) -print 2>/dev/null \
    | sed "s#^$repo_root/##" \
    | sort || true
  printf '```\n'

  printf '\n## Toolchain\n\n'
  cmd_version 'git' git git --version
  cmd_version 'Codex CLI' codex codex --version
  cmd_version 'Node.js' node node --version
  cmd_version 'pnpm' pnpm pnpm --version
  cmd_version 'npm' npm npm --version
  cmd_version 'Homebrew' brew brew --version
  cmd_version 'Docker' docker docker --version
  cmd_version 'Colima' colima colima version
  cmd_version 'GitHub CLI' gh gh --version

  printf '\n## Source-Mac retirement gates\n\n'
  printf -- '- [ ] Working tree is clean OR every intentional dirty file is explicitly preserved.\n'
  printf -- '- [ ] No required local-only commit remains unpushed/untransferred.\n'
  printf -- '- [ ] No required stash remains only on this Mac.\n'
  printf -- '- [ ] Every active worktree/branch has been reviewed.\n'
  printf -- '- [ ] Required secret/config files have been identified for OUT-OF-BAND transfer; values were not put in this report.\n'
  printf -- '- [ ] New Mac has a fresh clone from the canonical GitHub remote.\n'
  printf -- '- [ ] New Mac reaches the intended exact branch/commit and passes the baseline checks.\n'
  printf -- '- [ ] Codex is authenticated independently on the new Mac.\n'
  printf -- '- [ ] Owner explicitly accepts the new Mac as the sole RMT development host before the source Mac is retired.\n'
} > "$output"

printf 'Sanitized source-Mac inventory written to:\n%s\n' "$output"
printf 'Review it locally before sharing any portion.\n'

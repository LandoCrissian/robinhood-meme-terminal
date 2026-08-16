#!/usr/bin/env bash
set -euo pipefail

# Generate a SANITIZED, non-secret migration inventory for moving RMT development
# from one Mac to another. This script installs nothing, changes no git refs,
# performs no network calls, and never reads secret values.
#
# It writes only metadata needed to prove that the source Mac is safe to retire
# and to reconstruct its RMT development toolchain cleanly on the destination Mac.

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
  - Tool/package manifests are metadata only and remain local by default.
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

manifest_block() {
  label="$1"
  command_name="$2"
  shift 2
  printf '\n### %s\n\n' "$label"
  if command -v "$command_name" >/dev/null 2>&1; then
    printf '```text\n'
    "$@" 2>/dev/null || true
    printf '```\n'
  else
    printf '`NOT INSTALLED`\n'
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

  printf '\n## RMT development toolchain versions\n\n'
  cmd_version 'git' git git --version
  cmd_version 'Codex CLI' codex codex --version
  cmd_version 'Claude Code' claude claude --version
  cmd_version 'Node.js' node node --version
  cmd_version 'pnpm' pnpm pnpm --version
  cmd_version 'npm' npm npm --version
  cmd_version 'Corepack' corepack corepack --version
  cmd_version 'Homebrew' brew brew --version
  cmd_version 'Docker' docker docker --version
  cmd_version 'Colima' colima colima version
  cmd_version 'GitHub CLI' gh gh --version
  cmd_version 'Python 3' python3 python3 --version
  cmd_version 'pipx' pipx pipx --version
  cmd_version 'uv' uv uv --version
  cmd_version 'Rust' rustc rustc --version
  cmd_version 'Cargo' cargo cargo --version
  cmd_version 'Foundry forge' forge forge --version
  cmd_version 'Foundry cast' cast cast --version
  cmd_version 'Foundry anvil' anvil anvil --version
  cmd_version 'solc' solc solc --version
  cmd_version 'Go' go go version
  cmd_version 'Bun' bun bun --version
  cmd_version 'Deno' deno deno --version
  cmd_version 'Yarn' yarn yarn --version
  cmd_version 'jq' jq jq --version
  cmd_version 'ripgrep' rg rg --version
  cmd_version 'VS Code CLI' code code --version
  cmd_version 'Cursor CLI' cursor cursor --version
  cmd_version 'NemoHermes' nemohermes nemohermes --version
  cmd_version 'OpenShell' openshell openshell --version
  cmd_version 'Hermes' hermes hermes --version

  printf '\n## Clean-reinstall manifests for installed development tools\n\n'
  printf 'These manifests are for reconstruction only. Reinstall packages on the destination Mac; do not copy package-manager directories or binaries wholesale.\n'

  if command -v brew >/dev/null 2>&1; then
    printf '\n### Homebrew prefix / taps / formulae / casks\n\n```text\n'
    printf 'prefix: %s\n' "$(brew --prefix 2>/dev/null || true)"
    printf '\n[taps]\n'
    brew tap 2>/dev/null || true
    printf '\n[formulae]\n'
    brew list --formula --versions 2>/dev/null || true
    printf '\n[casks]\n'
    brew list --cask --versions 2>/dev/null || true
    printf '```\n'
  else
    printf '\n### Homebrew\n\n`NOT INSTALLED`\n'
  fi

  manifest_block 'npm global packages' npm npm -g ls --depth=0
  manifest_block 'pnpm global packages' pnpm pnpm -g ls --depth=0
  manifest_block 'pipx applications' pipx pipx list --short

  printf '\n### Python user/base packages\n\n'
  if command -v python3 >/dev/null 2>&1; then
    printf '```text\n'
    python3 -m pip list --format=freeze 2>/dev/null || true
    printf '```\n'
  else
    printf '`NOT INSTALLED`\n'
  fi

  manifest_block 'Rustup toolchains' rustup rustup toolchain list
  manifest_block 'Cargo-installed binaries' cargo cargo install --list
  manifest_block 'VS Code extensions' code code --list-extensions --show-versions
  manifest_block 'Cursor extensions' cursor cursor --list-extensions --show-versions

  printf '\n### Docker/Colima runtime metadata\n\n'
  printf 'Do not copy Docker VM/image storage to the destination Mac. Rebuild or re-pull from declared sources.\n\n```text\n'
  if command -v docker >/dev/null 2>&1; then
    docker context ls 2>/dev/null || true
  else
    printf 'docker: NOT INSTALLED\n'
  fi
  if command -v colima >/dev/null 2>&1; then
    colima list 2>/dev/null || true
  else
    printf 'colima: NOT INSTALLED\n'
  fi
  printf '```\n'

  printf '\n## Shell/tool-manager presence (paths only; no file contents)\n\n```text\n'
  for path in \
    "$HOME/.zshrc" "$HOME/.zprofile" "$HOME/.bashrc" "$HOME/.bash_profile" \
    "$HOME/.gitconfig" "$HOME/.npmrc" "$HOME/.config/pnpm" "$HOME/.nvm" \
    "$HOME/.fnm" "$HOME/.volta" "$HOME/.asdf" "$HOME/.cargo" "$HOME/.rustup" \
    "$HOME/.foundry" "$HOME/.docker" "$HOME/.colima" "$HOME/.config/gh" \
    "$HOME/.codex"; do
    if [ -e "$path" ]; then
      printf 'PRESENT %s\n' "$path"
    fi
  done
  printf '```\n'
  printf 'Presence does not mean copy wholesale. The destination session must classify each item as REINSTALL, RECREATE, TRANSFER OUT-OF-BAND, or NOT REQUIRED. Secret-bearing content must never enter the handoff.\n'

  printf '\n## Source-Mac retirement gates\n\n'
  printf -- '- [ ] Working tree is clean OR every intentional dirty file is explicitly preserved.\n'
  printf -- '- [ ] No required local-only commit remains unpushed/untransferred.\n'
  printf -- '- [ ] No required stash remains only on this Mac.\n'
  printf -- '- [ ] Every active worktree/branch has been reviewed.\n'
  printf -- '- [ ] RMT development toolchain/package-manager manifests were captured and reviewed.\n'
  printf -- '- [ ] Each required tool is classified for clean reinstall/recreation on the destination Mac.\n'
  printf -- '- [ ] Required secret/config files have been identified for OUT-OF-BAND transfer; values were not put in this report.\n'
  printf -- '- [ ] New Mac has a fresh clone from the canonical GitHub remote.\n'
  printf -- '- [ ] New Mac reaches the intended exact branch/commit and passes the baseline checks.\n'
  printf -- '- [ ] Codex is authenticated independently on the new Mac.\n'
  printf -- '- [ ] Owner explicitly accepts the new Mac as the sole RMT development host before the source Mac is retired.\n'
} > "$output"

printf 'Sanitized source-Mac inventory written to:\n%s\n' "$output"
printf 'Review it locally before sharing any portion.\n'

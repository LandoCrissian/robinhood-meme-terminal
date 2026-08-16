#!/usr/bin/env bash
set -u

# Read-only destination-Mac verifier for a fresh RMT clone.
# Installs nothing, performs no network calls, changes no refs/files, and reads no
# secret values. Use after cloning and fetching the expected handoff commit.

usage() {
  cat <<'EOF'
Usage:
  verify-destination-mac.sh --expected-sha <40-char-sha> [--repo <path>] [--expected-branch <branch>]

The repository must already be cloned/fetched. This verifier is intentionally
read-only and does not install dependencies or authenticate tools.
EOF
}

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(git -C "$script_dir" rev-parse --show-toplevel 2>/dev/null || true)"
expected_sha=""
expected_branch=""
failures=0
warnings=0

ok() { printf 'OK    %s\n' "$*"; }
warn() { printf 'WARN  %s\n' "$*"; warnings=$((warnings + 1)); }
fail() { printf 'FAIL  %s\n' "$*"; failures=$((failures + 1)); }
info() { printf 'INFO  %s\n' "$*"; }

while [ "$#" -gt 0 ]; do
  case "$1" in
    --repo)
      repo_root="${2:-}"; shift 2 ;;
    --expected-sha)
      expected_sha="${2:-}"; shift 2 ;;
    --expected-branch)
      expected_branch="${2:-}"; shift 2 ;;
    -h|--help)
      usage; exit 0 ;;
    *)
      printf 'Unknown argument: %s\n' "$1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [ "$(uname -s 2>/dev/null)" != "Darwin" ]; then
  fail 'Destination verifier expects macOS.'
fi

if ! [[ "$expected_sha" =~ ^[0-9a-fA-F]{40}$ ]]; then
  printf 'A valid --expected-sha is required.\n' >&2
  exit 2
fi

if [ -z "$repo_root" ] || [ ! -d "$repo_root/.git" ]; then
  printf 'Not a normal git checkout: %s\n' "${repo_root:-unset}" >&2
  exit 2
fi
repo_root="$(cd "$repo_root" && pwd)"

printf 'RMT destination-Mac baseline verifier\n'
printf '=====================================\n'

info "repo=$repo_root"
info "macOS=$(sw_vers -productVersion 2>/dev/null || printf unknown)"
info "arch=$(uname -m 2>/dev/null || printf unknown)"

mem_bytes="$(sysctl -n hw.memsize 2>/dev/null || true)"
if [[ "$mem_bytes" =~ ^[0-9]+$ ]]; then
  mem_gib=$((mem_bytes / 1024 / 1024 / 1024))
  info "physical_memory=${mem_gib}GiB"
else
  warn 'Could not determine physical memory.'
fi

avail_kb="$(df -Pk "$repo_root" 2>/dev/null | awk 'NR==2 {print $4}' || true)"
if [[ "$avail_kb" =~ ^[0-9]+$ ]]; then
  avail_gib=$((avail_kb / 1024 / 1024))
  info "repo_volume_free=${avail_gib}GiB"
else
  warn 'Could not determine free disk space.'
fi

if command -v git >/dev/null 2>&1; then
  ok "$(git --version 2>/dev/null)"
else
  fail 'git not found.'
fi

origin="$(git -C "$repo_root" remote get-url origin 2>/dev/null || true)"
case "$origin" in
  *LandoCrissian/robinhood-meme-terminal* )
    ok 'origin points at LandoCrissian/robinhood-meme-terminal.' ;;
  * )
    fail "unexpected origin: ${origin:-NONE}" ;;
esac

head_sha="$(git -C "$repo_root" rev-parse HEAD 2>/dev/null || true)"
branch="$(git -C "$repo_root" symbolic-ref --quiet --short HEAD 2>/dev/null || printf DETACHED)"
info "branch=$branch"
info "HEAD=$head_sha"

if git -C "$repo_root" cat-file -e "${expected_sha}^{commit}" 2>/dev/null; then
  ok 'expected handoff commit exists locally.'
else
  fail "expected handoff commit is not present locally: $expected_sha"
fi

if [ "$head_sha" = "$expected_sha" ]; then
  ok 'HEAD matches the exact handoff SHA.'
else
  fail "HEAD does not match handoff SHA (expected $expected_sha)."
fi

if [ -n "$expected_branch" ]; then
  if [ "$branch" = "$expected_branch" ]; then
    ok "branch matches expected branch: $expected_branch"
  else
    fail "branch mismatch: expected $expected_branch, got $branch"
  fi
fi

status="$(git -C "$repo_root" status --porcelain=v1 --untracked-files=all 2>/dev/null || true)"
if [ -z "$status" ]; then
  ok 'working tree is clean.'
else
  fail 'working tree is dirty before destination acceptance.'
  printf '%s\n' "$status"
fi

if xcode-select -p >/dev/null 2>&1; then
  ok "Xcode Command Line Tools: $(xcode-select -p)"
else
  fail 'Xcode Command Line Tools missing.'
fi

if command -v codex >/dev/null 2>&1; then
  ok "Codex CLI: $(codex --version 2>/dev/null || printf available)"
else
  fail 'Codex CLI missing.'
fi

if command -v node >/dev/null 2>&1; then
  ok "Node.js: $(node --version 2>/dev/null || printf available)"
else
  fail 'Node.js missing.'
fi

if command -v pnpm >/dev/null 2>&1; then
  ok "pnpm: $(pnpm --version 2>/dev/null || printf available)"
else
  fail 'pnpm missing.'
fi

if [ -f "$repo_root/pnpm-lock.yaml" ]; then
  ok 'pnpm lockfile present.'
else
  warn 'pnpm-lock.yaml not found at repository root; verify package-manager expectations from repository authority.'
fi

printf '\nSummary\n-------\n'
printf 'failures=%s warnings=%s\n' "$failures" "$warnings"

if [ "$failures" -gt 0 ]; then
  printf 'DESTINATION BASELINE NOT READY. No changes were made.\n'
  exit 1
fi

printf 'DESTINATION BASELINE STRUCTURALLY READY. This does not replace dependency install, Codex authentication, or branch-specific validation. No changes were made.\n'
exit 0

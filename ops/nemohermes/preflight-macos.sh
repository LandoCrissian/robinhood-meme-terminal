#!/usr/bin/env bash
set -u

# Non-mutating preflight for the RMT NemoHermes/Codex development host.
# This script intentionally installs nothing and changes no services.

failures=0
warnings=0

ok() { printf 'OK    %s\n' "$*"; }
warn() { printf 'WARN  %s\n' "$*"; warnings=$((warnings + 1)); }
fail() { printf 'FAIL  %s\n' "$*"; failures=$((failures + 1)); }
info() { printf 'INFO  %s\n' "$*"; }

printf 'RMT macOS agent-host preflight\n'
printf '================================\n'

if [ "$(uname -s 2>/dev/null)" != "Darwin" ]; then
  fail "This preflight is for macOS hosts only."
  exit 2
fi

arch="$(uname -m 2>/dev/null || true)"
macos_version="$(sw_vers -productVersion 2>/dev/null || true)"
info "macOS ${macos_version:-unknown} / ${arch:-unknown}"

case "$arch" in
  arm64)
    ok "Apple Silicon detected. This is the supported macOS architecture for the NemoClaw host path (currently tested with limitations by NVIDIA)."
    ;;
  x86_64)
    fail "Intel Mac detected. NVIDIA currently marks NemoClaw on Intel macOS unsupported. Keep Codex on this Mac if desired, but place NemoClaw/Hermes on an Apple Silicon Mac or supported Linux host."
    ;;
  *)
    fail "Unknown macOS architecture: ${arch:-unset}"
    ;;
esac

if xcode-select -p >/dev/null 2>&1; then
  ok "Xcode Command Line Tools available: $(xcode-select -p)"
else
  fail "Xcode Command Line Tools are missing."
fi

if command -v git >/dev/null 2>&1; then
  ok "git: $(git --version 2>/dev/null)"
else
  fail "git is not available."
fi

if command -v brew >/dev/null 2>&1; then
  ok "Homebrew: $(brew --version 2>/dev/null | head -n 1)"
else
  warn "Homebrew is not installed. NemoClaw can use a standalone OpenShell path, but the reviewed RMT macOS path prefers Homebrew."
fi

if command -v docker >/dev/null 2>&1; then
  if docker info >/dev/null 2>&1; then
    ok "Docker CLI can reach a running container runtime."
  else
    fail "docker exists but cannot reach a running container runtime. Start Colima or Docker Desktop before NemoClaw onboarding."
  fi
else
  fail "docker CLI is missing. NVIDIA's macOS path requires Docker Desktop or Colima; Homebrew Colima users also need the docker CLI."
fi

if command -v colima >/dev/null 2>&1; then
  if colima status >/dev/null 2>&1; then
    ok "Colima is installed and reports a running instance."
  else
    warn "Colima is installed but is not currently running."
  fi
else
  info "Colima not found. Docker Desktop is also an NVIDIA-supported macOS container-runtime option."
fi

if command -v codex >/dev/null 2>&1; then
  version="$(codex --version 2>/dev/null || true)"
  ok "Codex CLI available${version:+: $version}"
else
  fail "Codex CLI is missing. The RMT host handoff expects the official Codex CLI."
fi

if command -v nemohermes >/dev/null 2>&1; then
  ok "nemohermes command is available."
else
  warn "nemohermes is not installed yet. This is expected before the separately approved NVIDIA NemoClaw/Hermes bootstrap."
fi

if command -v openshell >/dev/null 2>&1; then
  ok "OpenShell CLI is available."
else
  info "OpenShell CLI not found yet; NemoClaw onboarding owns this runtime boundary."
fi

printf '\nSummary\n-------\n'
printf 'failures=%s warnings=%s\n' "$failures" "$warnings"

if [ "$failures" -gt 0 ]; then
  printf 'Preflight is NOT ready for NemoClaw onboarding. No changes were made.\n'
  exit 1
fi

printf 'Preflight is ready for the separately approved NemoClaw/Hermes onboarding step. No changes were made.\n'
exit 0

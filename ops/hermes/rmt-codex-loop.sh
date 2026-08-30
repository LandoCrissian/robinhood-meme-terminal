#!/usr/bin/env bash
set -euo pipefail

# Compatibility entry point for the explicitly selected optional Codex worker.
# All repository, SHA, ref, scope, budget, and validator policy lives in the
# model-neutral rmt-agent-loop.sh.

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "$script_dir/rmt-agent-loop.sh" \
  --worker-adapter "$script_dir/workers/codex-optional-worker.sh" \
  --worker-kind CODEX_OPTIONAL \
  "$@"

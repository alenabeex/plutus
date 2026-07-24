#!/bin/bash
# Agent/harness entry point — demo mode by default (AGENTS.md rule 2), so
# browser verification never pulls the real DB into a model context.
# Alena's own real-mode run is `pnpm dev` directly, or FT_DEMO=0 here.
cd "$(dirname "$0")"
FT_DEMO=${FT_DEMO:-1} PORT=${PORT:-3000} pnpm dev

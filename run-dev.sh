#!/bin/bash
cd "$(dirname "$0")"
PORT=${PORT:-3000} pnpm dev

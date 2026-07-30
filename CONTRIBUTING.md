# Contributing

Thanks for helping improve Plutus. Please keep contributions small, focused, and easy to review.

## Guidelines

- Prefer targeted edits over broad refactors.
- Keep each PR focused on one bug, feature, or cleanup.
- Update docs or env examples when changing setup, config, or user-facing behavior.
- Plutus is local-first by design. Please do not propose cloud or hosted refactors — multi-tenant servers, hosted databases, and one-click cloud deploys are deliberately out of scope for now.
- Follow the design-system contract: spacing on the 4px ladder (4/8/12/16/20/24/40), the existing `--fs-*` type tokens, one hero number per view, semantic green/red reserved for money direction only. The Net Worth view is the reference implementation — match it.
- Reuse existing primitives (card shell, formatters) before adding new ones. One currency formatter, tabular numbers, true minus sign.
- Do not commit secrets, API keys, real financial data, or local `.env` files. Fixtures, seeds, and screenshots use demo data only.

## Before Opening a PR

- Run the relevant build or test command for the area you changed.
- Check `git diff` and remove unrelated changes.
- Write a concise Markdown PR description with:
    - summary
    - changes
    - why
    - testing

## Security

Do not open a public issue for security vulnerabilities. Use [GitHub's private vulnerability reporting](https://github.com/alenabeex/plutus/security/advisories/new) instead.

We will aim to respond promptly and coordinate a disclosure timeline with you.

## Local Development

```bash
pnpm install
FT_DEMO=1 pnpm dev   # develop against fake seeded data — never real financial data
```

## Testing

```bash
pnpm test        # vitest
pnpm typecheck
pnpm lint
```

- New features and bug fixes should come with a test at the lowest layer that can catch the regression: unit first, then route-level, and browser verification only for flows a browser is genuinely needed to prove.
- Tests must not require a live Plaid connection or an LLM API key — a plain `pnpm test` should always be green.
- Secret scanning (gitleaks) runs on every push and PR; mirroring it in a local pre-commit hook is recommended.

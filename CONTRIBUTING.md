# Contributing to Nexus

Thanks for your interest in improving Nexus! This project welcomes contributions
of all kinds: bug reports, documentation, tests, and code.

## Getting started

```bash
git clone https://github.com/rachidSabah/codingghosts.git
cd codingghosts
pnpm install
pnpm build
```

Run the gateway + dashboard:

```bash
# terminal 1 — gateway (port 8787)
node apps/gateway/dist/bin.js
# terminal 2 — dashboard (port 3000)
pnpm --filter @anx/dashboard dev
```

## Development workflow

1. Create a feature branch: `git checkout -b feat/my-change`.
2. Make your change with tests where practical.
3. Run the gates locally before opening a PR:

   ```bash
   pnpm typecheck
   pnpm test
   pnpm build
   pnpm lint
   ```

4. Commit with a clear message and open a PR against `main`.

## Code style

- TypeScript, formatted with Prettier (`pnpm format`).
- No `any` where avoidable; prefer the shared types in `packages/shared`.
- Match existing patterns — do not rewrite working subsystems.
- Do not introduce mock data or hardcoded provider/model catalogs.

## Security

- **Never commit secrets.** `.env`, `vault.json`, and API keys are git-ignored.
- CI runs **gitleaks**; a detected secret blocks the merge.
- Report vulnerabilities privately — see [SECURITY.md](SECURITY.md).

## Tests

- Unit tests live next to code (`*.test.ts`).
- Run the full suite with `pnpm test`.
- Integration-style gateway tests require no external keys (they use the in-memory
  provider/registry); do not depend on a developer machine's local vault.

## Code of Conduct

By participating you agree to abide by our
[Code of Conduct](CODE_OF_CONDUCT.md).

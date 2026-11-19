# Contributing to Lexarr

Thanks for helping. Lexarr is a small project, so a short conversation
first saves everyone time: for anything bigger than a bug fix, open an
issue describing what you want to change before writing the code.

## Getting set up

```bash
git clone https://github.com/eqtitan/Lexarr.git
cd Lexarr
npm install
cp .env.example .env          # fill in at least NEXTAUTH_SECRET and TMDB_API_KEY
npx prisma migrate deploy
npm run dev                   # http://localhost:3000
```

You don't need a real \*arr stack for most work: the tests and the
end-to-end suite run against stubs (see "Tests" in the README).

## Before you open a pull request

```bash
npx tsc --noEmit              # 0 type errors
npm run lint                  # 0 errors, 0 warnings
npm test                      # vitest
npm run build && npm run e2e  # Playwright smoke (npx playwright install chromium once)
```

CI runs the same checks, and a pull request needs them green to merge.
The pre-commit hook runs lint and the related tests on staged files.

## How the code is laid out

- API routes in `src/app/api/` stay thin; the logic lives in
  `src/lib/services/`.
- Read configuration through `env()` from `src/lib/env.ts`, never
  `process.env` (lint enforces it). New variables go in the schema there
  and are documented in `.env.example`.
- Tests that touch the database use a real SQLite file
  (`src/__tests__/helpers/test-db.ts`), not a mocked Prisma client.
- Errors are `unknown` with `instanceof Error` checks; no `any`.

`CLAUDE.md` has a longer architecture tour.

## Commits, changelog and releases

Commit messages follow [Conventional Commits](https://conventionalcommits.org)
(`feat:`, `fix:`, `docs:` ...). A user-visible change adds a line under
`## [Unreleased]` in `CHANGELOG.md`, written for the person running Lexarr:
what they see, not which function changed. [`.changelog-rules.md`](.changelog-rules.md)
has the details and how a release is cut.

## Database changes

Schema changes need a Prisma migration (`npx prisma migrate dev --name <what>`).
Migrations run automatically on container start, and CI checks that an
empty 0.1.0 database still upgrades cleanly, so never edit a migration that
has been released.

## Security issues

Please don't open a public issue. See [`SECURITY.md`](SECURITY.md).

## License

By contributing you agree that your contribution is licensed under the
project's [MIT License](LICENSE).

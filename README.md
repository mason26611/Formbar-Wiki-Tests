# Formbar Wiki Example Tests

This repo verifies the examples in the Formbar.js wiki against a clean, temporary Formbar install.

The runner assumes the database starts fresh. It copies the backend and frontend repositories into `.tmp/run-*`, excludes existing databases, keys, logs, `node_modules`, and nested git state, then runs `npm run init-db` and `npm run migrate` before starting the backend.

## Environment Setup

The runner now reads repository paths from a `.env` file (required, no hardcoded path assumptions):

```powershell
Copy-Item .env.example .env
# then edit .env with your local backend and frontend paths
```

Required values:

- `FORMBAR_BACKEND_REPO`: absolute path to your Formbar backend repository.
- `FORMBAR_CLIENT_REPO`: absolute path to your Formbar frontend repository.

## First Run

```powershell
npm install
npx playwright install chromium
npm test
```

The Playwright browser install is only needed for the current frontend OAuth redirect example. If Chromium is not installed, that browser-only suite reports a skip while the backend/socket examples still run.

## Useful Environment Variables

- `FORMBAR_BACKEND_REPO`: backend repo path. Required.
- `FORMBAR_CLIENT_REPO`: frontend repo path. Required.
- `WORK_DIR`: temporary workspace root. Defaults to `.tmp`.
- `SKIP_INSTALL=true`: do not run `npm install` in copied repos.
- `KEEP_WORKDIR=true`: keep the temporary copied repos after the run.
- `HEADLESS=false`: show the browser for the frontend OAuth example.
- `NO_COLOR=1`: disable ANSI color output in the runner logs.

## What Is Covered

- HTTP examples: registration, login, `/user/me`, class creation/enrollment/session start, poll creation/response, timer start, app registration, future OAuth authorize/token/refresh/revoke, certs, and API-key auth.
- Socket examples: token-authenticated sockets, class join/start/status/settings, poll creation/response/update, help/break events, digipog award/transfer, owned-class updates, and legacy auth deprecation.
- Digipogs examples: PIN setup, award, transfer, pool creation, pool membership, payout, transactions, and socket digipog events.
- Current OAuth example: redirect to the separate `Formbar.ts-client` frontend `/oauth`, log in there, and return to a minimal third-party callback with `?token=...`.

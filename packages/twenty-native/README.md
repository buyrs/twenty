# twenty-native

Runs Twenty as a one-click macOS app: an Electron supervisor starts an embedded
PostgreSQL and Redis, initializes the database on first run, then serves the
compiled twenty-server (with the frontend baked into `dist/front`). Data lives
in `~/Library/Application Support/Twenty`; logs in the `logs` subfolder.

## Commands (from the repo root)

```bash
yarn native:build     # compile supervisor, fetch PG/Redis binaries, build front+server, assemble resources/
yarn native:run       # launch the app from the assembled bundle (dev)
yarn native:package   # electron-builder → dist-native/Twenty-<version>-<arch>.dmg
```

First build downloads PostgreSQL 16 and Redis 7 sources (Redis is compiled
locally — Xcode Command Line Tools must be installed: `xcode-select --install`).

## Runtime layout

- `resources/postgres` — relocatable PostgreSQL build (theseus-rs), needs
  `bin/{postgres,initdb,pg_ctl,psql}` and the `uuid-ossp`/`unaccent` contrib
  extensions that `setup-db.js` creates.
- `resources/redis` — `redis-server` built from source.
- `resources/node` — the official Node 24 binary. The server and worker run
  on it rather than Electron's embedded node: native addons (Sentry profiler,
  bcrypt…) ship Node-ABI prebuilds, and Electron reports its own incompatible
  module ABI.
- `resources/app-runtime` — the docker-image runtime layout: production
  `node_modules`, `packages/twenty-server/dist` (with `dist/front`), and the
  `twenty-{shared,emails,client-sdk}` packages.

## Notes

- The server and worker run on the bundled Node binary (`resources/node`),
  so no Node install is needed on the machine.
- The production `node_modules` install happens inside the staged bundle
  (`resources/app-runtime` becomes a temporary minimal yarn project); the
  repository's own `node_modules` is never pruned.
- Builds are unsigned; distributing the dmg beyond your own Mac needs signing
  and notarization (out of scope for v1).

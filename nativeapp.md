# nativeapp.md — Package Twenty as a one-click macOS app

**Goal:** Double-click a `.app` icon in macOS → Electron window opens → embedded Postgres, Redis, and the Twenty server all start automatically, data lives in `~/Library/Application Support/Twenty`. No terminal, no brew, no Docker.

**Context (verified in this repo):**
- Server serves the built frontend itself in production — `AppModule.getConditionalModules()` mounts `ServeStaticModule` on `dist/front` when it exists (`packages/twenty-server/src/app.module.ts:92-100`). The Docker image does exactly this: `COPY front/build → server/dist/front` (`packages/twenty-docker/twenty/Dockerfile:183`).
- Prod runtime entries exist already: `node dist/main` (server), `node dist/queue-worker/queue-worker` (worker), `node dist/database/scripts/setup-db.js` + `dist/command/command run-instance-commands --force --include-slow` (DB init, per `database:init:prod`) — `packages/twenty-server/package.json:10-14`.
- Config comes from env: `PORT`, `PG_DATABASE_URL`, `REDIS_URL`, `APP_SECRET`, `SIGN_IN_PREFILLED`, `FRONTEND_URL` (`packages/twenty-server/.env.example`, definitions in `src/engine/core-modules/twenty-config/config-variables.ts`). The server/worker run on a Node 24 binary bundled in the app (Electron's embedded node reports its own module ABI, under which the server's native addons — e.g. the Sentry profiler — do not load).
- License note: repo is *mostly* AGPL-3.0 — enterprise-marked files (`/* @license Enterprise */`) fall under a commercial license, `twenty-sdk`/`twenty-ui`/`twenty-apps` etc. are MIT, and the root `LICENSE` grants a section-7 "Twenty Application Exception" that may change the distribution analysis. Keep the app open-source or get a real licensing review before shipping commercially.

---

## Approach

**Electron (main process, plain TS/CommonJS) + embedded PostgreSQL 16 and Redis 7/8 static binaries**, with the compiled `twenty-server` and `twenty-front` copied into the app bundle. The Electron main process is a process supervisor: it generates runtime env, starts Postgres → creates the `default` database → Redis → `setup-db` + instance commands (first run only) → server → worker, polls `localhost:PORT/healthz`, then opens the window pointed at `http://localhost:PORT`.

## Phases

### Phase 1 — Workspace scaffold
- New package `packages/twenty-native/` (private, `electron`, `electron-builder` devDeps; build = `tsc` on `src/main.ts`).
- Resources layout: `resources/postgres/` (Postgres 16 static binary + `initdb`/`pg_ctl`/`psql` — `psql` is needed for the `CREATE DATABASE` step), `resources/redis/` (redis-server), `resources/node/` (official Node 24 binary — see runtime note below), `resources/server/` staged as `resources/app-runtime/` (docker-image layout: `packages/twenty-server/dist` + prod node_modules via an in-bundle `yarn workspaces focus --production`), `resources/front/` (`twenty-front/build` copied into `dist/front`).
- Add scripts to root `package.json`: `native:build`, `native:package`, `native:run`.

### Phase 2 — Electron supervisor (main process)
- `src/main.ts` — one-window app (`BrowserWindow`, no menu, `setWindowOpenHandler` → external browser).
- `src/runtime.ts` — resolves the bundle root via `app.getAppPath()`, creates `~/Library/Application Support/Twenty` at first run (Postgres data dir, Redis data dir, logs), picks a free port (default 3000, fallback scan).
- `src/services/postgres.ts` — `initdb` into the data dir if empty, then `pg_ctl -o "-p 5433 -c listen_addresses=127.0.0.1" start`; waits for readiness, then `CREATE DATABASE default` if missing. A bare `initdb` only creates the `postgres` DB — docker-compose gets `default` from `POSTGRES_DB` (`docker-compose.yml:116`), and `setup-db.js` assumes it already exists, so the supervisor must create it itself. (Pick a high port like 5433 to avoid collisions with a local Postgres.)
- `src/services/redis.ts` — `redis-server --port 6379 --dir <data> --save "" --appendonly no`; waits for `PING`.
- `src/services/twenty.ts` — first run: `node dist/database/scripts/setup-db.js` then `node dist/command/command run-instance-commands --force --include-slow` (exact `database:init:prod` sequence; without `--include-slow`, DDL/backfill instance commands are skipped — `run-instance-commands.command.ts:87`), then spawns server (`dist/main`) and worker (`dist/queue-worker/queue-worker`) with a generated env:
  ```
  NODE_ENV=production  PORT=<free>  PG_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5433/default
  REDIS_URL=redis://127.0.0.1:6379  APP_SECRET=<random-per-install>  SIGN_IN_PREFILLED=true
  FRONTEND_URL=http://localhost:<PORT>  SERVER_URL=http://localhost:<PORT>
  EVENT_SINKS=[]  IS_MULTIWORKSPACE_ENABLED=false
  ```
  Redis is mandatory, not a nice-to-have: the message queue driver is hardcoded to BullMQ (`message-queue.module-factory.ts` — there is no `MESSAGE_QUEUE_TYPE=sync` escape hatch), so server and worker both need a live Redis. `EVENT_SINKS=[]` disables the default ClickHouse event sink, since nothing ClickHouse-ish is embedded.
- **Node runtime:** server/worker run on a bundled official Node 24 binary (`resources/node/node`), not Electron's embedded node — Electron reports its own module ABI (148 for Electron 43) under which the server's native addons (Sentry cpu-profiler, …) fail to load; the Node-24 ABI (137) matches their shipped prebuilds, same as the docker image.
- `src/health.ts` — poll `http://localhost:<PORT>/healthz` (HTTP 200; route exists — `ApiPath.Health` → `health.controller.ts`, same check docker-compose uses) before showing the window.
- Shutdown: `app.on('before-quit')` → stop worker → server → redis → postgres (`pg_ctl stop`), all child processes killed.

### Phase 3 — Packaging (electron-builder)
- `electron-builder.yml`: target `dmg` + `zip` (arm64 + x64), `extraResources` for `resources/**`, bundle id `com.twenty.native`, `category: public.app-category.business`, code-sign disabled for local builds.
- Scripts:
  - `yarn native:build` — build front (`nx build twenty-front`), server (`nx build twenty-server`), TS compile main, assemble `resources/`.
  - `yarn native:package` — `electron-builder --mac`.
  - `yarn native:run` — `electron .` from the assembled bundle for dev.
- Output: `dist-native/Twenty-<version>-arm64.dmg` (installable, drag to Applications) — the double-clickable deliverable.

### Phase 4 — Verification
- `yarn native:run` on this Mac: window opens with the login screen, DB is created in the app-support dir on first run, login as `tim@apple.dev` works.
- `yarn native:package`, install the dmg, double-click the icon from `/Applications`, verify: no terminal involved, app starts and shuts down cleanly, data persists across launches (re-launch → no re-init, existing records still present).
- Kill-check: quit the app → `ps aux | grep twenty-native/resources` shows no leftover postgres/redis/node processes (ports may be scanned fallback ports, so match processes, not port numbers).

## Key files to create
- `packages/twenty-native/package.json`
- `packages/twenty-native/src/main.ts`
- `packages/twenty-native/src/runtime.ts`
- `packages/twenty-native/src/services/{postgres,redis,twenty}.ts`
- `packages/twenty-native/src/health.ts`
- `packages/twenty-native/electron-builder.yml`
- `packages/twenty-native/resources/icons/` (icon set)
- Root `package.json` scripts (native:*)

## Risks / open points
- **Static binaries:** Postgres on macOS via `initdb`/`pg_ctl` works in dev; arm64 vs x64 builds must match the downloaded binaries (two builds). The bundled Postgres must ship the contrib modules — `setup-db.js` requires `uuid-ossp` and `unaccent`, which minimal static builds sometimes omit (FDW extensions like `wrappers` are only needed when `IS_FDW_ENABLED=true`, off by default). Fallback if a static PG proves fragile: use `@embedded-postgres` npm package, or drop to embedded-sqlite as a stretch goal (out of scope for v1).
- **Redis version:** the repo doesn't pin one (docker-compose uses the unpinned `redis` image); bundle a pinned 7.x and only reconsider if BullMQ queue errors appear.
- **Ports:** hardcoded fallback ports (5433/6379) may collide; the supervisor scans and surfaces a clear error dialog if busy.
- **Licensing:** AGPL + enterprise-marked files + section-7 exception (root `LICENSE`) — verify distribution intent before shipping beyond personal use.

## Out of scope (v1)
- Auto-update, native Touch ID, menu bar extras, multiple workspaces, Windows/Linux builds, code signing/notarization (add `--mac` signing later if you want to distribute outside your Mac).

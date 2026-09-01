import { existsSync } from 'node:fs';
import path from 'node:path';
import type { ChildProcess } from 'node:child_process';

import { runProcessToCompletion, spawnLongRunningProcess } from '../logging';
import type { RuntimeConfiguration } from '../runtime';

const DATABASE_COMMAND_TIMEOUT_MS = 10 * 60_000;
const MAX_PROCESS_RESTARTS = 3;
const PROCESS_RESTART_DELAY_MS = 2_000;
const PROCESS_STOP_TIMEOUT_MS = 15_000;

export type TwentyServiceOptions = {
  configuration: RuntimeConfiguration;
  appVersion: string;
};

export type TwentyInitializationMode = 'first-run' | 'upgrade';

export type TwentyService = {
  initialize: (mode: TwentyInitializationMode) => Promise<void>;
  start: () => void;
  stop: () => Promise<void>;
};

export const buildServerEnvironment = (
  options: TwentyServiceOptions,
): NodeJS.ProcessEnv => {
  const { configuration } = options;

  return {
    ...process.env,
    NODE_ENV: 'production',
    // The server listens on NODE_PORT (main.ts reads the config variable),
    // not PORT; setting PORT would silently fall back to the 3000 default.
    NODE_PORT: String(configuration.serverPort),
    PG_DATABASE_URL: `postgres://postgres:postgres@127.0.0.1:${configuration.postgresPort}/default`,
    REDIS_URL: `redis://127.0.0.1:${configuration.redisPort}`,
    APP_SECRET: configuration.appSecret,
    APP_VERSION: options.appVersion,
    // Prefill hardcodes the seeded tim@apple.dev credentials in the front; the
    // native app swaps that seed for the local admin (see swap below).
    SIGN_IN_PREFILLED: 'false',
    FRONTEND_URL: configuration.serverUrl,
    SERVER_URL: configuration.serverUrl,
    // The ClickHouse event sink has no embedded server to talk to.
    EVENT_SINKS: '[]',
    IS_MULTIWORKSPACE_ENABLED: 'false',
    STORAGE_TYPE: 'local',
    STORAGE_LOCAL_PATH: configuration.paths.storagePath,
  };
};

const runServerCommand = async (
  options: TwentyServiceOptions,
  args: string[],
): Promise<void> => {
  await runProcessToCompletion({
    name: 'init',
    command: options.configuration.paths.nodeBinPath,
    args,
    cwd: options.configuration.paths.serverPackagePath,
    env: buildServerEnvironment(options),
    logsPath: options.configuration.paths.logsPath,
    timeoutMs: DATABASE_COMMAND_TIMEOUT_MS,
  });
};

const runBestEffortServerCommand = async (
  options: TwentyServiceOptions,
  args: string[],
): Promise<void> => {
  try {
    await runServerCommand(options, args);
  } catch (error) {
    console.warn(
      `[twenty-native] best-effort command failed: ${args.join(' ')}`,
      error,
    );
  }
};

// The dev seeder provisions tim@apple.dev as workspace admin; the native app is
// meant to be entered with the local admin credentials instead. Guarded on the
// seeded email so the swap no-ops once applied or if the account was renamed.
const SEEDED_ADMIN_ID = '20202020-9e3b-46d4-a556-88b9ddc2b034';
const ADMIN_EMAIL = 'jules@passlink.fr';
// bcrypt hash of the local admin password, cost 10 (same as hashPassword).
const ADMIN_PASSWORD_HASH =
  '$2b$10$6Ct.iALzdoL9zpXML31gvujO/CT1sqvOUzxCk0mvYwtF8nVC.j7JC';

const buildAdminCredentialSwapSql = (): string => `
DO $$
DECLARE workspace_schema text;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM core.user
    WHERE id = '${SEEDED_ADMIN_ID}'
      AND email = 'tim@apple.dev'
  ) THEN
    RETURN;
  END IF;

  UPDATE core.user
  SET "firstName" = 'Jules',
      "lastName" = 'Doe',
      "email" = '${ADMIN_EMAIL}',
      "passwordHash" = '${ADMIN_PASSWORD_HASH}'
  WHERE id = '${SEEDED_ADMIN_ID}';

  FOR workspace_schema IN
    SELECT schema_name
    FROM information_schema.schemata
    WHERE schema_name LIKE 'workspace_%'
  LOOP
    EXECUTE format(
      'UPDATE %I."workspaceMember" SET "userEmail" = ''${ADMIN_EMAIL}'', "nameFirstName" = ''Jules'', "nameLastName" = ''Doe'' WHERE "userId" = ''${SEEDED_ADMIN_ID}''',
      workspace_schema
    );
  END LOOP;
END
$$;`;

const swapSeededAdminCredentials = async (
  options: TwentyServiceOptions,
): Promise<void> => {
  const { configuration } = options;

  try {
    await runProcessToCompletion({
      name: 'init',
      command: path.join(
        configuration.paths.postgresPrefixPath,
        'bin',
        'psql',
      ),
      args: [
        '--dbname',
        `postgres://postgres:postgres@127.0.0.1:${configuration.postgresPort}/default`,
        '--command',
        buildAdminCredentialSwapSql(),
      ],
      cwd: configuration.paths.serverPackagePath,
      logsPath: configuration.paths.logsPath,
      timeoutMs: DATABASE_COMMAND_TIMEOUT_MS,
    });
  } catch (error) {
    console.warn(
      '[twenty-native] best-effort command failed: admin credential swap',
      error,
    );
  }
};

export const createTwentyService = (
  options: TwentyServiceOptions,
): TwentyService => {
  const environment = buildServerEnvironment(options);
  const serverEntryPath = path.join(
    options.configuration.paths.serverPackagePath,
    'dist',
    'main.js',
  );
  const workerEntryPath = path.join(
    options.configuration.paths.serverPackagePath,
    'dist',
    'queue-worker',
    'queue-worker.js',
  );

  const processes = new Map<string, ChildProcess>();
  const restartCounts = new Map<string, number>();
  let isStopping = false;

  const assertBundleIsAssembled = (): void => {
    for (const entryPath of [serverEntryPath, workerEntryPath]) {
      if (!existsSync(entryPath)) {
        throw new Error(
          `Runtime bundle entry is missing: ${entryPath}. Run \`yarn native:build\` first.`,
        );
      }
    }
  };

  const initialize = async (mode: TwentyInitializationMode): Promise<void> => {
    if (mode === 'first-run') {
      // Mirrors database:init:prod: setup-db creates schemas and the
      // uuid-ossp/unaccent extensions; --include-slow is what lets DDL and
      // data-backfill instance commands run at all.
      await runServerCommand(options, ['dist/database/scripts/setup-db.js']);
      await runServerCommand(options, [
        'dist/command/command',
        'run-instance-commands',
        '--force',
        '--include-slow',
      ]);

      // Seeds the prefilled dev workspace (tim@apple.dev); matches what the
      // all-in-one docker image does on first boot. Failure is not fatal.
      await runBestEffortServerCommand(options, [
        'dist/command/command',
        'workspace:seed:dev',
        '--light',
      ]);

      await swapSeededAdminCredentials(options);

      return;
    }

    await runServerCommand(options, [
      'dist/command/command',
      'run-instance-commands',
      '--force',
      '--include-slow',
    ]);

    await swapSeededAdminCredentials(options);
    // Same upgrade sequence as the docker init script: flush, upgrade, flush.
    await runBestEffortServerCommand(options, [
      'dist/command/command',
      'cache:flush',
    ]);
    await runBestEffortServerCommand(options, [
      'dist/command/command',
      'upgrade',
    ]);
    await runBestEffortServerCommand(options, [
      'dist/command/command',
      'cache:flush',
    ]);
  };

  const spawnSupervised = (name: string, entryPath: string): ChildProcess => {
    const childProcess = spawnLongRunningProcess({
      name,
      // The bundled node, not Electron's embedded one: the server's native
      // addons ship Node-ABI prebuilds that do not load under Electron.
      command: options.configuration.paths.nodeBinPath,
      args: [entryPath],
      cwd: options.configuration.paths.serverPackagePath,
      env: environment,
      logsPath: options.configuration.paths.logsPath,
    });

    processes.set(name, childProcess);

    childProcess.once('exit', (exitCode) => {
      if (isStopping || processes.get(name) !== childProcess) {
        return;
      }

      const restartCount = restartCounts.get(name) ?? 0;

      if (restartCount >= MAX_PROCESS_RESTARTS) {
        console.error(
          `[twenty-native] ${name} exited with code ${exitCode} and hit the restart limit`,
        );

        return;
      }

      console.warn(
        `[twenty-native] ${name} exited with code ${exitCode}, restarting (${restartCount + 1}/${MAX_PROCESS_RESTARTS})`,
      );
      restartCounts.set(name, restartCount + 1);

      setTimeout(() => {
        if (!isStopping) {
          spawnSupervised(name, entryPath);
        }
      }, PROCESS_RESTART_DELAY_MS);
    });

    return childProcess;
  };

  const start = (): void => {
    assertBundleIsAssembled();
    spawnSupervised('server', serverEntryPath);
    spawnSupervised('worker', workerEntryPath);
  };

  const stop = async (): Promise<void> => {
    isStopping = true;

    await Promise.allSettled(
      [...processes.values()].map(
        (childProcess) =>
          new Promise<void>((resolve) => {
            const timeout = setTimeout(resolve, PROCESS_STOP_TIMEOUT_MS);

            childProcess.once('exit', () => {
              clearTimeout(timeout);
              resolve();
            });

            childProcess.kill('SIGTERM');
          }),
      ),
    );

    for (const childProcess of processes.values()) {
      if (childProcess.exitCode === null) {
        childProcess.kill('SIGKILL');
      }
    }

    processes.clear();
  };

  return { initialize, start, stop };
};

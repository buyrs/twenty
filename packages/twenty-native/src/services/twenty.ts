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
    PORT: String(configuration.serverPort),
    PG_DATABASE_URL: `postgres://postgres:postgres@127.0.0.1:${configuration.postgresPort}/default`,
    REDIS_URL: `redis://127.0.0.1:${configuration.redisPort}`,
    APP_SECRET: configuration.appSecret,
    APP_VERSION: options.appVersion,
    SIGN_IN_PREFILLED: 'true',
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

      return;
    }

    await runServerCommand(options, [
      'dist/command/command',
      'run-instance-commands',
      '--force',
      '--include-slow',
    ]);
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

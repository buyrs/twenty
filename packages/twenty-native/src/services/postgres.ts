import { existsSync } from 'node:fs';
import path from 'node:path';

import { waitForTcpPort } from '../health';
import {
  runProcessToCompletion,
  spawnLongRunningProcess,
  type ProcessOutput,
} from '../logging';
import type { ChildProcess } from 'node:child_process';

const POSTGRES_START_TIMEOUT_MS = 60_000;
const POSTGRES_STOP_TIMEOUT_MS = 15_000;
const DATABASE_NAME = 'default';

export type PostgresServiceOptions = {
  prefixPath: string;
  dataPath: string;
  socketPath: string;
  port: number;
  logsPath: string;
};

export type PostgresService = {
  start: () => Promise<void>;
  createDatabaseIfMissing: () => Promise<void>;
  hasCoreSchema: () => Promise<boolean>;
  stop: () => Promise<void>;
};

const runPostgresCommand = async (
  options: PostgresServiceOptions,
  commandName: string,
  args: string[],
  timeoutMs?: number,
): Promise<ProcessOutput> =>
  runProcessToCompletion({
    name: 'postgres',
    command: path.join(options.prefixPath, 'bin', commandName),
    args,
    logsPath: options.logsPath,
    timeoutMs,
  });

const queryPostgres = async (
  options: PostgresServiceOptions,
  databaseName: string,
  sql: string,
): Promise<string> => {
  const output = await runProcessToCompletion({
    name: 'postgres',
    command: path.join(options.prefixPath, 'bin', 'psql'),
    args: [
      '-h',
      '127.0.0.1',
      '-p',
      String(options.port),
      '-U',
      'postgres',
      '-d',
      databaseName,
      '-tAc',
      sql,
    ],
    logsPath: options.logsPath,
    timeoutMs: 30_000,
  });

  return output.stdout.trim();
};

const waitForProcessExit = (
  childProcess: ChildProcess,
  timeoutMs: number,
): Promise<void> =>
  new Promise((resolve) => {
    const timeout = setTimeout(resolve, timeoutMs);

    childProcess.once('exit', () => {
      clearTimeout(timeout);
      resolve();
    });
  });

export const createPostgresService = (
  options: PostgresServiceOptions,
): PostgresService => {
  let serverProcess: ChildProcess | null = null;

  const start = async (): Promise<void> => {
    if (serverProcess) {
      return;
    }

    if (!existsSync(path.join(options.dataPath, 'PG_VERSION'))) {
      await runPostgresCommand(
        options,
        'initdb',
        [
          // The twenty-app-dev container image uses the same trust + UTF8
          // defaults; postgres only listens on 127.0.0.1 in this app.
          '-D',
          options.dataPath,
          '-U',
          'postgres',
          '--auth=trust',
          '--encoding=UTF8',
        ],
        POSTGRES_START_TIMEOUT_MS,
      );
    }

    const childProcess = spawnLongRunningProcess({
      name: 'postgres',
      command: path.join(options.prefixPath, 'bin', 'postgres'),
      args: [
        '-D',
        options.dataPath,
        '-p',
        String(options.port),
        '-c',
        'listen_addresses=127.0.0.1',
        '-c',
        `unix_socket_directories=${options.socketPath}`,
      ],
      logsPath: options.logsPath,
    });

    let earlyExitHandler: (exitCode: number | null) => void = () => undefined;

    const earlyExit = new Promise<never>((_, reject) => {
      earlyExitHandler = (exitCode: number | null) => {
        reject(
          new Error(
            `postgres exited during startup with code ${exitCode} (see ${path.join(options.logsPath, 'postgres.log')})`,
          ),
        );
      };
    });

    childProcess.once('exit', earlyExitHandler);
    serverProcess = childProcess;

    try {
      await Promise.race([
        waitForTcpPort(options.port, POSTGRES_START_TIMEOUT_MS),
        earlyExit,
      ]);
    } finally {
      childProcess.removeListener('exit', earlyExitHandler);
    }
  };

  const createDatabaseIfMissing = async (): Promise<void> => {
    // A bare initdb only creates the "postgres" database; the docker image
    // relies on POSTGRES_DB for this, setup-db.js assumes it already exists.
    const databaseExists = await queryPostgres(
      options,
      'postgres',
      `SELECT 1 FROM pg_database WHERE datname = '${DATABASE_NAME}'`,
    ).then((result) => result === '1');

    if (!databaseExists) {
      // "default" is a reserved SQL keyword and must stay quoted.
      await queryPostgres(
        options,
        'postgres',
        `CREATE DATABASE "${DATABASE_NAME}"`,
      );
    }
  };

  const hasCoreSchema = async (): Promise<boolean> =>
    queryPostgres(
      options,
      DATABASE_NAME,
      "SELECT EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'core')",
    ).then((result) => result === 't');

  const stop = async (): Promise<void> => {
    if (!serverProcess) {
      return;
    }

    const childProcess = serverProcess;
    serverProcess = null;

    // SIGINT is postgres' fast shutdown; SIGQUIT is the immediate escalation.
    childProcess.kill('SIGINT');
    await waitForProcessExit(childProcess, POSTGRES_STOP_TIMEOUT_MS);

    if (childProcess.exitCode === null) {
      childProcess.kill('SIGQUIT');
      await waitForProcessExit(childProcess, POSTGRES_STOP_TIMEOUT_MS);
    }
  };

  return { start, createDatabaseIfMissing, hasCoreSchema, stop };
};

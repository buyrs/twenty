import path from 'node:path';
import type { ChildProcess } from 'node:child_process';

import { waitForTcpPort } from '../health';
import { spawnLongRunningProcess } from '../logging';

const REDIS_START_TIMEOUT_MS = 30_000;
const REDIS_STOP_TIMEOUT_MS = 10_000;

export type RedisServiceOptions = {
  binPath: string;
  dataPath: string;
  port: number;
  logsPath: string;
};

export type RedisService = {
  start: () => Promise<void>;
  stop: () => Promise<void>;
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

export const createRedisService = (
  options: RedisServiceOptions,
): RedisService => {
  let serverProcess: ChildProcess | null = null;

  const start = async (): Promise<void> => {
    if (serverProcess) {
      return;
    }

    const childProcess = spawnLongRunningProcess({
      name: 'redis',
      command: options.binPath,
      args: [
        '--port',
        String(options.port),
        '--bind',
        '127.0.0.1',
        '--protected-mode',
        'yes',
        '--dir',
        options.dataPath,
        // Redis only carries the BullMQ queues; CRM state lives in Postgres,
        // so nothing here needs to survive a restart.
        '--save',
        '',
        '--appendonly',
        'no',
        // BullMQ relies on evicted-job semantics never firing silently.
        '--maxmemory-policy',
        'noeviction',
      ],
      logsPath: options.logsPath,
    });

    let earlyExitHandler: (exitCode: number | null) => void = () => undefined;

    const earlyExit = new Promise<never>((_, reject) => {
      earlyExitHandler = (exitCode: number | null) => {
        reject(
          new Error(
            `redis-server exited during startup with code ${exitCode} (see ${path.join(options.logsPath, 'redis.log')})`,
          ),
        );
      };
    });

    childProcess.once('exit', earlyExitHandler);
    serverProcess = childProcess;

    try {
      await Promise.race([
        waitForTcpPort(options.port, REDIS_START_TIMEOUT_MS),
        earlyExit,
      ]);
    } finally {
      childProcess.removeListener('exit', earlyExitHandler);
    }
  };

  const stop = async (): Promise<void> => {
    if (!serverProcess) {
      return;
    }

    const childProcess = serverProcess;
    serverProcess = null;

    childProcess.kill('SIGTERM');
    await waitForProcessExit(childProcess, REDIS_STOP_TIMEOUT_MS);

    if (childProcess.exitCode === null) {
      childProcess.kill('SIGKILL');
      await waitForProcessExit(childProcess, REDIS_STOP_TIMEOUT_MS);
    }
  };

  return { start, stop };
};

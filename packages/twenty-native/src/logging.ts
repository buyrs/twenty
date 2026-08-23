import { type ChildProcess, spawn } from 'node:child_process';
import { createWriteStream, mkdirSync, type WriteStream } from 'node:fs';
import { createInterface } from 'node:readline';
import path from 'node:path';

export type SpawnedProcessOptions = {
  name: string;
  command: string;
  args: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  logsPath: string;
};

export type ProcessOutput = {
  exitCode: number | null;
  stdout: string;
  stderr: string;
};

const openLogFile = (logsPath: string, fileName: string): WriteStream => {
  mkdirSync(logsPath, { recursive: true });

  return createWriteStream(path.join(logsPath, fileName), {
    flags: 'a',
  });
};

const pipeOutputToLog = (
  childProcess: ChildProcess,
  name: string,
  logStream: WriteStream,
): void => {
  const pipe = (stream: NodeJS.ReadableStream | null) => {
    if (!stream) {
      return;
    }

    const logLine = (line: string) => {
      const timestamp = new Date().toISOString();

      logStream.write(`[${timestamp}] [${name}] ${line}\n`);
    };

    createInterface({ input: stream }).on('line', logLine);
  };

  pipe(childProcess.stdout);
  pipe(childProcess.stderr);
};

// Long-running supervised process (postgres, redis, server, worker): output is
// appended to <logsPath>/<name>.log; lifecycle stays with the caller.
export const spawnLongRunningProcess = (
  options: SpawnedProcessOptions,
): ChildProcess => {
  const logStream = openLogFile(options.logsPath, `${options.name}.log`);
  const childProcess = spawn(options.command, options.args, {
    cwd: options.cwd,
    env: options.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  pipeOutputToLog(childProcess, options.name, logStream);
  childProcess.once('exit', () => {
    logStream.end();
  });

  return childProcess;
};

// One-shot command (initdb, psql, setup-db, migrations): resolves on exit
// code 0, rejects otherwise or on timeout. stdout is captured for callers
// that inspect query results.
export const runProcessToCompletion = async (
  options: SpawnedProcessOptions & { timeoutMs?: number },
): Promise<ProcessOutput> => {
  const logStream = openLogFile(options.logsPath, `${options.name}.log`);
  const childProcess = spawn(options.command, options.args, {
    cwd: options.cwd,
    env: options.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';

  if (childProcess.stdout) {
    childProcess.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
  }

  if (childProcess.stderr) {
    childProcess.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
  }

  pipeOutputToLog(childProcess, options.name, logStream);

  return new Promise<ProcessOutput>((resolve, reject) => {
    const timeout = options.timeoutMs
      ? setTimeout(() => {
          childProcess.kill('SIGKILL');
          reject(
            new Error(
              `\`${options.command} ${options.args.join(' ')}\` timed out after ${options.timeoutMs}ms (see ${path.join(options.logsPath, `${options.name}.log`)})`,
            ),
          );
        }, options.timeoutMs)
      : null;

    const settle = (callback: () => void) => {
      if (timeout) {
        clearTimeout(timeout);
      }

      logStream.end();
      callback();
    };

    childProcess.once('error', (error) => {
      settle(() => reject(error));
    });

    childProcess.once('exit', (exitCode) => {
      settle(() => {
        if (exitCode === 0) {
          resolve({ exitCode, stdout, stderr });
          return;
        }

        reject(
          new Error(
            `\`${options.command} ${options.args.join(' ')}\` exited with code ${exitCode} (see ${path.join(options.logsPath, `${options.name}.log`)})`,
          ),
        );
      });
    });
  });
};

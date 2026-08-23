import net from 'node:net';

const TCP_POLL_INTERVAL_MS = 250;
const HTTP_POLL_INTERVAL_MS = 500;
const HTTP_REQUEST_TIMEOUT_MS = 2_000;

const sleep = (durationMs: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });

export const waitForTcpPort = async (
  port: number,
  timeoutMs: number,
): Promise<void> => {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const isPortOpen = await new Promise<boolean>((resolve) => {
      const socket = net.connect({ host: '127.0.0.1', port });

      socket.once('connect', () => {
        socket.destroy();
        resolve(true);
      });

      socket.once('error', () => {
        socket.destroy();
        resolve(false);
      });
    });

    if (isPortOpen) {
      return;
    }

    await sleep(TCP_POLL_INTERVAL_MS);
  }

  throw new Error(
    `No process started listening on 127.0.0.1:${port} within ${timeoutMs}ms`,
  );
};

export const waitForSuccessfulRequest = async (
  url: string,
  timeoutMs: number,
): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  let lastError = 'no request was attempted';

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(HTTP_REQUEST_TIMEOUT_MS),
      });

      if (response.ok) {
        return;
      }

      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }

    await sleep(HTTP_POLL_INTERVAL_MS);
  }

  throw new Error(
    `No successful response from ${url} within ${timeoutMs}ms (${lastError})`,
  );
};

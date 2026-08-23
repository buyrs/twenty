import type { BrowserWindow } from 'electron';

export const LOADING_SCREEN_HTML = `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Twenty</title>
    <style>
      html, body {
        margin: 0;
        height: 100%;
        background: #101319;
        color: #eaecf1;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      }
      main {
        height: 100%;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 14px;
      }
      h1 {
        margin: 0;
        font-size: 30px;
        letter-spacing: -0.02em;
      }
      #status {
        margin: 0;
        font-size: 13px;
        color: #9aa1ad;
        min-height: 1em;
      }
      #spinner {
        width: 22px;
        height: 22px;
        border-radius: 50%;
        border: 2px solid #2a3040;
        border-top-color: #707ae0;
        animation: spin 0.9s linear infinite;
      }
      @keyframes spin {
        to { transform: rotate(360deg); }
      }
    </style>
  </head>
  <body>
    <main>
      <h1>Twenty</h1>
      <div id="spinner"></div>
      <p id="status">Starting…</p>
    </main>
    <script>
      window.twentyNativeSetStatus = (status) => {
        document.getElementById('status').textContent = status;
      };
    </script>
  </body>
</html>
`;

export const setWindowStatus = (
  window: BrowserWindow,
  status: string,
): void => {
  // The window can be mid-navigation or closed; status updates are cosmetic.
  window.webContents
    .executeJavaScript(
      `window.twentyNativeSetStatus(${JSON.stringify(status)})`,
    )
    .catch(() => undefined);
};

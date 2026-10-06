// CI installs Chromium through the lockfile's Playwright version. Omitting
// executablePath lets Playwright select that matching headless browser instead
// of an unrelated system installation. Local callers can still opt in explicitly.
export function chromiumLaunchOptions({timeout, env = process.env} = {}) {
  if (!Number.isFinite(timeout) || timeout <= 0) throw new RangeError('Browser launch timeout must be finite and positive');
  const executablePath = env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
  return {
    ...(executablePath ? {executablePath} : {}),
    headless: true,
    timeout,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  };
}

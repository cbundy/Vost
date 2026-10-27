// Turns a Playwright browser launch error into the text the capture command prints.
const INSTALL = 'npx playwright install --with-deps chromium';

function stripAnsi(s: string): string {
  return s.replace(/\u001b\[[0-9;]*[A-Za-z]/g, '');
}

export function formatLaunchError(message: string): string {
  const text = stripAnsi(message);
  const libs: string[] = [];
  for (const m of text.matchAll(/error while loading shared libraries: ([^\s:]+)/g)) {
    if (!libs.includes(m[1])) libs.push(m[1]);
  }
  if (libs.length > 0) {
    return (
      `Chromium cannot start, missing system library: ${libs.join(', ')}\n` +
      'Rebuild the dev container (its .devcontainer/Dockerfile installs Chromium and its libraries at /ms-playwright), ' +
      `or outside the container run: ${INSTALL}`
    );
  }
  const lines = text.split('\n');
  if (text.includes("Executable doesn't exist")) {
    return `${lines[0]}\nThe browser download is missing, run: npx playwright install chromium`;
  }
  const err = lines.find((l) => l.includes('[err]'));
  return err ? `${lines[0]}\n${err.trim()}` : lines[0];
}

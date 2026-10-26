/**
 * Records the README's window demo: the desktop app reading the scripted desk of
 * made-up devices (`src/demo/battery.ts`), written to the GIF named by the first
 * argument (`make demo` passes `docs/demo.gif`).
 *
 * It builds the demo bundle, starts Electron with a debugging port and a
 * throwaway user-data folder (so the recording never touches the installed app's
 * settings; under `xvfb-run` when there is no display), presses the window's own
 * buttons through the Chrome DevTools Protocol, records the page with its
 * screencast and has ffmpeg turn the frames into a GIF. The window is recorded in
 * its dark appearance, like the widgets' moving picture. The script is the
 * recording: a changed screen is re-recorded with `make demo`, never edited by hand.
 *
 * Needs `make desktop-install` and ffmpeg; on Linux without a display, xvfb-run.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

interface Frame {
  file: string;
  timestamp: number;
}

interface Session {
  call(method: string, params?: Record<string, unknown>): Promise<Record<string, unknown>>;
  on(method: string, listener: (params: Record<string, unknown>) => void): void;
  close(): void;
}

const here = dirname(fileURLToPath(import.meta.url));
const output = resolve(process.argv[2] ?? join(here, '..', '..', 'docs', 'demo.gif'));
const PORT = 9333;
const WIDTH = 680;
const HEIGHT = 520;
/** GIF frame rate and the pause a viewer gets between steps. */
const FPS = 15;
/** Recorded at twice the window's size so the GIF stays sharp on a high-density screen. */
const SCALE = 2;
const BEAT_MS = 700;

/** A pointer the recording can see: the screencast captures the page, not the system cursor. */
const CURSOR = `(() => {
  const dot = document.createElement('div');
  dot.id = 'demo-cursor';
  Object.assign(dot.style, {
    position: 'fixed', left: '${WIDTH / 2}px', top: '${HEIGHT - 40}px', width: '18px', height: '18px',
    margin: '-11px 0 0 -11px', borderRadius: '50%', background: 'rgba(255, 255, 255, 0.3)',
    border: '2px solid rgba(255, 255, 255, 0.9)', pointerEvents: 'none', zIndex: 9999,
    transition: 'left 0.35s ease, top 0.35s ease, transform 0.12s ease',
  });
  document.body.appendChild(dot);
})()`;

await main();

async function main(): Promise<void> {
  run('node', [join(here, 'build.ts')], { ...process.env, JUICE_DEMO: '1' });
  const directory = mkdtempSync(join(tmpdir(), 'juice-demo-'));
  try {
    const stepFile = join(directory, 'step');
    writeFileSync(stepFile, '0');
    const app = launch(directory, stepFile);
    try {
      const session = await attach();
      const recorded = await record(session, directory, stepFile);
      session.close();
      encode(recorded, directory);
      console.log(`demo written to ${output}`);
    } finally {
      await stop(app);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
    // The installers must never carry the demo desk, however the recording ended.
    run('node', [join(here, 'build.ts')], { ...process.env, JUICE_DEMO: '' });
  }
}

/**
 * Ends Electron and everything it started. xvfb-run starts Electron as its
 * child, so the whole group goes, or a stale instance keeps the debugging port
 * and the next recording attaches to it. An app that already exited is left as is.
 */
async function stop(app: ChildProcess): Promise<void> {
  if (app.exitCode !== null || app.signalCode !== null || app.pid === undefined) {
    return;
  }
  const { promise: exited, resolve: onExit } = Promise.withResolvers<void>();
  app.once('exit', () => onExit());
  try {
    process.kill(-app.pid, 'SIGTERM');
  } catch {
    return;
  }
  await exited;
}

/** The scripted session: the desk appears, then each Refresh moves it one step and the threshold is stepped up. */
async function record(session: Session, directory: string, stepFile: string): Promise<Frame[]> {
  const frames: Frame[] = [];
  session.on('Page.screencastFrame', params => {
    const metadata = params.metadata as { timestamp: number };
    const file = join(directory, `${String(frames.length).padStart(5, '0')}.png`);
    writeFileSync(file, Buffer.from(params.data as string, 'base64'));
    frames.push({ file, timestamp: metadata.timestamp });
    session.call('Page.screencastFrameAck', { sessionId: params.sessionId }).catch(() => undefined);
  });
  await session.call('Page.enable');
  // The screens read the colour scheme once, when the page loads: emulate it first, then reload.
  await session.call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
  await session.call('Page.reload');
  await waitFor(session, `document.body.innerText.includes('Headphones')`);
  await session.call('Runtime.evaluate', { expression: CURSOR });
  await session.call('Page.startScreencast', { format: 'png', maxWidth: WIDTH * SCALE, maxHeight: HEIGHT * SCALE, everyNthFrame: 1 });
  await pause(BEAT_MS * 2);

  // The keyboard reads lower, then drops under the 20% threshold and turns red.
  await refresh(session, stepFile, 1);
  await pause(BEAT_MS * 2);
  await refresh(session, stepFile, 2);
  await pause(BEAT_MS * 3);
  // A phone connects at 27%: the next two thresholds judge it.
  await refresh(session, stepFile, 3);
  await pause(BEAT_MS * 2);
  for (const percent of [25, 30]) {
    await click(session, 'threshold-up');
    await waitFor(session, `document.querySelector('[data-testid="threshold"]')?.textContent === '${percent}%'`);
    await pause(BEAT_MS * 2);
  }
  // The headphones leave.
  await refresh(session, stepFile, 4);
  await pause(BEAT_MS * 3);

  await session.call('Page.stopScreencast');
  if (frames.length === 0) {
    throw new Error('the screencast sent no frames');
  }
  return frames;
}

/** Moves the desk to `step`, then presses Refresh so the window reads it. */
async function refresh(session: Session, stepFile: string, step: number): Promise<void> {
  writeFileSync(stepFile, String(step));
  await click(session, 'refresh');
}

/** Moves the visible pointer to an element's centre and presses it there. */
async function click(session: Session, testId: string): Promise<void> {
  const box = await evaluate<{ x: number; y: number } | null>(
    session,
    `(() => {
      const element = document.querySelector('[data-testid="${testId}"]');
      if (element === null) return null;
      const rect = element.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    })()`,
  );
  if (box === null) {
    throw new Error(`no ${testId} on the screen`);
  }
  await session.call('Runtime.evaluate', {
    expression: `Object.assign(document.getElementById('demo-cursor').style, { left: '${box.x}px', top: '${box.y}px' })`,
  });
  await pause(380);
  const mouse = { x: box.x, y: box.y, button: 'left', clickCount: 1 };
  await setCursorScale(session, 0.8);
  await session.call('Input.dispatchMouseEvent', { type: 'mousePressed', ...mouse });
  await session.call('Input.dispatchMouseEvent', { type: 'mouseReleased', ...mouse });
  await setCursorScale(session, 1);
  // Out of the way, in the empty area under the list, so no button stays covered.
  await pause(250);
  await session.call('Runtime.evaluate', {
    expression: `Object.assign(document.getElementById('demo-cursor').style, { left: '${WIDTH / 2}px', top: '${HEIGHT - 90}px' })`,
  });
}

function setCursorScale(session: Session, scale: number): Promise<unknown> {
  return session.call('Runtime.evaluate', {
    expression: `document.getElementById('demo-cursor').style.transform = 'scale(${scale})'`,
  });
}

/** Frames arrive only when the page changes; each is held until the next one's timestamp. */
function encode(frames: Frame[], directory: string): void {
  const list = frames.map((frame, index) => {
    const next = frames[index + 1]?.timestamp ?? frame.timestamp + BEAT_MS / 1000;
    return `file '${frame.file}'\nduration ${(next - frame.timestamp).toFixed(3)}`;
  });
  // The concat demuxer drops the last entry's duration unless the file is named once more.
  const concat = join(directory, 'frames.txt');
  writeFileSync(concat, `${list.join('\n')}\nfile '${frames[frames.length - 1].file}'\n`);
  mkdirSync(dirname(output), { recursive: true });
  run('ffmpeg', [
    '-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', concat,
    '-vf', `fps=${FPS},split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=none`,
    '-loop', '0', output,
  ]);
}

/** Electron with a debugging port, inside a virtual display when the machine has none. */
function launch(directory: string, stepFile: string): ChildProcess {
  const electron = createRequire(import.meta.url)('electron') as string;
  const args = [`--remote-debugging-port=${PORT}`, `--force-device-scale-factor=${SCALE}`, `--user-data-dir=${join(directory, 'profile')}`, here];
  const headless = process.platform === 'linux' && process.env.DISPLAY === undefined;
  if (headless) {
    // Containers run as root without a GPU; Chromium needs both said out loud.
    args.unshift('--no-sandbox', '--disable-gpu');
  }
  const [command, argv] = headless
    ? ['xvfb-run', ['-a', '-s', `-screen 0 ${(WIDTH + 100) * SCALE}x${(HEIGHT + 100) * SCALE}x24`, electron, ...args]]
    : [electron, args];
  return spawn(command, argv, { stdio: 'ignore', detached: true, env: { ...process.env, JUICE_DEMO_STEP_FILE: stepFile } });
}

async function attach(): Promise<Session> {
  const target = await poll(async () => {
    const targets = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()) as Array<Record<string, string>>;
    return targets.find(candidate => candidate.type === 'page' && candidate.url.endsWith('index.html')) ?? null;
  });
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((done, fail) => {
    socket.onopen = done;
    socket.onerror = fail;
  });
  const pending = new Map<number, (message: Record<string, unknown>) => void>();
  const listeners = new Map<string, (params: Record<string, unknown>) => void>();
  const state = { id: 0 };
  socket.onmessage = event => {
    const message = JSON.parse(String(event.data)) as Record<string, unknown>;
    if (typeof message.id === 'number') {
      pending.get(message.id)?.(message);
      pending.delete(message.id);
    } else if (typeof message.method === 'string') {
      listeners.get(message.method)?.(message.params as Record<string, unknown>);
    }
  };
  return {
    call(method, params = {}) {
      state.id += 1;
      const id = state.id;
      socket.send(JSON.stringify({ id, method, params }));
      return new Promise((done, fail) =>
        pending.set(id, message =>
          message.error === undefined ? done((message.result ?? {}) as Record<string, unknown>) : fail(new Error(JSON.stringify(message.error))),
        ),
      );
    },
    on(method, listener) {
      listeners.set(method, listener);
    },
    close() {
      socket.close();
    },
  };
}

async function evaluate<Value>(session: Session, expression: string): Promise<Value> {
  const reply = await session.call('Runtime.evaluate', { expression, returnByValue: true });
  return (reply.result as { value: Value }).value;
}

function waitFor(session: Session, condition: string): Promise<true> {
  return poll(async () => ((await evaluate<boolean>(session, condition)) ? true : null));
}

/** Retries until `attempt` answers, for as long as an app takes to start. */
async function poll<Value>(attempt: () => Promise<Value | null>, timeoutMs = 30_000): Promise<Value> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await attempt().catch(() => null);
    if (value !== null) {
      return value;
    }
    await pause(250);
  }
  throw new Error('timed out waiting for the app');
}

function pause(ms: number): Promise<void> {
  return new Promise(done => setTimeout(done, ms));
}

function run(command: string, args: string[], env: NodeJS.ProcessEnv = process.env): void {
  const result = spawnSync(command, args, { stdio: 'inherit', env });
  if (result.status !== 0) {
    throw new Error(`${command} failed${result.error ? `: ${result.error.message}` : ''}`);
  }
}

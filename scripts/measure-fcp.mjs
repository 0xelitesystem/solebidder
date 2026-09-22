#!/usr/bin/env node
// FIRST CONTENTFUL PAINT, MEASURED RATHER THAN ESTIMATED.
//
// DESIGN 6.2 states a budget: first contentful paint under 1.2 s on a throttled profile, and it
// names this script as the enforcement. Until this file existed the row in that table was a
// number nobody had produced, which is the same thing as not having a budget.
//
//   node scripts/measure-fcp.mjs             measure and print
//   node scripts/measure-fcp.mjs --runs 9    more samples
//   node scripts/measure-fcp.mjs --json      machine readable
//   node scripts/measure-fcp.mjs --unthrottled   the reference line with no network in the way
//
// The rig is ported from the sibling flagship, scripts/measure-fcp.mjs in photontax, and the
// reasoning below is that file's reasoning. What changed here is the ROUTE TABLE, because this
// product is not a single file: the page is index.html and the behaviour is a graph of plain ES
// modules under src/ that the browser loads itself, plus a bundled name index that is fetched
// after boot. A rig that served the page for every path would have answered every module request
// with the HTML and measured a site that does not exist.
//
// HOW, AND WHY EACH PIECE IS WHAT IT IS.
//
//   The page is served over HTTP, not opened from a file:// URL. A file:// load has no transfer
//   at all, so it would measure this machine's disk and report a number that has nothing to do
//   with a reader on a phone.
//
//   It is served WITH Content-Encoding: gzip, because GitHub Pages compresses and the payload
//   budget in DESIGN 6.2 is stated in gzipped bytes. Measuring the uncompressed page would be
//   measuring a page nobody is served.
//
//   The throttle is the Fast 3G preset of the DevTools network conditions, by its exact
//   constants: 562.5 ms of added latency, 1.6 Mbit/s down and 750 Kbit/s up, each at the 90
//   percent the preset applies. They are written out below rather than named, because a preset
//   that changes underneath a published number is a published number that quietly becomes false.
//
//   Every run gets a FRESH BROWSER CONTEXT and Network.setCacheDisabled, which is what "cold
//   cache" means. Warm runs measure the second visit, and the design says first.
//
//   The browser is Microsoft Edge, headless. Nothing here drives Chrome or Brave.
//
// ZERO DEPENDENCIES. The Chrome DevTools Protocol is spoken over the WebSocket that node
// provides, and the HTTP server is node:http.

import { createServer } from 'node:http';
import { readFile, readdir, mkdtemp, rm, stat } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { REPO, say, isMain } from './_shipped.mjs';

/** DESIGN 6.2, the throttled first contentful paint ceiling. Milliseconds. */
export const FCP_BUDGET_MS = 1200;

/**
 * The DevTools "Fast 3G" preset, written out. Chromium applies a 0.9 factor to the nominal
 * throughputs, and the latency is the whole added round trip.
 */
export const FAST_3G = Object.freeze({
  latencyMs: 562.5,
  downloadBytesPerSecond: (1.6 * 1024 * 1024 / 8) * 0.9,
  uploadBytesPerSecond: (750 * 1024 / 8) * 0.9,
});

const EDGE_CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/microsoft-edge',
  '/usr/bin/microsoft-edge-stable',
];

/** @returns {Promise<string>} */
export async function findEdge() {
  for (const c of EDGE_CANDIDATES) {
    try { await stat(c); return c; } catch { /* next */ }
  }
  throw new Error('measure-fcp: no Microsoft Edge found. Looked in:\n  ' + EDGE_CANDIDATES.join('\n  ')
    + '\nThis rig drives Edge on purpose and it will not fall back to another browser.');
}

const MIME = new Map(Object.entries({
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
}));

/** @param {string} dir @param {string[]} out @returns {Promise<string[]>} */
async function walk(dir, out = []) {
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === '.git') continue;
      await walk(full, out);
    } else if (MIME.has(path.extname(e.name))) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Build the route table from disk: the page at '/', and every file under the listed directories
 * at the path the browser will ask for.
 *
 * WHY THE WHOLE TREE AND NOT A HAND LIST. The page loads src/ui/main.js as a module and the
 * browser resolves that import graph itself. Hand listing the graph would mean a rig that goes
 * stale the first time somebody adds a module, and a stale rig 404s a module, and a run that
 * 404s a module is a run that measured a page in an error state while reporting a healthy
 * number. Walking the tree cannot go stale.
 *
 * @param {Object} [options]
 * @param {string} [options.root]
 * @param {string} [options.html] Override the page body, for a positive control.
 * @param {string[]} [options.dirs]
 * @param {Record<string,{body:Buffer,type:string}>} [options.extra] Routes added verbatim.
 * @returns {Promise<{routes:Record<string,{body:Buffer,type:string}>, pageBytes:number, treeBytes:number}>}
 */
export async function buildRoutes(options = {}) {
  const root = options.root === undefined ? REPO : options.root;
  const dirs = options.dirs === undefined ? ['src', 'test'] : options.dirs;
  const html = options.html === undefined ? await readFile(path.join(root, 'index.html'), 'utf8') : options.html;

  /** @type {Record<string, {body:Buffer, type:string}>} */
  const routes = {};
  const page = gzipSync(Buffer.from(html, 'utf8'), { level: 9 });
  routes['/'] = { body: page, type: MIME.get('.html') };
  routes['/index.html'] = routes['/'];

  let treeBytes = 0;
  for (const d of dirs) {
    for (const abs of await walk(path.join(root, d))) {
      const rel = '/' + path.relative(root, abs).split(path.sep).join('/');
      const body = gzipSync(await readFile(abs), { level: 9 });
      treeBytes += body.length;
      routes[rel] = { body, type: MIME.get(path.extname(abs)) };
      // The page asks for './src/...' from '/', which resolves to '/src/...'. It also works from
      // a sub path, so both spellings are registered rather than assumed.
      routes['/.' + rel] = routes[rel];
    }
  }

  for (const [k, v] of Object.entries(options.extra === undefined ? {} : options.extra)) routes[k] = v;
  return { routes, pageBytes: page.length, treeBytes };
}

/**
 * Requests the BROWSER invents, which no line of the page asks for. A 404 on one of these is not
 * evidence that the rig is serving the wrong tree, so it is not counted as a miss. It is still
 * answered with a 404, which is exactly what GitHub Pages answers for the same request: this
 * product ships no icon file, so the real site 404s this too.
 */
const SPECULATIVE = new Set(['/favicon.ico', '/apple-touch-icon.png', '/apple-touch-icon-precomposed.png']);

/**
 * Serve a route table, gzipped, the way GitHub Pages serves it.
 *
 * A path nobody registered gets a 404 rather than something that happens to be lying around,
 * because a silent fallback is how a measurement stops describing the artifact. Every miss the
 * PAGE caused is recorded so the caller can say out loud that a run was incomplete.
 *
 * @param {Record<string, {body:Buffer, type:string}>} routes
 * @returns {Promise<{origin:string, misses:string[], speculative:string[], close:()=>Promise<void>}>}
 */
export async function serveGzipped(routes) {
  /** @type {string[]} */
  const misses = [];
  /** @type {string[]} */
  const speculative = [];
  const server = createServer((req, res) => {
    const key = decodeURIComponent((req.url || '/').split('?')[0]);
    const hit = routes[key];
    if (!hit) {
      if (SPECULATIVE.has(key)) speculative.push(key);
      else misses.push(key);
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
      res.end('measure-fcp: nothing is served at ' + key);
      return;
    }
    res.writeHead(200, {
      'content-type': hit.type,
      'content-encoding': 'gzip',
      'content-length': String(hit.body.length),
      'cache-control': 'no-store',
    });
    res.end(hit.body);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    origin: 'http://127.0.0.1:' + port + '/',
    misses,
    speculative,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

/** A minimal CDP client over one WebSocket. */
export class Cdp {
  /** @param {string} url */
  constructor(url) {
    this.ws = new WebSocket(url);
    this.next = 1;
    /** @type {Map<number,{resolve:Function,reject:Function}>} */
    this.pending = new Map();
    /** @type {((m:any)=>void)[]} */
    this.listeners = [];
    this.ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(typeof ev.data === 'string' ? ev.data : String(ev.data));
      if (msg.id !== undefined) {
        const p = this.pending.get(msg.id);
        if (!p) return;
        this.pending.delete(msg.id);
        if (msg.error) p.reject(new Error(msg.error.message));
        else p.resolve(msg.result);
        return;
      }
      for (const l of this.listeners) l(msg);
    });
  }

  ready() {
    return new Promise((resolve, reject) => {
      this.ws.addEventListener('open', () => resolve(), { once: true });
      this.ws.addEventListener('error', () => reject(new Error('measure-fcp: the DevTools socket refused the connection')), { once: true });
    });
  }

  /** @param {string} method @param {object} [params] @param {string} [sessionId] */
  send(method, params = {}, sessionId) {
    const id = this.next++;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    this.ws.send(JSON.stringify(payload));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }

  /** @param {(m:any)=>void} fn @returns {()=>void} */
  on(fn) { this.listeners.push(fn); return () => { this.listeners = this.listeners.filter((x) => x !== fn); }; }

  close() { try { this.ws.close(); } catch { /* already gone */ } }
}

/** @param {string} url @param {number} attempts */
export async function waitForDevTools(url, attempts = 120) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const res = await fetch(url);
      if (res.ok) return await res.json();
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('measure-fcp: Edge did not open its DevTools endpoint at ' + url);
}

/**
 * Launch headless Edge, hand a connected CDP client to `fn`, and clean up whatever happens.
 * @template T
 * @param {(browser:Cdp) => Promise<T>} fn
 * @returns {Promise<T>}
 */
export async function withBrowser(fn) {
  const edge = await findEdge();
  const profile = await mkdtemp(path.join(tmpdir(), 'solebidder-cdp-'));
  const port = 9400 + (process.pid % 400);
  const child = spawn(edge, [
    '--headless=new',
    '--window-size=1280,900',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--remote-debugging-port=' + port,
    '--user-data-dir=' + profile,
    'about:blank',
  ], { stdio: 'ignore' });

  /** @type {Cdp|null} */
  let browser = null;
  try {
    const version = await waitForDevTools('http://127.0.0.1:' + port + '/json/version');
    browser = new Cdp(version.webSocketDebuggerUrl);
    await browser.ready();
    return await fn(browser);
  } finally {
    if (browser) browser.close();
    child.kill();
    await rm(profile, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * One cold load, reporting the document's own timings in milliseconds from its time origin.
 *
 * @param {Cdp} browser
 * @param {string} url
 * @param {boolean} [throttled]
 * @returns {Promise<object>}
 */
export async function oneColdLoad(browser, url, throttled = true) {
  // A fresh browser context per run is what makes the cache cold: a new context shares no HTTP
  // cache, no memory cache and no compiled script cache with the run before it.
  const { browserContextId } = await browser.send('Target.createBrowserContext', { disposeOnDetach: true });
  const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank', browserContextId });
  const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true });

  try {
    await browser.send('Page.enable', {}, sessionId);
    await browser.send('Network.enable', {}, sessionId);
    await browser.send('Network.setCacheDisabled', { cacheDisabled: true }, sessionId);
    // The unthrottled pass exists only as a reference line beside the throttled one. It is what
    // this machine can do with no network in the way, and it is NOT the gate: DESIGN 6.2 states
    // the budget over a throttled profile, so that is the number that decides.
    await browser.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: throttled ? FAST_3G.latencyMs : 0,
      downloadThroughput: throttled ? FAST_3G.downloadBytesPerSecond : -1,
      uploadThroughput: throttled ? FAST_3G.uploadBytesPerSecond : -1,
    }, sessionId);
    await browser.send('Page.setLifecycleEventsEnabled', { enabled: true }, sessionId);

    // WAIT FOR THE PAGE TO FINISH, THEN ASK THE PAGE. The number is read from the document's own
    // PerformancePaintTiming entry rather than from a protocol event, because that entry IS the
    // specified definition of first contentful paint: milliseconds from the navigation's time
    // origin to the first paint that put text or an image on the screen. A timestamp subtraction
    // on this side of the socket measures something adjacent to it and not it.
    //
    // THE WAIT IS SCOPED TO THIS NAVIGATION'S OWN LOADER. Turning lifecycle events on replays
    // them for the about:blank document the tab already holds, so an unscoped wait for
    // "networkIdle" resolves instantly on the blank page, the read runs before the real page has
    // painted, and the measurement reports no paint at all.
    /** @type {{name:string, loaderId:string}[]} */
    const seen = [];
    let onLifecycle = (p) => { seen.push(p); };
    const off = browser.on((msg) => {
      if (msg.sessionId !== sessionId || msg.method !== 'Page.lifecycleEvent') return;
      onLifecycle(msg.params);
    });

    try {
      const nav = await browser.send('Page.navigate', { url }, sessionId);
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('measure-fcp: the page did not settle within 120 s')), 120000);
        const settled = (p) => {
          if (p.loaderId !== nav.loaderId || p.name !== 'networkIdle') return;
          clearTimeout(timer);
          resolve();
        };
        for (const p of seen) settled(p);
        onLifecycle = settled;
      });
    } finally {
      off();
    }

    const read = await browser.send('Runtime.evaluate', {
      expression: `(() => {
        const paint = performance.getEntriesByType('paint');
        const fcp = paint.find((e) => e.name === 'first-contentful-paint');
        const fp = paint.find((e) => e.name === 'first-paint');
        const nav = performance.getEntriesByType('navigation')[0];
        const res = performance.getEntriesByType('resource');
        const main = document.querySelector('main');
        return JSON.stringify({
          fcpMs: fcp ? fcp.startTime : null,
          firstPaintMs: fp ? fp.startTime : null,
          responseStartMs: nav ? nav.responseStart : null,
          responseEndMs: nav ? nav.responseEnd : null,
          domInteractiveMs: nav ? nav.domInteractive : null,
          domContentLoadedMs: nav ? nav.domContentLoadedEventEnd : null,
          transferSize: nav ? nav.transferSize : null,
          encodedBodySize: nav ? nav.encodedBodySize : null,
          decodedBodySize: nav ? nav.decodedBodySize : null,
          subresourceCount: res.length,
          subresourceBytes: res.reduce((a, r) => a + (r.transferSize || 0), 0),
          mainTextLength: main ? main.textContent.trim().length : 0,
          bodyTextLength: document.body ? document.body.textContent.trim().length : 0,
        });
      })()`,
      returnByValue: true,
    }, sessionId);

    const sample = JSON.parse(read.result.value);
    if (sample.fcpMs === null) throw new Error('measure-fcp: the page reported no contentful paint at all');
    return sample;
  } finally {
    await browser.send('Target.closeTarget', { targetId }).catch(() => {});
    await browser.send('Target.disposeBrowserContext', { browserContextId }).catch(() => {});
  }
}

/** @param {number[]} xs @returns {number} */
function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 === 1 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
}

/**
 * Measure a served page. Pass a browser and an origin to reuse an open rig; pass neither and one
 * is opened and closed around the measurement.
 *
 * @param {Object} [options]
 * @param {number} [options.runs]
 * @param {boolean} [options.throttled]
 * @param {string} [options.html] Override the page, for a positive control.
 * @param {Cdp} [options.browser]
 * @param {string} [options.origin]
 * @param {string} [options.label]
 * @returns {Promise<object>}
 */
export async function measureFcp(options = {}) {
  const runs = options.runs === undefined ? 5 : options.runs;
  const throttled = options.throttled === undefined ? true : options.throttled;

  const run = async (browser, origin, misses, pageBytes, treeBytes, speculative = []) => {
    const loads = [];
    for (let i = 0; i < runs; i += 1) loads.push(await oneColdLoad(browser, origin, throttled));
    const samples = loads.map((l) => l.fcpMs);
    const sorted = [...samples].sort((a, b) => a - b);
    return {
      label: options.label === undefined ? 'index.html' : options.label,
      throttled,
      runs,
      samples,
      medianMs: median(samples),
      minMs: sorted[0],
      maxMs: sorted[sorted.length - 1],
      medianResponseStartMs: median(loads.map((l) => l.responseStartMs)),
      medianResponseEndMs: median(loads.map((l) => l.responseEndMs)),
      medianDomInteractiveMs: median(loads.map((l) => l.domInteractiveMs)),
      medianDomContentLoadedMs: median(loads.map((l) => l.domContentLoadedMs)),
      medianSubresourceCount: median(loads.map((l) => l.subresourceCount)),
      pageBytesGzipped: pageBytes,
      treeBytesGzipped: treeBytes,
      observedTransferSize: loads[0].transferSize,
      observedDecodedSize: loads[0].decodedBodySize,
      mainTextLength: loads[0].mainTextLength,
      bodyTextLength: loads[0].bodyTextLength,
      routeMisses: [...new Set(misses)],
      speculativeMisses: [...new Set(speculative)],
      budgetMs: FCP_BUDGET_MS,
      withinBudget: median(samples) <= FCP_BUDGET_MS,
    };
  };

  if (options.browser && options.origin) {
    return run(options.browser, options.origin, options.misses === undefined ? [] : options.misses,
      options.pageBytes === undefined ? 0 : options.pageBytes,
      options.treeBytes === undefined ? 0 : options.treeBytes,
      options.speculative === undefined ? [] : options.speculative);
  }

  const built = await buildRoutes({ html: options.html });
  const server = await serveGzipped(built.routes);
  try {
    return await withBrowser((browser) => run(browser, server.origin, server.misses,
      built.pageBytes, built.treeBytes, server.speculative));
  } finally {
    await server.close();
  }
}

/**
 * THE POSITIVE CONTROL PAGE. The real page with an incompressible block welded into it.
 *
 * WHY RANDOM BYTES. The control has to be genuinely slow on the wire, not slow because a
 * threshold was moved. gzip at level 9 shrinks repeated text to nothing, so a padding of spaces
 * would transfer in no time and the control would pass, which would prove exactly nothing. Random
 * base64 does not compress, so the padding costs its own size on a throttled link and the budget
 * is exceeded by physics.
 *
 * The block is an HTML comment, so it changes no pixel and no layout. The only thing it changes
 * is the number of bytes that have to arrive before the first paint, which is the one input the
 * budget is about.
 *
 * @param {string} html
 * @param {number} bytes
 * @returns {string}
 */
export function padPage(html, bytes) {
  const blob = randomBytes(Math.ceil(bytes * 3 / 4)).toString('base64');
  const at = html.indexOf('</head>');
  const comment = '\n<!-- measure-fcp positive control padding, incompressible, ' + blob.length
    + ' bytes: ' + blob + ' -->\n';
  if (at === -1) return html + comment;
  return html.slice(0, at) + comment + html.slice(at);
}

/** How much incompressible padding the control carries. See the note on padPage. */
export const CONTROL_PAD_BYTES = 400000;

async function run() {
  const argv = process.argv;
  const runsAt = argv.indexOf('--runs');
  const runs = runsAt > -1 ? Number(argv[runsAt + 1]) : 5;
  const throttled = !argv.includes('--unthrottled');
  const result = await measureFcp({ runs, throttled });

  if (argv.includes('--json')) {
    console.log(JSON.stringify(result, null, 2));
    return result.withinBudget ? 0 : 1;
  }

  report(result);
  return result.withinBudget ? 0 : 1;
}

/** @param {object} result */
export function report(result) {
  say.head('first contentful paint: ' + result.label);
  say.note('cold cache, fresh browser context per run, headless Edge, ' + result.runs + ' runs');
  say.note(result.throttled
    ? 'throttle: Fast 3G, ' + FAST_3G.latencyMs + ' ms added latency, '
      + Math.round(FAST_3G.downloadBytesPerSecond) + ' B/s down'
    : 'NO THROTTLE, a reference line only. DESIGN 6.2 states the gate over a throttled profile.');
  say.note('served gzipped, ' + result.pageBytesGzipped + ' B of page on the wire, the browser '
    + 'reported ' + result.observedTransferSize + ' B transferred and '
    + result.observedDecodedSize + ' B decoded');
  say.note('the module graph and the bundled index are served from the same origin, '
    + result.treeBytesGzipped + ' B gzipped in total, fetched AFTER the paint: '
    + result.medianSubresourceCount + ' subresources at the median run');
  say.note('samples, ms: ' + result.samples.map((s) => s.toFixed(1)).join('  '));
  say.note('median response start ' + result.medianResponseStartMs.toFixed(0)
    + ' ms, response end ' + result.medianResponseEndMs.toFixed(0)
    + ' ms, DOM interactive ' + result.medianDomInteractiveMs.toFixed(0)
    + ' ms, DOMContentLoaded ' + result.medianDomContentLoadedMs.toFixed(0) + ' ms');
  say.note('main held ' + result.mainTextLength + ' characters of text after load, the document '
    + result.bodyTextLength);
  if (result.speculativeMisses.length > 0) {
    say.note('the browser also asked for ' + result.speculativeMisses.join(', ') + ' on its own. '
      + 'Nothing on the page references it and the published site 404s it too, so it is answered '
      + 'with a 404 here rather than being counted against the measurement.');
  }
  if (result.routeMisses.length > 0) {
    say.fail('the page asked for ' + result.routeMisses.length + ' path(s) this rig does not '
      + 'serve, so the run measured a page in an error state: ' + result.routeMisses.join(', '));
  }
  const m = result.medianMs;
  if (result.withinBudget) {
    say.pass('first contentful paint ' + m.toFixed(0) + ' ms, median of ' + result.samples.length
      + ', against the ' + FCP_BUDGET_MS + ' ms budget of DESIGN 6.2');
  } else {
    say.fail('first contentful paint ' + m.toFixed(0) + ' ms, median of ' + result.samples.length
      + ', OVER the ' + FCP_BUDGET_MS + ' ms budget of DESIGN 6.2. On a single request page the '
      + 'floor is the round trip plus the transfer: ' + FAST_3G.latencyMs + ' ms plus '
      + (result.pageBytesGzipped / FAST_3G.downloadBytesPerSecond * 1000).toFixed(0) + ' ms for '
      + result.pageBytesGzipped + ' B. This number comes down when the page does.');
  }
}

if (isMain(import.meta.url)) {
  const failures = await run();
  console.log(failures === 0 ? '\nfcp: PASS' : '\nfcp: FAIL');
  process.exit(failures);
}

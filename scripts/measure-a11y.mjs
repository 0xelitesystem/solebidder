#!/usr/bin/env node
// FORCED COLORS AND 200 PERCENT ZOOM, MEASURED IN A REAL BROWSER.
//
//   node scripts/measure-a11y.mjs                 run every scenario and print
//   node scripts/measure-a11y.mjs --json          machine readable
//   node scripts/measure-a11y.mjs --shots <dir>   also write a screenshot per scenario
//
// WHAT WAS UNMEASURED AND WHY IT MATTERED. DESIGN 6.8 ends with one line: "Legible at 200 percent
// zoom and in forced-colors mode. No meaning carried by fill alone." Two gates already touch the
// edges of that sentence. gate-contrast proves BY MATH that the two money ramps carry different
// patterns and different forced-colors system colours, which is a statement about the token file.
// The build proves the page paints the palette the gate computed. Neither one has ever opened a
// browser, so neither one can tell you whether the pattern SURVIVES: a computed fill of
// url(#hatch45) says a pattern was referenced, not that anything was painted, and forced-colors
// mode in Chromium rewrites fill and stroke on elements the author never expected it to touch.
//
// THE CLAIM THIS EXISTS TO TEST. DESIGN 2.5 makes the obligations against award-lifetime-value
// separation a structural constraint rather than a disclaimer, and names the hatch as the half
// of it that survives when every author colour is discarded. If the hatch disappears in
// forced-colors mode then the separation is colour only in exactly the mode where colour is not
// the author's to give, and that would have to be reported rather than assumed away.
//
// FOUR SCENARIOS, all in headless Edge, never Chrome and never Brave:
//
//   baseline            1280 wide, the page as a reader with no preferences gets it
//   forced-colors       Emulation.setEmulatedMedia forced-colors: active
//   zoom200             1280 physical wide at 200 percent, which is a 640 CSS pixel layout
//                       viewport at a device pixel ratio of 2. That is what browser zoom
//                       actually does: it does not shrink the page, it shrinks the viewport the
//                       page is laid out into.
//   both                forced colours at 200 percent, because a reader who needs one often
//                       needs the other and nothing had checked the combination
//
// The page is the SHIPPED page with one substitution, described in scripts/probe-page.mjs: the
// entry module is swapped for one that boots the same code against synthetic data, so the charts
// and tables actually exist to be measured and nothing touches the network.

import { writeFile, readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { buildRoutes, serveGzipped, withBrowser } from './measure-fcp.mjs';
import { probePage, probeModule } from './probe-page.mjs';
import { decodePng, cropRaster, colourHistogram, distinctColoursCovering } from './png.mjs';
import { gzipSync } from 'node:zlib';
import { REPO, say, isMain } from './_shipped.mjs';

/** WCAG 1.4.10 is stated at 400 percent; the design states 200, and 200 is what is measured. */
export const ZOOM_CSS_WIDTH = 640;
export const ZOOM_DEVICE_WIDTH = 1280;

/**
 * "rgb(45, 107, 0)" to the "45,107,0" key a histogram is built on. Anything else returns null,
 * which makes the validity check below fail loudly rather than quietly comparing to nothing.
 * @param {string|null} colour
 * @returns {string|null}
 */
export function rgbKey(colour) {
  if (typeof colour !== 'string') return null;
  const m = colour.match(/^rgba?\(\s*([0-9]+)[,\s]+([0-9]+)[,\s]+([0-9]+)/);
  return m === null ? null : m[1] + ',' + m[2] + ',' + m[3];
}

/**
 * The page reading, as one expression evaluated inside the document. Everything it returns is
 * read from the live layout rather than inferred from the source.
 */
const READ_PAGE = `(() => {
  const css = (el, prop) => getComputedStyle(el).getPropertyValue(prop).trim();

  const name = (el) => {
    if (!el) return null;
    const id = el.id ? '#' + el.id : '';
    const cls = typeof el.className === 'string' && el.className
      ? '.' + el.className.trim().split(/\\s+/).join('.')
      : (el.className && el.className.baseVal ? '.' + el.className.baseVal.trim().split(/\\s+/).join('.') : '');
    return el.tagName.toLowerCase() + id + cls;
  };

  const scrollableAncestor = (el) => {
    let n = el.parentElement;
    while (n && n !== document.documentElement) {
      const ox = css(n, 'overflow-x');
      if (ox === 'auto' || ox === 'scroll') return name(n);
      n = n.parentElement;
    }
    return null;
  };

  const layoutWidth = document.documentElement.clientWidth;

  // A. WHAT OVERFLOWS THE VIEWPORT SIDEWAYS, and whether anything is there to catch it. An
  // element wider than the viewport inside an overflow-x container is a table that scrolls,
  // which is the designed behaviour. The same element with nothing to catch it is a reader
  // scrolling the whole document sideways to read one row, which is the failure WCAG 1.4.10 is
  // about.
  const overflowing = [];
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    if (r.right <= layoutWidth + 1) continue;
    overflowing.push({
      selector: name(el),
      right: Math.round(r.right),
      width: Math.round(r.width),
      caughtBy: scrollableAncestor(el),
      text: (el.textContent || '').trim().slice(0, 60),
    });
  }

  // B. WHAT IS CLIPPED. An element that hides its own overflow while its content is bigger than
  // its box is text a reader cannot reach at all, which is worse than a scrollbar.
  const clipped = [];
  for (const el of document.querySelectorAll('body *')) {
    const ox = css(el, 'overflow-x');
    const oy = css(el, 'overflow-y');
    if (ox !== 'hidden' && ox !== 'clip' && oy !== 'hidden' && oy !== 'clip') continue;
    if (el.classList.contains('visually-hidden') || el.classList.contains('sr-only')) continue;
    const wide = el.scrollWidth > el.clientWidth + 1 && (ox === 'hidden' || ox === 'clip');
    const tall = el.scrollHeight > el.clientHeight + 1 && (oy === 'hidden' || oy === 'clip');
    if (!wide && !tall) continue;
    if (el.clientWidth === 0 && el.clientHeight === 0) continue;
    clipped.push({
      selector: name(el),
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
      text: (el.textContent || '').trim().slice(0, 60),
    });
  }

  // C. THE TWO MONEY RAMPS, as the browser actually resolved them, plus the boxes a screenshot
  // has to clip to in order to count what was painted.
  const rampRead = (selector) => {
    const el = document.querySelector(selector);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const overlay = el.nextElementSibling && el.nextElementSibling.classList.contains('mark-pattern')
      ? el.nextElementSibling
      : null;
    return {
      selector,
      fill: css(el, 'fill'),
      overlayPresent: overlay !== null,
      overlayFill: overlay ? css(overlay, 'fill') : null,
      box: { x: r.x, y: r.y, width: r.width, height: r.height },
    };
  };

  const hatchLine = document.querySelector('.hatch-line');
  const anyPanel = document.querySelector('.panel');

  // D. THE RESIDUAL, read out of the DOM by its own text rather than from the model that made it.
  const rollup = document.getElementById('panel-rollup');
  const residualNodes = rollup
    ? [...rollup.querySelectorAll('*')]
      .map((n) => (n.textContent || '').replace(/\\s+/g, ' ').trim())
      // The label sits in its own element and the value in a sibling, so the shortest match is
      // the label alone and proves nothing. The smallest node that carries BOTH the label and a
      // digit is the rendered figure, which is the thing being asked about.
      .filter((t) => /less the parent profile total/i.test(t) && /[0-9]/.test(t))
      .sort((a, b) => a.length - b.length)
    : [];
  const residual = residualNodes.length > 0 ? residualNodes[0] : null;

  return JSON.stringify({
    probeReady: window.__probeReady === true,
    forcedColorsActive: matchMedia('(forced-colors: active)').matches,
    prefersContrast: matchMedia('(prefers-contrast: more)').matches,
    layoutWidth,
    innerWidth: window.innerWidth,
    devicePixelRatio: window.devicePixelRatio,
    documentScrollWidth: document.documentElement.scrollWidth,
    horizontalOverflowPx: document.documentElement.scrollWidth - layoutWidth,
    bodyBackground: css(document.body, 'background-color'),
    bodyColour: css(document.body, 'color'),
    panelBorderColour: anyPanel ? css(anyPanel, 'border-top-color') : null,
    hatchLineStroke: hatchLine ? getComputedStyle(hatchLine).stroke : null,
    hatchLinePresent: hatchLine !== null,
    patternOverlayCount: document.querySelectorAll('.mark-pattern').length,
    markCount: document.querySelectorAll('.mark').length,
    ramps: {
      obligations: rampRead('.mark.ramp-obligations'),
      awardValue: rampRead('.mark.ramp-award-value'),
      share: rampRead('.mark.ramp-share'),
    },
    figureCount: document.querySelectorAll('[data-claim-badge]').length,
    tableCount: document.querySelectorAll('table').length,
    chartCount: document.querySelectorAll('svg[role="img"]').length,
    overflowing,
    clipped,
    residualLine: residual === undefined ? null : residual,
  });
})()`;

/**
 * Open the probe page in a fresh browser context under one set of emulation, read it, and
 * screenshot whatever boxes the caller asks for.
 *
 * @param {import('./measure-fcp.mjs').Cdp} browser
 * @param {string} origin
 * @param {{id:string, forcedColors:boolean, zoom:boolean}} scenario
 * @returns {Promise<{scenario:object, page:object, shots:Record<string,object>, fullPng:Buffer}>}
 */
export async function runScenario(browser, origin, scenario) {
  const { browserContextId } = await browser.send('Target.createBrowserContext', { disposeOnDetach: true });
  const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank', browserContextId });
  const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true });

  try {
    await browser.send('Page.enable', {}, sessionId);
    await browser.send('Network.enable', {}, sessionId);
    await browser.send('Network.setCacheDisabled', { cacheDisabled: true }, sessionId);

    if (scenario.zoom) {
      // 200 percent browser zoom on a 1280 device pixel wide window IS a 640 CSS pixel layout
      // viewport at a device pixel ratio of 2. Emulating it this way is what the reader gets;
      // scaling the rendered page instead would test a photograph of the page rather than the
      // page, and would never reveal a reflow failure at all.
      await browser.send('Emulation.setDeviceMetricsOverride', {
        width: ZOOM_CSS_WIDTH,
        height: 900,
        deviceScaleFactor: 2,
        mobile: false,
      }, sessionId);
    }
    if (scenario.forcedColors) {
      await browser.send('Emulation.setEmulatedMedia', {
        features: [
          { name: 'forced-colors', value: 'active' },
          { name: 'prefers-contrast', value: 'more' },
        ],
      }, sessionId);
    }

    await browser.send('Page.navigate', { url: origin }, sessionId);

    // The probe sets a flag when every panel has painted. Polling for that flag rather than for
    // a lifecycle event is what makes the reading below about the finished page: networkIdle
    // fires while the render layer is still mounting panels.
    let ready = false;
    for (let i = 0; i < 200; i += 1) {
      const r = await browser.send('Runtime.evaluate', {
        expression: 'window.__probeReady === true', returnByValue: true,
      }, sessionId);
      if (r.result && r.result.value === true) { ready = true; break; }
      await new Promise((res) => setTimeout(res, 100));
    }
    if (!ready) {
      const err = await browser.send('Runtime.evaluate', {
        expression: 'document.body ? document.body.textContent.slice(0, 200) : "no body"',
        returnByValue: true,
      }, sessionId);
      throw new Error('measure-a11y: the probe page never finished booting in scenario "'
        + scenario.id + '". The page said: ' + String(err.result.value));
    }

    const read = await browser.send('Runtime.evaluate', {
      expression: READ_PAGE, returnByValue: true,
    }, sessionId);
    const page = JSON.parse(read.result.value);

    /** @type {Record<string, object>} */
    const shots = {};
    for (const [key, ramp] of Object.entries(page.ramps)) {
      if (!ramp || ramp.box.width < 2 || ramp.box.height < 2) continue;

      // BRING THE MARK INTO VIEW, THEN PHOTOGRAPH THE WHOLE VIEWPORT AND CUT THE MARK OUT OF IT.
      //
      // At 200 percent the charts do not reflow, they scroll sideways inside their own
      // .chart-plot container, so a mark can sit outside the scrolled region of that container
      // while its bounding rectangle still reports a healthy size. scrollIntoView moves every
      // scroll container on the way up and puts it on screen.
      //
      // The cut is made here rather than by Page.captureScreenshot's clip because that clip is
      // in page coordinates, and page coordinates stop agreeing with an element rectangle the
      // moment anything has scrolled. An off by a scroll offset clip photographs the background
      // and then reports a confident histogram of it, which reads as a pass. The viewport is the
      // one frame both the rectangle and the screenshot are already in.
      const located = await browser.send('Runtime.evaluate', {
        expression: `(() => {
          const el = document.querySelector(${JSON.stringify(ramp.selector)});
          if (!el) return 'null';
          el.scrollIntoView({ block: 'center', inline: 'center' });
          const r = el.getBoundingClientRect();
          return JSON.stringify({
            x: r.x, y: r.y, width: r.width, height: r.height,
            innerWidth: window.innerWidth, innerHeight: window.innerHeight,
            onScreen: r.right > 0 && r.bottom > 0 && r.left < window.innerWidth && r.top < window.innerHeight,
          });
        })()`,
        returnByValue: true,
      }, sessionId);
      const box = JSON.parse(located.result.value);
      if (box === null || box.width < 2 || box.height < 2) continue;
      ramp.viewportBox = box;

      const shot = await browser.send('Page.captureScreenshot', {
        format: 'png', captureBeyondViewport: false,
      }, sessionId);
      const full = decodePng(Buffer.from(shot.data, 'base64'));
      const scale = full.width / box.innerWidth;
      const raster = cropRaster(full, {
        x: (box.x + 1) * scale,
        y: (box.y + 1) * scale,
        width: Math.max(2, (box.width - 2) * scale),
        height: Math.max(2, (box.height - 2) * scale),
      });
      const histogram = colourHistogram(raster);
      shots[key] = {
        onScreen: box.onScreen,
        rasterScale: scale,
        pixels: raster.width * raster.height,
        distinctColours: histogram.length,
        coveringColours: distinctColoursCovering(histogram),
        // THE VALIDITY CHECK. The fill the browser says this mark has must actually be the
        // commonest colour inside it. Without this, a crop that landed on the page background
        // produces a tidy one colour histogram and every check downstream passes while nothing
        // was measured at all.
        expectedFill: rgbKey(ramp.fill),
        samplesTheMark: rgbKey(ramp.fill) !== null && histogram.length > 0
          && histogram[0].colour === rgbKey(ramp.fill),
        top: histogram.slice(0, 4),
      };
    }

    const full = await browser.send('Page.captureScreenshot', {
      format: 'png', captureBeyondViewport: false,
    }, sessionId);

    return { scenario, page, shots, fullPng: Buffer.from(full.data, 'base64') };
  } finally {
    await browser.send('Target.closeTarget', { targetId }).catch(() => {});
    await browser.send('Target.disposeBrowserContext', { browserContextId }).catch(() => {});
  }
}

export const SCENARIOS = Object.freeze([
  Object.freeze({ id: 'baseline', forcedColors: false, zoom: false, what: '1280 wide, no emulation' }),
  Object.freeze({ id: 'forced-colors', forcedColors: true, zoom: false, what: 'forced-colors: active' }),
  Object.freeze({ id: 'zoom200', forcedColors: false, zoom: true, what: '200 percent zoom, 640 CSS px layout viewport' }),
  Object.freeze({ id: 'both', forcedColors: true, zoom: true, what: 'forced colours at 200 percent' }),
]);

/**
 * @param {{shots?:string}} [options]
 * @returns {Promise<{results:object[], findings:object[]}>}
 */
export async function measureA11y(options = {}) {
  const html = await readFile(path.join(REPO, 'index.html'), 'utf8');
  const probeJs = gzipSync(Buffer.from(probeModule(), 'utf8'), { level: 9 });
  const built = await buildRoutes({
    html: probePage(html),
    extra: { '/probe.js': { body: probeJs, type: 'text/javascript; charset=utf-8' } },
  });
  const server = await serveGzipped(built.routes);

  try {
    return await withBrowser(async (browser) => {
      /** @type {object[]} */
      const results = [];
      for (const scenario of SCENARIOS) {
        const r = await runScenario(browser, server.origin, scenario);
        if (options.shots) {
          await mkdir(options.shots, { recursive: true });
          const file = path.join(options.shots, 'solebidder-' + scenario.id + '.png');
          await writeFile(file, r.fullPng);
          r.shotFile = file;
        }
        delete r.fullPng;
        results.push(r);
      }
      return { results, findings: judge(results, server.misses) };
    });
  } finally {
    await server.close();
  }
}

/**
 * Turn the readings into verdicts. Everything here is a statement about a number that was
 * measured above, so a reader can check it.
 *
 * @param {object[]} results
 * @param {string[]} misses
 * @returns {{id:string, ok:boolean, detail:string}[]}
 */
export function judge(results, misses = []) {
  /** @type {{id:string, ok:boolean, detail:string}[]} */
  const out = [];
  const by = (id) => results.find((r) => r.scenario.id === id);

  if (misses.length > 0) {
    out.push({
      id: 'rig-complete',
      ok: false,
      detail: 'the probe asked for ' + misses.length + ' path(s) the rig does not serve, so these '
        + 'readings describe a page in an error state: ' + [...new Set(misses)].join(', '),
    });
  }

  for (const r of results) {
    const p = r.page;

    // Did the emulation actually take. A scenario that silently did not apply would produce a
    // clean report about nothing, which is the worst possible outcome here.
    if (r.scenario.forcedColors) {
      out.push({
        id: r.scenario.id + '/emulation-applied',
        ok: p.forcedColorsActive === true,
        detail: 'matchMedia("(forced-colors: active)") reported ' + p.forcedColorsActive
          + ' inside the page',
      });
    }
    if (r.scenario.zoom) {
      out.push({
        id: r.scenario.id + '/emulation-applied',
        // innerWidth is the emulated viewport; clientWidth is that minus the classic scrollbar,
        // which is a real part of the reader's page and not a discrepancy to be explained away.
        ok: p.innerWidth === ZOOM_CSS_WIDTH && p.devicePixelRatio === 2,
        detail: 'viewport ' + p.innerWidth + ' CSS px wide at a device pixel ratio of '
          + p.devicePixelRatio + ', which is ' + ZOOM_DEVICE_WIDTH + ' device px at 200 percent; '
          + p.layoutWidth + ' px of that is layout width, the rest is the scrollbar',
      });
    }

    // Did the page actually render the things under test.
    out.push({
      id: r.scenario.id + '/page-populated',
      ok: p.chartCount >= 4 && p.tableCount >= 2 && p.figureCount > 0,
      detail: p.chartCount + ' charts, ' + p.tableCount + ' tables, ' + p.figureCount
        + ' badged figures, ' + p.markCount + ' chart marks, ' + p.patternOverlayCount
        + ' pattern overlays',
    });

    // THE SEPARATION. Two independent carriers, checked independently.
    const ob = p.ramps.obligations;
    const av = p.ramps.awardValue;
    if (ob && av) {
      out.push({
        id: r.scenario.id + '/ramps-differ-by-colour',
        ok: ob.fill !== av.fill,
        detail: 'obligations fill ' + ob.fill + ' against award value fill ' + av.fill,
      });
      const obShot = r.shots.obligations;
      const avShot = r.shots.awardValue;
      if (obShot && avShot) {
        // THE SAMPLE HAS TO BE OF THE MARK BEFORE ANYTHING IT SAYS COUNTS.
        const valid = obShot.samplesTheMark && avShot.samplesTheMark;
        out.push({
          id: r.scenario.id + '/pixel-sample-is-valid',
          ok: valid,
          detail: valid
            ? 'both crops are dominated by the fill the browser resolved for the mark: '
              + obShot.expectedFill + ' and ' + avShot.expectedFill
            : 'a crop is NOT dominated by the fill the browser resolved for its mark, so the '
              + 'pixel readings below describe something other than the mark. obligations '
              + 'expected ' + obShot.expectedFill + ' and got ' + obShot.top[0].colour + ' at '
              + (obShot.top[0].share * 100).toFixed(1) + ' percent, on screen ' + obShot.onScreen
              + '; award value expected ' + avShot.expectedFill + ' and got '
              + avShot.top[0].colour + ' at ' + (avShot.top[0].share * 100).toFixed(1)
              + ' percent, on screen ' + avShot.onScreen,
        });
        out.push({
          id: r.scenario.id + '/ramps-differ-in-pixels',
          ok: valid && obShot.top[0].colour !== avShot.top[0].colour,
          detail: 'the commonest painted colour inside the obligations mark is '
            + obShot.top[0].colour + ' and inside the award value mark it is ' + avShot.top[0].colour,
        });
        out.push({
          id: r.scenario.id + '/hatch-survives',
          ok: valid && avShot.coveringColours >= 2,
          detail: 'the award value mark needed ' + avShot.coveringColours + ' colour(s) to cover '
            + '95 percent of its pixels and carried ' + avShot.distinctColours + ' distinct '
            + 'colours in total; the obligations mark needed ' + obShot.coveringColours
            + '. Two or more on the hatched mark is the hatch actually being painted.',
        });
      }
    } else {
      out.push({
        id: r.scenario.id + '/ramps-present',
        ok: false,
        detail: 'one of the two money ramps did not render at all, so the separation could not be '
          + 'measured: obligations ' + (ob ? 'present' : 'MISSING') + ', award value '
          + (av ? 'present' : 'MISSING'),
      });
    }

    // REFLOW. Sideways scrolling of the whole document is the 1.4.10 failure; a table that
    // scrolls inside its own container is the designed behaviour and is not counted against it.
    const uncaught = p.overflowing.filter((o) => o.caughtBy === null);
    out.push({
      id: r.scenario.id + '/no-document-side-scroll',
      ok: p.horizontalOverflowPx <= 1,
      detail: 'document scrollWidth ' + p.documentScrollWidth + ' against a layout viewport of '
        + p.layoutWidth + ', an overflow of ' + p.horizontalOverflowPx + ' px',
    });
    out.push({
      id: r.scenario.id + '/overflow-is-contained',
      ok: uncaught.length === 0,
      detail: uncaught.length === 0
        ? p.overflowing.length + ' element(s) run wider than the viewport and every one of them '
          + 'sits inside a scroll container'
        : uncaught.length + ' element(s) run past the viewport with nothing to catch them: '
          + uncaught.slice(0, 5).map((o) => o.selector + ' to ' + o.right + 'px').join(', '),
    });
    out.push({
      id: r.scenario.id + '/nothing-clipped',
      ok: p.clipped.length === 0,
      detail: p.clipped.length === 0
        ? 'no element hides content its own box is too small for'
        : p.clipped.length + ' element(s) clip their own content: '
          + p.clipped.slice(0, 5).map((c) => c.selector + ' ' + c.scrollWidth + '/' + c.clientWidth).join(', '),
    });

    // THE RESIDUAL, in the DOM, in this rendering mode.
    out.push({
      id: r.scenario.id + '/residual-displayed',
      ok: typeof p.residualLine === 'string' && /0\.01/.test(p.residualLine),
      detail: p.residualLine === null
        ? 'the reconciliation residual line is absent from the rollup panel'
        : 'the rollup panel reads: ' + p.residualLine.replace(/\s+/g, ' ').slice(0, 160),
    });
  }

  void by;
  return out;
}

/* -----------------------------------------------------------------------------------------
 * THE POSITIVE CONTROL FOR THE JUDGE.
 *
 * Every reading above is only as good as the function that turns it into a verdict, and the
 * failure this probe nearly shipped with is the one this control is aimed at: a crop that landed
 * on the page background produced a tidy one colour histogram, and the verdict "the two ramps
 * paint different colours" came back green because the background happens to differ from one of
 * the fills. A check that passes hardest when it is measuring nothing is worse than no check.
 *
 * So the judge is fed three synthetic readings whose verdict is not a matter of opinion, and this
 * script fails if any of them is judged wrongly. It costs no browser and it runs every time.
 * --------------------------------------------------------------------------------------- */

/** @param {object} overrides @returns {object} */
function syntheticReading(overrides = {}) {
  const shot = (colour, covering, valid) => ({
    onScreen: true,
    rasterScale: 2,
    pixels: 10000,
    distinctColours: covering,
    coveringColours: covering,
    expectedFill: colour,
    samplesTheMark: valid,
    top: [{ colour, count: 10000, share: 1 }],
  });
  return {
    scenario: { id: 'synthetic', forcedColors: false, zoom: false, what: 'a control, not a page' },
    page: {
      forcedColorsActive: false,
      layoutWidth: 1280,
      innerWidth: 1280,
      devicePixelRatio: 1,
      documentScrollWidth: 1280,
      horizontalOverflowPx: 0,
      chartCount: 4,
      tableCount: 2,
      figureCount: 10,
      markCount: 10,
      patternOverlayCount: 2,
      overflowing: [],
      clipped: [],
      residualLine: 'Child rollup less the parent profile total $0.01 obligated',
      ramps: {
        obligations: { selector: '.a', fill: 'rgb(45, 107, 0)', box: { x: 0, y: 0, width: 10, height: 10 } },
        awardValue: { selector: '.b', fill: 'rgb(17, 24, 39)', box: { x: 0, y: 0, width: 10, height: 10 } },
        share: null,
      },
      ...overrides.page,
    },
    shots: {
      obligations: shot('45,107,0', 1, true),
      awardValue: shot('17,24,39', 40, true),
      ...overrides.shots,
    },
  };
}

const JUDGE_CONTROLS = [
  {
    what: 'a healthy reading is judged healthy',
    reading: syntheticReading(),
    expectFail: [],
  },
  {
    what: 'A CROP THAT LANDED ON THE BACKGROUND IS NOT A PASS, however tidy its histogram',
    reading: syntheticReading({
      shots: {
        obligations: {
          onScreen: false, rasterScale: 2, pixels: 10000, distinctColours: 1, coveringColours: 1,
          expectedFill: '45,107,0', samplesTheMark: false,
          top: [{ colour: '232,235,239', count: 10000, share: 1 }],
        },
      },
    }),
    // Every pixel verdict goes down with the sample, hatch included. A sample that is not of the
    // mark cannot say the hatch survived any more than it can say the colours differ.
    expectFail: ['pixel-sample-is-valid', 'ramps-differ-in-pixels', 'hatch-survives'],
  },
  {
    what: 'A HATCH THAT VANISHED IS REPORTED, not rounded up to a pass',
    reading: syntheticReading({
      shots: {
        awardValue: {
          onScreen: true, rasterScale: 2, pixels: 10000, distinctColours: 1, coveringColours: 1,
          expectedFill: '17,24,39', samplesTheMark: true,
          top: [{ colour: '17,24,39', count: 10000, share: 1 }],
        },
      },
    }),
    expectFail: ['hatch-survives'],
  },
  {
    what: 'AN ELEMENT RUNNING OFF THE VIEWPORT WITH NOTHING TO CATCH IT IS A FAILURE',
    reading: syntheticReading({
      page: {
        documentScrollWidth: 1900,
        horizontalOverflowPx: 620,
        overflowing: [{ selector: 'table', right: 1900, width: 1900, caughtBy: null, text: '' }],
      },
    }),
    expectFail: ['no-document-side-scroll', 'overflow-is-contained'],
  },
  {
    what: 'A MISSING RESIDUAL IS A FAILURE, because rounding it away is the thing being watched',
    reading: syntheticReading({ page: { residualLine: null } }),
    expectFail: ['residual-displayed'],
  },
];

/** @returns {number} failures */
export function selftestJudge() {
  say.head('measure-a11y: the judge, checked against readings whose verdict is known');
  let bad = 0;
  for (const c of JUDGE_CONTROLS) {
    const failed = judge([c.reading]).filter((f) => !f.ok).map((f) => f.id.split('/')[1]).sort();
    const want = [...c.expectFail].sort();
    const ok = failed.length === want.length && failed.every((x, i) => x === want[i]);
    const label = c.what + '   expected ' + (want.length === 0 ? 'no failures' : want.join(', '))
      + ', got ' + (failed.length === 0 ? 'none' : failed.join(', '));
    if (ok) say.pass(label);
    else { say.fail(label); bad += 1; }
  }
  return bad;
}

async function run() {
  const argv = process.argv;
  const shotsAt = argv.indexOf('--shots');
  const shots = shotsAt > -1 ? argv[shotsAt + 1] : undefined;
  const controlFailures = selftestJudge();
  if (argv.includes('--selftest')) return controlFailures;
  const { results, findings } = await measureA11y({ shots });

  if (argv.includes('--json')) {
    console.log(JSON.stringify({ results, findings }, null, 2));
    return findings.filter((f) => !f.ok).length + controlFailures;
  }

  for (const r of results) {
    say.head('scenario: ' + r.scenario.id + '  (' + r.scenario.what + ')');
    const p = r.page;
    say.note('layout viewport ' + p.layoutWidth + ' CSS px, device pixel ratio ' + p.devicePixelRatio
      + ', forced colours ' + p.forcedColorsActive);
    say.note('body paints ' + p.bodyColour + ' on ' + p.bodyBackground
      + ', panel border ' + p.panelBorderColour + ', hatch line stroke ' + p.hatchLineStroke);
    for (const [key, s] of Object.entries(r.shots)) {
      say.note('mark ' + key.padEnd(11) + ' ' + s.pixels + ' px sampled at scale '
        + s.rasterScale + ', on screen ' + s.onScreen + ', '
        + s.distinctColours + ' distinct colours, ' + s.coveringColours
        + ' cover 95 percent, commonest ' + s.top.map((t) => t.colour + ' at ' + (t.share * 100).toFixed(1) + '%').join('  '));
    }
    if (r.shotFile) say.note('screenshot ' + r.shotFile);
    for (const f of findings.filter((x) => x.id.startsWith(r.scenario.id + '/'))) {
      (f.ok ? say.pass : say.fail)(f.id.split('/')[1].padEnd(26) + f.detail);
    }
  }

  const bad = findings.filter((f) => !f.ok);
  say.head('summary');
  say.note(findings.length - bad.length + ' of ' + findings.length + ' checks passed across '
    + SCENARIOS.length + ' scenarios, and the judge passed its own ' + JUDGE_CONTROLS.length
    + ' controls');
  for (const f of bad) say.fail(f.id + '  ' + f.detail);
  return bad.length + controlFailures;
}

if (isMain(import.meta.url)) {
  const bad = await run();
  console.log(bad === 0 ? '\na11y: PASS' : '\na11y: FAIL (' + bad + ')');
  process.exit(bad === 0 ? 0 : 1);
}

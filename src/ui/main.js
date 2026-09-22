// The entry point. It does one thing: hand the real document to boot() once the shell exists.
//
// Everything below this file is pure with respect to the DOM: every module in src/ui takes the
// document as an argument, so the whole page can be built and driven under node --test with a
// small document stand in, no browser, no bundler and no dependency. This file is the only place
// that reaches for a global, and it is four lines long so that the untestable part of the render
// layer is four lines long.

import { boot } from './app.js';

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { boot(document); });
  } else {
    boot(document);
  }
}

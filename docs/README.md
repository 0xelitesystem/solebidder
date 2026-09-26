# solebidder, developer notes

Documentation only. The page this repository publishes is `index.html` at the repository ROOT.
Nothing in this directory is served as an entry point.

## Layout

    index.html          the page, at the ROOT
    src/core/           claims, units, the claim boundary statements, the palette, constants
    src/query/          the one API client, the request builders, the response validators
    src/contracts/      the three shapes the render layer is built against
    src/api/            the facade over the client, and the hero and second definition
                        assembly, which touches no document
    src/identity/       name to parent record resolution, and the refusal
    src/analysis/       the shares, the concentration measures, the rollup arithmetic
    src/ui/             the page: the controller, the panels, the charts
    src/cli/            the command line: the argument parser, the report sequence, the
                        renderer, the one output sink, and the fetch wrapper. It imports the
                        same modules the page does and nothing from src/ui but view-model.js
    src/data/           the bundled name index, names and identifiers only
    scripts/            the build, the five gates and the browser measurements. Never loaded
                        by the page and never packed for npm; GitHub Pages serves the
                        repository root, so these files can still be fetched at their paths.
    test/               node --test, no dependencies
    docs/               this

## Commands

    npm test               the whole suite on the Node test runner
    npm run gates          all five gates, positive controls first
    npm run gates:selftest only the positive controls
    npm run build          regenerate the palette, the claim boundary block and the footer
                           disclaimer in index.html
    npm run build:check    regenerate to memory and compare by sha256
    npm run verify         tests, gates and the build check together
    npm run verify:ci      the same without the paint gate, which needs a browser: the
                           tests, the four gates that read files, and the build check. This
                           is what prepublishOnly runs, so a release runner needs no browser

## What the npm package carries

The `files` list in package.json packs the command line and nothing else: `src/cli/` and every
module it imports, the bundled name index it reads for `suggest`, and the licence. npm adds
package.json and the README itself. The page, its controller, panels and charts, the scripts,
the tests and these notes are not in the package. `test/package.test.js` walks the import graph
from `src/cli/bin.js` and fails when the list packs a file the command does not load or leaves
out one it does.

## The five gates, and what each refuses

**gate-badges.** A digit in a rendered text node with no `data-claim-badge` on it or on an
ancestor. A number written straight into the DOM at runtime. Any use of the innerHTML family. And
any ESTIMATED claim at all: the budget in `scripts/badge-exception-budget.json` is zero.

**gate-units.** A currency symbol in a string literal outside `src/core/units.js`. A second
currency formatter. A number reaching the DOM without passing the unit renderer. A badged figure
in the page with no unit kind. A chart input assembled by hand instead of through
`makeChartInput`, which is where a chart with two unit kinds becomes impossible to construct.

**gate-vocabulary.** Two halves that pull against each other. All ten claim boundary statements
must be present in the page verbatim. None of the banned phrasings may appear anywhere else in
the shipped copy. The ten statements are masked out before the patterns run, so the page can say
what it does not measure and cannot state the opposite.

**gate-contrast.** Every declared text pairing in both themes at 4.5:1, computed by the WCAG
formula rather than read off a render. Every chart fill at 3.0:1 against its own ground. The two
money ramps separated from each other, and carrying different patterns and different forced
colours system colours, so the distinction survives greyscale and high contrast mode.

**gate-fcp.** A first contentful paint of the shipped page over the 1.2 s budget, measured cold
over the Fast 3G constants in headless Microsoft Edge. Its positive control is the same page
carrying 400000 B of incompressible padding, which must fail. It fails rather than skips when no
Edge is found.

Every gate runs its positive controls on every invocation. A gate nobody has watched fail is not
a gate. The four gates that read files also run a coverage control: each plants a violation of
its own rule in a throwaway tree, under src/cli/ and, for the gates that read prose, in USAGE.md,
runs its real scan over that tree, and fails unless the scan catches it, so a scan set that
stopped reaching a directory cannot pass quietly.

## Adding a figure

1. Add a method to `METHODS` in `src/core/claim.js` stating the endpoint and the arithmetic.
2. Map it to a tier in `METHOD_KIND`.
3. Build the value with `reported()` or `computed()`, passing the fiscal year and the award type
   set.
4. Render it with `renderClaim()` and put `dataAttrs` on the node.

If a figure will not fit that shape, the figure is the problem.

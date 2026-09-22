# solebidder, developer notes

Documentation only. The page this repository publishes is `index.html` at the repository ROOT.
Nothing in this directory is served as an entry point.

## Layout

    index.html          the page, at the ROOT
    src/core/           claims, units, the claim boundary statements, the palette, constants
    src/query/          the one API client, the request builders, the response validators
    src/contracts/      the three shapes the render layer is built against
    scripts/            the build and the four gates. Never served.
    test/               node --test, no dependencies
    docs/               this

## Commands

    npm test               the whole suite on the Node test runner
    npm run gates          all four gates, positive controls first
    npm run gates:selftest only the positive controls
    npm run build          regenerate the palette and the claim boundary block in index.html
    npm run build:check    regenerate to memory and compare by sha256
    npm run verify         tests, gates and the build check together

## The four gates, and what each refuses

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

Every gate runs its positive controls on every invocation. A gate nobody has watched fail is not
a gate.

## Adding a figure

1. Add a method to `METHODS` in `src/core/claim.js` stating the endpoint and the arithmetic.
2. Map it to a tier in `METHOD_KIND`.
3. Build the value with `reported()` or `computed()`, passing the fiscal year and the award type
   set.
4. Render it with `renderClaim()` and put `dataAttrs` on the node.

If a figure will not fit that shape, the figure is the problem.

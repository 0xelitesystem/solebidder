# solebidder

Type a federal contractor and see who actually buys from it, how concentrated that book is, and
how much of it was awarded with exactly one bidder.

Live: https://0xelitesystem.github.io/solebidder/

Every figure is federal prime award obligations recorded against one parent unique entity
identifier and its registered child identifiers, for one named fiscal year, fetched live from
USAspending by your own browser, and badged with the endpoint, the filter method and the date the
source publishes about itself.

## What this measures, and what it does not

Read this before the numbers, because the first line of it is the one that gets misquoted.

**These are OBLIGATIONS. They are not revenue.** An obligation is the government committing money
against an award. Money committed that way is not revenue under ASC 606 and it is not cash paid
out. A large obligation in one fiscal year is not a year of the same size on an income statement,
because the work is performed and booked over many years, sometimes a decade. Do not treat a
figure from this page as money the company booked, and do not divide one by a share count. The
unit noun is welded to every number on the page for exactly this reason: there is one function in
this repository that turns a number into a currency string, it takes a unit kind, and no code path
can emit a dollar amount without one.

**Award lifetime value is a THIRD quantity, and it is not either of the other two.** The hero
figure on the page is a share of the lifetime value of the largest contracts active in a year,
options included. It is not money obligated in the year you selected. It is rendered on its own
colour ramp with its own fill pattern, it never shares a chart or a column with a fiscal year
figure, and a build gate fails if one chart is handed two unit kinds.

It measures:

- federal PRIME award obligations recorded against one parent identifier and its registered child
  identifiers, for one fiscal year you chose, on an award type set you chose,
- the share of those dollars that came from one buying agency, one sub agency, one product
  service code and one industry classification,
- the share of the lifetime value across the largest contracts active in that year that the
  government record marks as awarded with exactly one bidder,
- the same total reached three ways, with the difference between the routes published,
- a second, differently defined total for everything matching the name you typed, with the
  entities that sit in the gap named one by one.

It does NOT measure, and says so on the page rather than in this file:

1. anything on a financial statement. These are obligations, not revenue, and they are not cash
   received either,
2. the total outlays field. It comes back empty from every aggregate endpoint used here, so it is
   never trended, never charted and never displayed as a zero,
3. money obligated in your selected year, when the figure is an award lifetime value,
4. everything a company gets. Entities not registered under the parent you chose are invisible
   to it,
5. a corporate structure anybody checked. The parent and child tree is what a registrant declared
   about itself in registration, it is not audited, it is not SEC consolidation, and it goes stale
   in ways that are visible in the data today,
6. subawards. They are excluded from every query, because prime reported subaward data is
   materially incomplete and a floor read as a total is worse than no figure,
7. Who lost a bid does not exist in this data. The procurement record publishes the number of
   offers received and never the identity of the parties who did not win,
8. classified and withheld actions, which are absent, and the size of that gap cannot be measured
   from inside the data,
9. anything before the start of federal fiscal year 2008, which is the floor of the search API,
10. any financial denominator at all: no revenue denominator, no backlog, no cost overruns and no
    foreign military sales split.

Those ten sentences ship verbatim on the page itself, and a build gate fails if one of them goes
missing or is paraphrased.

## Use

Open the page, start typing a contractor name, and pick the entity you meant. That last step is
not a formality. Sixteen parent level records match a single well known defence prime name, with
different identifiers and different totals, so the tool asks which one and then tells you which
one it summed and how many registered children rolled into it.

Then read two things nothing else free will tell you:

1. the share of the value across the largest contracts active in the year that the government
   record marks as awarded without competition,
2. the share of the fiscal year total that comes from a single department, and the same view by
   sub agency, by product service code and by industry classification.

Comparing two or three parents on one axis is designed and specified and is NOT in this version.
It is not in the interface and it is not claimed anywhere on the page.

There is a longer walk through, with worked situations, in [USAGE.md](USAGE.md).

## Why this exists

The official government site publishes the underlying rows and hands you off to advanced search
after five of them. It never computes a share, a customer dependence, a competition proportion, or
any company against company view. The commercial tools that do start in the low thousands of
dollars a year and most of them want an API key. Nothing free, browser native and signup free
exists for this question.

What this adds is arithmetic over the government's own published fields, with the arithmetic
printed beside the answer.

## How every figure is proven

There are four claim tiers and they are enforced by build gates, not by editorial care.

- **REPORTED** the API said it, from a named endpoint and a named field.
- **COMPUTED** our arithmetic over reported figures only, reproducible from committed fixtures by
  `npm test`.
- **ESTIMATED** the budget is zero. The kind exists so that `scripts/gate-badges.mjs` can detect
  an attempt to publish one, and `scripts/badge-exception-budget.json` holds `maxEstimated` at 0.
- **NEVER CLAIMED** ten statements about what this tool does not measure. They are on the page,
  not in a footnote, and `scripts/gate-vocabulary.mjs` fails the build if one goes missing.

Three structural rules sit under that.

- Obligations are not revenue, and the enforcement is a function signature rather than a
  disclaimer. One function turns a number into a currency string and it takes a unit kind. The
  kinds are obligations, award lifetime value and share. A chart that receives two of them cannot
  be constructed.
- Every request builder takes an explicit fiscal year and throws without one. One period in
  application state, always.
- The award search endpoint silently ignores a recipient id filter, so the award query builder is
  a separate module with no such parameter, and every returned row is validated against the
  resolved entity set with the excluded count shown on the page.

## Run locally

```
git clone https://github.com/0xelitesystem/solebidder
cd solebidder
npm test
```

There is nothing to install. Zero runtime dependencies and zero dev dependencies: the tests run
on the Node test runner built into Node itself, so a fresh clone works with no install step.
Then open `index.html` in a browser, or serve the directory with any static server.

## Build

```
npm run build          regenerate the palette, the claim boundary block and the footer
                       disclaimer in index.html
npm run build:check    regenerate to memory and compare by sha256
npm run gates          run every gate, positive controls first
npm run gates:selftest run only the positive controls
npm run verify         tests, gates and the build check together
npm run measure:fcp    measure first contentful paint in headless Edge
npm run measure:a11y   forced colours and 200 percent zoom in headless Edge
```

The palette in the page is generated from `src/core/tokens.js`, which is the same file
`scripts/gate-contrast.mjs` computes its WCAG arithmetic against, so the values that were checked
and the values that paint cannot drift apart. The ten claim boundary statements are generated from
`src/core/never-claimed.js` for the same reason, and the footer disclaimer from
`src/core/constants.js`.

## Measured, not asserted

These numbers come from the scripts named beside them, on this machine, and they are reproducible
by running those scripts. The paint and wire figures below are from one run on 2026-09-24.

| What | Budget | Measured | How |
|---|---|---|---|
| First contentful paint, cold cache, Fast 3G | 1.2 s | 0.676 s, median of 9 | `node scripts/gate-fcp.mjs --runs 9` |
| Page on the wire, gzipped | 50 KB | 10,804 B | the same run reports it |
| Runtime dependencies | 0 | 0 | `dependencies: {}` |

The paint number is the median of nine cold loads in headless Microsoft Edge, each load in a
fresh browser context with the HTTP cache disabled, served gzipped over the Fast 3G constants of the DevTools
network conditions: 562.5 ms of added latency and 188,744 bytes per second down. `npm run gate:fcp`
runs the same gate with five loads. The gate runs its own positive control on every invocation,
which is the same page carrying 400,000 bytes of incompressible padding; in that run the padded page
measured 2.29 s and the gate failed it, so a green result means the gate is awake rather than
absent.

Two things that budget does not cover, stated because leaving them out would be the misleading
part. The module graph and the bundled name index are 44 same origin requests fetched after the
paint, and on that same throttled profile DOMContentLoaded landed at 6.27 s, so the page is
readable in well under a second and fully interactive several seconds later. And the measurement is of this machine over a
loopback server with an emulated link, which is a repeatable number rather than a promise about
any particular reader's phone.

Forced colours and 200 percent zoom are measured in the same browser by `npm run measure:a11y`,
across four scenarios. The result that matters: with forced colours active, the two money ramps
stay distinguishable by both of their carriers. The fiscal year obligations mark paints a single
system colour across its whole area, and the award lifetime value mark paints a different system
colour under a hatch that needs dozens of distinct colours to cover it. The hatch survives, which
is the thing the design stakes the obligations against award value separation on. At a 640 CSS
pixel layout viewport, which is what 200 percent zoom on a 1280 pixel wide window produces, the
document does not scroll sideways, nothing clips its own text, and the one element wider than the
viewport is a chart inside its own scroll container.

## Data source

Source: USAspending.gov, United States Department of the Treasury. Works of the United States
government are not subject to domestic copyright under 17 USC 105, and the source repository for
that API carries a CC0 1.0 public domain dedication. This page redistributes nothing: every figure
is fetched live by the visitor's own browser from the government's own host.

Entities are keyed on the unique entity identifier only.

## Privacy

No account, no signup, no key, no analytics, no cookies, and nothing you type is stored. Your
browser talks to the government API directly. We never see a query.

## Known limits

Comparing companies side by side is not in this version. The four category dimensions, the hero,
the fiscal year spine, the three way reconciliation and the second definition are.

This page depends on one government host with no fallback. There is no honest offline mode,
because there is no honest bundled figure: the only bulk alternative is a multi gigabyte archive
with no cross origin headers and expiring links. When a call fails, the affected panel says what
is missing and why, and no partial rollup is ever shown as a total.

## Statement of independence

Not affiliated with, endorsed by, or sponsored by the United States government, the Department of
the Treasury, the Department of Defense, USAspending.gov, or any company named on the page. All
data comes from public government APIs. All company names are used descriptively.

## Not advice

This tool reports government records and arithmetic over them. It is not investment, legal or
procurement advice.

## Third-party notices

None. This project has zero runtime dependencies and zero dev dependencies, and vendors no
third party code.

## License

MIT. Copyright (c) 2026 0xelitesystem. See LICENSE.

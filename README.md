# solebidder

Type a federal contractor and see who actually buys from it, how concentrated that book is, and
how much of it was awarded with exactly one bidder.

Live: https://0xelitesystem.github.io/solebidder/

Every figure is federal prime award obligations recorded against one parent unique entity
identifier and its registered child identifiers, for one named fiscal year, fetched live from
USAspending by your own browser, or by your own machine from the [command line](#command-line),
and badged with the endpoint, the filter method and the date the source publishes about itself.

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
missing or is paraphrased. The command line prints the same ten from the same registry, beside
the sections they qualify, and `solebidder claims` prints all of them.

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

There is a longer walk through, with worked situations, in [USAGE.md](USAGE.md). The same report
runs in a terminal, in the section below.

## Command line

The same report prints in a terminal, built by the same modules the page runs. It needs Node 22
or later and nothing else: the package has zero dependencies.

```
npx solebidder "lockheed martin"
npx solebidder "lockheed martin" --uei ZFN2JJXBLZT3 --fy 2025
npx solebidder "lockheed martin" --uei ZFN2JJXBLZT3 --fy 2025 --json --out report.json
npx solebidder suggest lockheed
npx solebidder claims
npx solebidder --help
```

When more than one parent level record matches the name, the report prints the refusal and each
record's name and identifier, with no amounts, and exits with code 3. Nothing is added together.
Run it again with `--uei` and the identifier you mean, and the report says you chose it with that
option. `solebidder suggest` looks names up in the index bundled with the package, offline.

### Commands

| Command | What it prints | What it contacts |
|---|---|---|
| `solebidder <name>` | The report for the one parent level record that matches the name, or the refusal when more than one does | `api.usaspending.gov` |
| `solebidder suggest <text>` | Names and identifiers from the index bundled with the package, never an amount | nothing |
| `solebidder claims` | The ten statements of what this tool never claims, word for word | nothing |
| `solebidder --help` | The usage, every option, the exit codes, what it contacts, the privacy line, the source, independence and the disclaimer | nothing |
| `solebidder --version` | The version | nothing |

The report prints, in this order: what was summed, meaning the entity, its identifier, how many
registered children rolled into it, the fiscal year and how it was chosen, and the award type
set; the parent total; the same figure reached more than one way, with the difference between the
routes published to the cent; the share of lifetime award value across the largest contracts
active in the year that the record marks as awarded with exactly one bidder, with its denominator
in words, its tallies, the one offer cross check and a link to the government's own record of
each of the largest few; the top share by awarding agency, sub agency, product service code and
industry classification, with the Herfindahl index across the buying agencies; the concentration
curve as a table; obligations by fiscal year for ten years, each with the change from the year
before; the second definition beside the first, with the entities in the gap listed; and every
registered child entity with its amount. Every figure carries its badge as a word. Every full
report prints all ten statements of what this tool never claims, word for word, beside the
sections they qualify. The foot of every report carries the date the source publishes about
itself, fetched on that run, then the source line, the statement of independence and the advice
disclaimer.

### Options

| Option | Meaning |
|---|---|
| `--fy <year>` | A whole fiscal year, four digits, from FY2008 to the current one. Default: the most recently completed fiscal year, which the report names |
| `--set <set>` | `contracts`, the default, or `contractsAndIdvs`, or `all`. The set is named on every badge |
| `--uei <UEI>` | Choose one parent level record by its twelve character unique entity identifier |
| `--json` | One JSON document, schema `solebidder.cli/1` |
| `--csv` | One row per figure, with the unit named in every column header and formula safe cells |
| `--plain` | One complete sentence per figure, for a screen reader or a plain log |
| `--no-color` | No styling. `NO_COLOR` set to any value does the same |
| `--out <path>` | Write to that file instead of the terminal |
| `--force` | With `--out`, replace a file that already exists |
| `-h`, `--help` | The help |
| `--version` | The version |

An option given twice, an unknown option, or two formats at once is a usage error, and nothing is
contacted. A name that starts like an option, or one of the command words, goes after `--`.

### Exit codes

| Code | Meaning |
|---|---|
| `0` | Done. |
| `1` | A named failure: nothing matched the name, a section failed or was suppressed, the output file was refused, or the environment was refused. When a section failed, the rest of the report still prints. |
| `2` | A usage error. Nothing was contacted. |
| `3` | A choice is required: more than one parent level record matches the name, or the UEI given with `--uei` is not one of those that match. Run it again with `--uei`. |
| `130` | Interrupted. The requests in flight are cancelled and no report is printed. |

A pager or `head` that closes the pipe early is not a failure: the command stops quietly with 0.

### What it contacts, and how many requests

`https://api.usaspending.gov` and nothing else, over HTTPS with certificate checks on. `suggest`,
`claims`, `--help` and `--version` contact nothing. A report makes at most 60 requests: the date
the source publishes about itself, the list of records matching the name, the parent profile, its
registered children, the 40 largest contracts and one competition record for each, obligations by
fiscal year, 4 category breakdowns, and up to 5 pages each of the entity breakdown and the name
match. A name that matches more than one parent level record stops after 2 requests. The
competition records are fetched at most 6 at a time. A request that meets a server error or a
dropped connection is tried up to 4 times in all, with backoff, and never more. Redirects are
refused and never followed, an answer over 4 MiB is refused, and an answer that is not JSON is
refused. Nothing is cached, so every run fetches again, the source date included.

No option and no environment variable points it at another host. If `NODE_TLS_REJECT_UNAUTHORIZED`
is set to `0`, which switches certificate checks off, the report refuses to run. A proxy from the
environment is used only when Node is told to use one with `NODE_USE_ENV_PROXY`, and the report
says so on standard error when it is.

Every request carries this User-Agent, which names the tool, its version and its source, and
nothing about you:

```
solebidder/<version> (+https://github.com/0xelitesystem/solebidder)
```

### Output for a file, a script or a spreadsheet

`--json` prints one document with the schema `solebidder.cli/1`. Every figure is an object with its
`badge`, `value`, `unit`, `method`, printed `text` and `provenance`, and its fiscal year, award
type set and source date. The `value` is the figure at the precision it is printed, so it always
agrees with `text`. A figure that could not be computed has no `value` and carries the reason in
words instead, never a zero; a section that failed carries its failure `kind` and the `reason`.
The document also carries `neverClaimed`, `attribution`, `independence`, `disclaimer`, `privacy`
and the `exitCode`.

`--csv` prints one row per figure. Every column that holds a figure names its unit, and the four
kinds never share a column: `Dollars obligated in the fiscal year`, `Lifetime award value in
dollars, exercised options included`, `Share of the stated denominator, as a decimal fraction` and
`Count of records`. Every cell is quoted. A text cell that starts with `=`, `+`, `-`, `@`, a tab or
a carriage return, or with spaces and then one of those, gets a single quote in front, so a
spreadsheet reads it as text instead of running it. The value columns hold plain numbers the tool
wrote itself and stay numbers, deobligations included. A figure that could not be computed leaves
its value cells empty and says why in `Why there is no figure`. The last rows carry the source
date, the source line, the statement of independence and the disclaimer.

`--out <path>` writes that one file and nothing else. It refuses a file that already exists
unless `--force` is given, refuses a link with or without `--force`, and refuses any path inside
the directory the tool is installed in. Without `--out`, nothing is written to disk.

### Reading it in a terminal

Every badge is a word, `[REPORTED]` or `[COMPUTED]`, so nothing depends on colour. Styling is bold
only, on headings and badge words, and it is off when the output is not a terminal, when
`NO_COLOR` is set to anything, or with `--no-color`. Lines wrap at `COLUMNS`, eighty when nothing
says otherwise, and a figure is never split across two lines. There is no spinner and nothing is
redrawn: progress is one plain line at a time on standard error and the report is on standard
output, so redirecting standard output to a file keeps the report alone. When the source is slow
to answer, one line after 3 seconds says so.

Every line leaves through one output routine that strips control characters, invisible formatting
characters and text direction overrides, so a name in the government record cannot clear the
screen, move the cursor, retitle the window, write to the clipboard or reorder the text around
it. Accented names and curly quotes print as the source sent them.

### What it leaves out, and why

It prints no count of awards. The count endpoint does not apply the recipient filter: its
recorded answer, in `test/fixtures/api/award-count-fy2025.json`, says the recipient filter was not
used, so the count it returns is not about the entity asked for, and printed here it would read as
if it were.

### Source, independence and advice

Every report ends with these, `--help` prints them, and `--json` and `--csv` carry them as fields
and rows:

Source: USAspending.gov, United States Department of the Treasury.

Not affiliated with, endorsed by, or sponsored by the United States government, the Department of
the Treasury, the Department of Defense, USAspending.gov, or any company named in this output. All
data comes from public government APIs. All company names are used descriptively.

This tool reports government records and arithmetic over them. It is not investment, legal or
procurement advice.

## Why this exists

The official government site publishes the underlying rows and hands you off to advanced search
after the first few. It never computes a share, a customer dependence, a competition proportion,
or any company against company view. The commercial tools that do are paid subscriptions and most
of them want an API key. Nothing free, browser native and signup free exists for this question.

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

The command line runs from a clone the same way, with `node src/cli/bin.js --help`. From a clone,
`--out` refuses a path inside the clone, because that is the directory the tool runs from, so
write the file somewhere else.

## Build

```
npm run build          regenerate the palette, the claim boundary block and the footer
                       disclaimer in index.html
npm run build:check    regenerate to memory and compare by sha256
npm run gates          run every gate, positive controls first
npm run gates:selftest run only the positive controls
npm run verify         tests, gates and the build check together
npm run verify:ci      the same without the paint gate, so it needs no browser; this is
                       what runs before every npm publish
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
by running those scripts. The paint and wire figures below are from one run on 2026-09-26.

| What | Budget | Measured | How |
|---|---|---|---|
| First contentful paint, cold cache, Fast 3G | 1.2 s | 0.640 s, median of 9 | `node scripts/gate-fcp.mjs --runs 9` |
| Page on the wire, gzipped | 50 KB | 10,804 B | the same run reports it |
| Runtime dependencies | 0 | 0 | `dependencies: {}` |

The paint number is the median of nine cold loads in headless Microsoft Edge, each load in a
fresh browser context with the HTTP cache disabled, served gzipped over the Fast 3G constants of the DevTools
network conditions: 562.5 ms of added latency and 188,744 bytes per second down. `npm run gate:fcp`
runs the same gate with five loads. The gate runs its own positive control on every invocation,
which is the same page carrying 400,000 bytes of incompressible padding; in that run the padded page
measured 2.30 s and the gate failed it, so a green result means the gate is awake rather than
absent.

Two things that budget does not cover, stated because leaving them out would be the misleading
part. The module graph and the bundled name index are 45 same origin requests fetched after the
paint, and on that same throttled profile DOMContentLoaded landed at 6.32 s, so the page is
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
that API carries a CC0 1.0 public domain dedication. Neither the page nor the command line
redistributes a figure: every figure is fetched live from the government's own host, by the
visitor's own browser or by the user's own machine. The one data file bundled with both, the name
index, holds names and identifiers and no amounts.

Entities are keyed on the unique entity identifier only.

## Privacy

### Page

No account, no signup, no key, no analytics, no cookies, and nothing you type is stored. Your
browser talks to the government API directly. We never see a query.

### Command line

Your machine talks to api.usaspending.gov directly and to nothing else. There is no telemetry and
no update check, nothing is cached, and nothing is written to disk unless you pass --out. The name
you search is sent to USAspending, because that is the question being asked. Each request carries
your IP address, as every request on the internet does, and this User-Agent:
`solebidder/<version> (+https://github.com/0xelitesystem/solebidder)`.

No account, no key and no configuration file. The tool reads only these environment variables:
`NO_COLOR`, `FORCE_COLOR`, `TERM` and `COLUMNS` for layout, `NODE_TLS_REJECT_UNAUTHORIZED` to refuse
to run with certificate checks off, and `NODE_USE_ENV_PROXY`, `NODE_OPTIONS`, `HTTPS_PROXY` and
`NO_PROXY`, the last two in either case, to say when a proxy is in use. It never prints a value it
read from the environment. Running it through `npx`, or installing it, downloads
the package from the npm registry; that request is made by npm before the tool starts, and it is
the only one the tool does not make itself.

## Known limits

Comparing companies side by side is not in this version. The four category dimensions, the hero,
the fiscal year spine, the three way reconciliation and the second definition are.

The page and the command line depend on one government host with no fallback. There is no honest
offline mode, because there is no honest bundled figure: the only bulk alternative is a large
archive download with no cross origin headers and expiring links. When a call fails, the affected panel says what
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

# Changelog

Release notes for solebidder. The page is served from the repository; the npm package carries
the command line.

## 0.2.0

The first release on npm. It adds a command line and fixes the page where building the command
line showed it was wrong.

### Added

- **A command line, `solebidder`.** `npx solebidder "<name>"` prints the page's report as badged
  text from the same modules the page runs: the parent total, the same figure reached more than
  one way, the share of lifetime award value awarded with exactly one bidder, the four buyer
  breakdowns with the Herfindahl index, the concentration curve, obligations by fiscal year with
  the change from the year before, the second definition, and every registered child entity. The
  ten statements of what this tool never claims print beside the sections they qualify.
- **The refusal as an exit code.** When more than one parent level record matches a name, the
  command lists each record's name and identifier with no amounts and exits with code 3. `--uei`
  chooses one, and the report says the choice was made with that option.
- **Offline commands.** `solebidder suggest <text>` reads the name index bundled with the package,
  and `solebidder claims` prints the ten statements word for word. Neither contacts anything.
- **Options.** `--fy`, `--set`, `--uei`, `--json` (schema `solebidder.cli/1`), `--csv` with formula
  safe cells, `--plain`, `--no-color`, `--out` and `--force`, `--help` and `--version`. Exit codes
  0, 1, 2, 3 and 130, documented in `--help` and the README.
- **Transport rules for a runtime with no browser around it.** One host, api.usaspending.gov, with
  no way to name another. Redirects are refused, answers are capped in size and must be JSON,
  certificate checks cannot be switched off for a report, and every request names the tool in its
  User-Agent. Nothing is cached and nothing is written unless `--out` is given.
- **One output routine for the terminal.** Every line is stripped of control characters, invisible
  formatting characters and text direction overrides on the way out, so text from the source
  cannot drive the terminal.
- **The advice disclaimer.** One sentence, generated into the page footer and printed at the foot
  of every report, in `--help`, in the README and in USAGE.
- **Release plumbing.** A `bin` entry, a `files` list that packs only what the command loads,
  `prepublishOnly` running `npm run verify:ci` with no browser needed, and a release workflow that
  publishes a version tag with provenance and rehearses by hand.

### Changed on the page

- The date the source publishes about itself is fetched before any figure is built, so the
  opening example's badges carry it rather than saying it was unavailable.
- The entity breakdown under the parent identifier is fetched once and used by both the second
  definition and the reconciliation, instead of twice.
- A fiscal year that has not started is refused. The bound used to be the calendar year plus one,
  which admitted the next fiscal year from January.
- Failure, source date and change sentences name no surface, because the page and the command line
  print the same copy. The dropped row note says "dropped from every figure here".
- The Herfindahl method sentence says its formula is printed beside the figure.

### Fixed in the documentation

- The README measured table was remeasured from one run of `node scripts/gate-fcp.mjs --runs 9`.
- Figures no committed script or test recomputes were cut from the README and USAGE: cold and warm
  timings, paging times, a difference between award type sets, the row counts of the government
  site, a price band for commercial tools, an archive size, and three share figures with no
  committed fixture behind them.
- USAGE said the page shows the change from year to year. The command line does; the page does
  not, and USAGE now says so.
- The fixtures README now describes the recorded API responses truthfully, the developer notes
  count five gates, and no comment claims that scripts/ is never served.

## 0.1.0 (2026-09-22)

The page only. Not published to npm.

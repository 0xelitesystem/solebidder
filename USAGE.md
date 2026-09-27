# Using solebidder

## What it does

You type the name of a federal contractor, you pick which registered entity you actually meant,
and the page computes five things over the government's own published fields and shows you the
arithmetic for each one.

1. How much of the value across that entity's largest contracts active in a fiscal year was
   awarded with exactly one bidder.
2. How much of its fiscal year money came from a single buying agency, a single sub agency, a
   single product service code and a single industry classification.
3. What its obligations look like across ten fiscal years.
4. The same fiscal year total reached three separate ways, with the difference between the routes
   published rather than rounded away.
5. A second, differently defined total for everything matching the name you typed, with every
   entity in the gap between the two definitions listed by name and identifier.

Every number carries a badge naming the endpoint it came from, the arithmetic that produced it,
the fiscal year, the award type set, and the date the source publishes about itself.

The same report runs in a terminal, with output a script or a spreadsheet can take. The
[Command line](#command-line) chapter below covers it.

## Why

USAspending.gov publishes all the underlying rows and it is free, official and complete. What it
does not do is compute. Its recipient profile shows the first few rows of each category and then
hands you off to advanced search. It never turns those rows into a share, never names a customer
dependence, and never states a competition proportion. Those are the three facts an analyst
actually wants and they are one division away from data that is already public.

The commercial tools that do compute them are paid subscriptions, and most of them want an API key
before they will talk to you. There is no free, browser native, signup
free tool for this question. This is that.

## Quickstart

1. Open the page. It asks USAspending for two things before you type anything: the date the
   source publishes about itself, and the one worked example at the top of the page. The bundled
   name index comes from the page's own host. Nothing else is fetched until you type in the
   search box.
2. Type a contractor name, or click one of the starting chips.
3. **Pick the entity.** This step is not a formality and it is not skippable. Sixteen parent level
   records match one well known defence prime name, with different identifiers and different
   totals. The tool will not add them together for you, because adding them would invent a
   company the record does not contain. Pick one and the page tells you which one it summed and
   how many registered children rolled into it.
4. Set the fiscal year and the award type set if you want something other than the defaults. Both
   are visible controls, never hidden defaults, and both are named on every badge.
5. Read down. The hero lands first, then the fiscal year spine, then the category panels, which
   are the slowest endpoints and are never allowed to hold up the rest.

If a panel is still waiting after three seconds it says so, and that USAspending can be slow to
answer a query it has not answered recently. There is no spinner anywhere on this page, because a
spinner implies progress it cannot see.

## Six ways to use it

### 1. Sizing single customer risk before a credit or equity call

**SITUATION.** You are looking at a contractor and you need to know how exposed it is to one
buyer. The annual report says "the United States government" and stops there.

**WHAT YOU DO.** Search the name, pick the parent record, and read the four category panels from
the top. Start with the buying agency panel, then the sub agency panel under it.

**WHAT YOU LEARN.** The share of the fiscal year total that came from one department, the name of
that department, and the same figure one level down. For one large prime in FY2025, on the
contracts award type set, that reads 98.8 percent from one department; `npm test` recomputes that
figure in `test/concentration.test.js` from the response recorded in
`test/fixtures/api/category-awarding-agency-fy2025.json`. Under the share the page prints both
halves of the division and how many rows were in the denominator, so you can redo it yourself.

**THE ACTION.** You now have a concentration number with a source behind it. Use it as the
counterweight to a diversification story in a management deck, and quote the numerator, the
denominator and the fiscal year with it rather than the percentage on its own.

### 2. Checking whether "competitively bid" survives contact with the record

**SITUATION.** Everybody in the room assumes federal contracting means a competition. Somebody
should check.

**WHAT YOU DO.** Read the hero. Then open the receipts table underneath it and click through to
the government's own award record for the largest few.

**WHAT YOU LEARN.** The share of the lifetime value across the largest contracts active in the
year that the record marks NOT COMPETED, with the dollars on both sides of the division. Beside
it, an independent cross check: the share of those contracts reporting exactly one offer received.
Where the record contradicts itself, for example an award reporting full and open competition
alongside zero offers, that award is shown as reported and excluded from the count share with a
visible excluded tally.

**THE ACTION.** Stop describing the book as competitively bid without a number. If you are writing
a note, quote the sentence the page prints, which names the denominator as the largest contracts
active in that year, not the company's federal money.

### 3. Testing a management claim about government demand

**SITUATION.** Management guided to growing federal demand. You want an exogenous read.

**WHAT YOU DO.** Read the fiscal year spine, ten columns, one call. Then flip the award type set
control and watch what moves.

**WHAT YOU LEARN.** Obligations by fiscal year on one consistent definition, each year in full. The
page draws the columns and leaves the change between them to you. The command line report and its
JSON output print the year over year change as both years in full plus the signed difference in
dollars, and where a rise is too large to render honestly as a percentage they say so and give you
the dollars rather than a number they cannot stand behind.

**THE ACTION.** Compare the shape of that series against the guide. A divergence is a question for
the next call. Remember what the unit is before you use it: these are obligations, not revenue,
and the two do not have to move together in the same year.

### 4. Finding out what "the company" even means in this dataset

**SITUATION.** You are about to quote a total in a note and you want to know what it includes.

**WHAT YOU DO.** Open the rollup panel, then the second definition panel below it.

**WHAT YOU LEARN.** The rollup panel performs the sum in front of you: the parent profile total,
the sum of every registered child, the paged entity breakdown under the parent identifier, and the
difference between those routes published to the cent. A one cent difference across hundreds of
rows is float arithmetic and the page says so rather than rounding it away. The second definition
panel then shows you a different and equally defensible total, everything matching the name you
typed, on the same endpoint and the same filters with only the filter type changed, and lists
every entity in the gap by name and identifier.

**THE ACTION.** Pick the definition your note actually needs and name it in the note. Do not
average the two and do not present them as a range: they are not two estimates of one truth, they
are two answers to two different questions.

### 5. Working out what an agency is actually buying

**SITUATION.** You know the dollars. You do not know what they bought.

**WHAT YOU DO.** Read the product service code panel and the industry classification panel.

**WHAT YOU LEARN.** The government's own classification of the goods and services behind the
money, ranked, with the top one as a share of the whole and both halves of the division printed
beneath it.

**THE ACTION.** Line that mix up against the segment reporting in the annual report. Where the
classification mix and the reported segments disagree in direction, you have found a question
worth asking, not an answer.

### 6. Getting a refusal instead of a wrong number

**SITUATION.** You type a household technology name.

**WHAT YOU DO.** Type it. Read what comes back.

**WHAT YOU LEARN.** That no single parent record exists for it in this dataset, which records do
match, and what each of their identifiers is. Several large technology companies have no umbrella
parent record at all: separate legal entities sit side by side with no link between them, and
adding them together would invent a company the government record does not contain.

**THE ACTION.** Either pick one record deliberately, and the page will tell you that is what you
did, or accept that this question cannot be answered from this dataset and go somewhere else. The
refusal is the most trustworthy thing on the page and it is built as a feature rather than an
error state.

## Getting the most out of it

- **Set the award type set before you quote anything.** Contracts only, contracts plus indefinite
  delivery vehicles, and every award type are three defensible answers to the same question and
  on a large prime they can differ by a lot. The control is visible, the set is on every badge,
  and it is never a hidden default.
- **Warm the query, then work.** The first call against a cold name can be slow; the same call is
  much faster once the upstream cache is warm. Run the search, let it land, then change the year
  or the set.
- **Read the denominator, not the percentage.** Every share on this page prints its numerator and
  its denominator in words directly underneath. A percentage lifted out of that sentence is the
  easiest thing here to misquote.
- **Use the Table toggle.** Every chart has a visible one. It is the screen reader path, the
  no JavaScript path, the chart failed path, and usually the thing a finance reader wanted anyway.
- **Charts are keyboard reachable.** One tab stop per chart, then left and right between points,
  home and end to the ends, escape to leave. Nothing on this page is hover only.
- **Copy the provenance line with the figure.** It carries the endpoint, the method, the fiscal
  year, the award type set and the source date. A figure without it is a figure somebody else has
  to take on trust.

## Command line

### What it does

`solebidder` is the same report in a terminal. It runs the modules the page runs, in the same
order, against the same one government host, and prints every figure with its badge as a word.
Give it a name and it resolves the name to parent level records exactly as the page does: when one
record matches, it reports; when more than one does, it refuses, lists each record's name and
identifier with no amounts, and exits with code 3 until you choose one with `--uei`.

```
npx solebidder "lockheed martin"
npx solebidder "lockheed martin" --uei ZFN2JJXBLZT3
npx solebidder "lockheed martin" --uei ZFN2JJXBLZT3 --fy 2025 --plain
npx solebidder suggest lockheed
npx solebidder claims
```

Two commands never touch the network. `solebidder suggest` looks names up in the index bundled
with the package, and `solebidder claims` prints the ten statements of what this tool never
claims, word for word.

The report prints one thing the page does not: each fiscal year in the obligations spine carries
the change from the year before, in dollars and, where one can be printed honestly, as a share of
the earlier year. In the terminal, long lists show their largest rows; `--json` and `--csv` carry
every row of every breakdown and every contract in the competition set.

It prints no count of awards. The count endpoint does not apply the recipient filter: its recorded
answer, in `test/fixtures/api/award-count-fy2025.json`, says the recipient filter was not used, so
the count it returns is not about the entity you asked for.

Every option, the exit codes, the request plan, the User-Agent and the privacy line are in the
[README](README.md#command-line) and in `solebidder --help`.

### Why it is useful

- **It asks the same question every time, and a script can read its refusal.** The entity, the
  fiscal year and the award type set are options, and each is printed on every figure, so the same
  command asks the same question next quarter. A name that is not one company in this dataset
  ends with exit code 3 rather than a number, so a script stops instead of summing the wrong
  company.
- **The receipt travels with the figure.** In `--json` every figure carries its badge, method,
  fiscal year, award type set and source date. In `--csv` so does every figure row, with the unit
  named in every column header. A figure pasted into a spreadsheet, a note or another program
  keeps where it came from.
- **A saved file is a dated record.** `--out` writes the report with the date the source published
  about its own data on that run, the source line and the disclaimer inside it.
- **Nothing to sign up for.** No account, no key, no configuration file and zero dependencies. It
  needs Node 22 or later.

### How to use it well

- **Resolve first, then report.** Run the name on its own. If it exits with code 3, read the list,
  pick the record you mean, and pass its identifier with `--uei` from then on. The report says you
  chose it with the option, so whoever reads the output knows a person made that choice.
  `solebidder suggest` shows names and identifiers from the bundled index without a request, but
  many of those are child level records, and the report sums a parent and its registered children
  only.
- **Pin the fiscal year in anything you keep.** Without `--fy` the report uses the most recently
  completed fiscal year and says so. That default moves forward when a new federal fiscal year
  starts on the first of October, counted in UTC. Passing `--fy` makes the command repeatable.
- **Choose the award type set on purpose.** `contracts` is the default. `contractsAndIdvs` and
  `all` answer different questions with different totals. The set is printed on every figure, so
  quote it with the figure.
- **Read the exit code before the output.** 0 is done. 1 is a named failure: when a section
  failed or was suppressed, the rest of the report still printed, so find the section that says
  it is missing before you quote anything. 2 is a typing mistake, 3 is a choice to make, and 130
  means it was interrupted.
- **Keep the two streams apart.** The report is on standard output. Progress lines, the waiting
  line and notices are on standard error. Redirecting standard output to a file gives a clean
  document; `--out` does the same and refuses to overwrite a file unless you pass `--force`.
- **A slow first answer is the source, not the tool.** A name the source has not been asked about
  lately can take a long time; after three seconds one line on standard error says the source has
  not answered yet. Nothing is printed until every part has answered or failed. The same command
  run again soon after is usually faster, because the source's own cache is warm by then.
- **Be polite to a free public service.** One report makes at most 60 distinct requests, each tried
  up to four times in all, so at most 240 requests are sent. Run reports one after another, never
  many at once, and keep the output rather than asking again: nothing is cached, so every run
  fetches everything again.
- **For a screen reader or a log**, `--plain` prints one complete sentence per figure with no
  indentation. A non-empty `NO_COLOR` or `--no-color` turns off the only styling there is, bold,
  and `COLUMNS` sets the wrap width.

### Four ways to use it

#### 1. A credit analyst checking customer concentration

**SITUATION.** A borrower's filings say its customer is the United States government. You need to
know how concentrated that is inside the government, with a source you can cite in a credit memo.

**WHAT YOU DO.**

```
npx solebidder "<borrower name>"
npx solebidder "<borrower name>" --uei <UEI> --fy 2025 --json --out borrower-fy2025.json
```

**WHAT YOU LEARN.** In the `buyers` section, the share of the year's obligations that came from the
single largest awarding agency, with the dollars on both sides of the division and how many
agencies were returned, and the same view one level down by sub agency. The Herfindahl index
across the agencies puts the whole spread into one figure. In the JSON these are
`awarding_agency.topShare`, `awarding_agency.herfindahl` and `awarding_subagency.topShare`, each
with its `denominatorText`.

**THE ACTION.** Quote the share with its numerator, its denominator, the fiscal year, the award type
set and the source date from the same file. Remember what the unit is: obligations, which are the
government committing money, not money the borrower booked in that year.

#### 2. A procurement team checking sole source exposure

**SITUATION.** You buy from a supplier, or you are about to, and you want to know how much of its
federal work was awarded without competition.

**WHAT YOU DO.**

```
npx solebidder "<supplier name>" --uei <UEI> --fy 2025
npx solebidder "<supplier name>" --uei <UEI> --fy 2025 --set contractsAndIdvs
```

**WHAT YOU LEARN.** The share of lifetime award value across the largest contracts active in the
year that the record marks as awarded with exactly one bidder, with the dollars on both sides, the
tallies behind it, and the one offer cross check, which counts records instead of dollars. When
some contracts carry no competition field, the report says the share is a floor. The largest
contracts are listed with a link to the government's own award record, so you can check each one
yourself. The second run shows how the answer moves when indefinite delivery vehicles are counted.

**THE ACTION.** Treat the share as a property of the largest contracts in that year, which is what
its denominator sentence says, and not of every contract the supplier holds. A high share is a
question to take to the award records, not a finding.

#### 3. A journalist who needs a figure that survives a correction request

**SITUATION.** You are writing about a contractor and you need a figure you can print, attribute,
and defend when the company's press office calls.

**WHAT YOU DO.**

```
npx solebidder "<company name>"
npx solebidder "<company name>" --uei <UEI> --fy 2025 --plain --out company-fy2025.txt
npx solebidder claims
```

**WHAT YOU LEARN.** The first run tells you whether the name is one company in this dataset at all.
`--plain` writes one complete sentence per figure, each with its unit and badge, so a figure
cannot be lifted without the words that say what it is. The second definition section prints the
total for everything matching the name beside the parent's own total, with every entity in the
gap named. `solebidder claims` prints the ten statements that say what these figures are not.

**THE ACTION.** Attribute the figure to USAspending.gov, name the fiscal year, the award type set and
which definition of the company you used, and keep the file: it holds the date the source
published about its own data on the day you ran it. Call the figure what it is, obligations.

#### 4. A spreadsheet that tracks a few contractors across years

**SITUATION.** You follow a handful of contractors across fiscal years in a spreadsheet and you want
the figures to arrive with their units and sources rather than retyped.

**WHAT YOU DO.** Resolve each name once with the name alone, then write one file per company and
year, one run after another:

```
npm install --global solebidder
solebidder "<company name>" --uei <UEI> --fy 2024 --csv --out company-fy2024.csv
solebidder "<company name>" --uei <UEI> --fy 2025 --csv --out company-fy2025.csv
```

Installing once means each run starts the installed command rather than resolving the package
through npx again.

**WHAT YOU LEARN.** One row per figure. The value sits in the column for its unit, which is one of
`Dollars obligated in the fiscal year`, `Lifetime award value in dollars, exercised options
included`, `Share of the stated denominator, as a decimal fraction` and `Count of records`, and
the other three stay empty, so a sum down one column can never mix quantities. Each figure row
also carries the figure as printed, its badge, method, fiscal year, award type set and source
date. A text cell a spreadsheet would run as a formula starts with a single quote, and
deobligations stay negative numbers. A figure that could not be computed leaves its value empty
and says why in `Why there is no figure`. Rows keep the same `Section`, `Figure id` and entity
columns from run to run, and the `Fiscal year` column says which year each figure is for, so two
files line up on those columns.

**THE ACTION.** Keep the source date rows with the figures. Never add obligations and lifetime award
value together, and never sum shares.

### When something goes wrong

- **Exit code 3 and a list of records.** The name matches more than one parent level record, or
  the identifier you gave with `--uei` is not one of the records that match that name. Pick one
  from the list and pass it with `--uei`.
- **Exit code 1 and a section that says it is missing.** That part failed, or its total was
  suppressed because some of its parts did not arrive. The sentence under it says which, and
  whether running again could help.
- **`--out` refuses the path.** The file exists (pass `--force` to replace it), the path is a link
  (never written through), or the path is inside the directory the tool is installed in. Running
  from a clone of the repository, that directory is the clone, so write the file somewhere else.
- **It refuses to run and names `NODE_TLS_REJECT_UNAUTHORIZED`.** That variable is set to zero,
  which switches certificate checks off, and a figure received that way cannot be badged as
  reported. Unset it and run again.

## Honest limits

- **One host, no fallback.** Every figure comes from one government API. If it is down, this page
  shows named failures per panel and no figures. There is no honest offline mode, because there
  is no honest bundled figure: the only bulk alternative is a large archive download with no cross
  origin headers and links that expire.
- **The parent and child tree is self declared.** It is what a registrant said about itself in
  registration. It is not audited and it is not consolidation under an accounting standard. It
  goes stale: one large laboratory entity still sits in a defence prime's children list years
  after its management contract moved to a different operator. That example is shown on the page
  rather than hidden.
- **Award lists are top N, never a full enumeration.** One large company's contracts for one year
  run to many pages. The page takes the largest by value, one page, and says so.
- **Comparing two or three companies on one axis is not in this version.** It is specified, and
  it is not claimed anywhere in the interface.
- **Nothing before federal fiscal year 2008 exists here**, so no figure on this page covers the
  whole history of anything.
- **Classified and withheld actions are missing** and the size of that gap cannot be measured from
  inside the data. Defence primes are where the gap is largest and they are the first names
  anyone searches.
- **No estimates, at all.** If a figure cannot be reported or computed from reported figures, the
  panel says what is missing and why, and the figure is absent. The estimate budget is zero and a
  build gate enforces it.
- **Not advice.** This tool reports government records and arithmetic over them. It is not
  investment, legal or procurement advice.

## Troubleshooting

**A panel says it has no answer yet and nothing has happened for a while.** That is expected. The
heavy endpoints are slow on a cold cache and fast once it is warm. The request is still open and it
has not been retried into the ground.

**A panel says the source did not respond and offers Retry.** The page already tried the request
four times in all, with backoff, before showing you that. Press Retry.

**The total changed when I changed the award type set.** It should. Three sets, three defensible
totals, and the badge under every figure names which one produced it.

**The rollup total is suppressed and the panel says how many children arrived.** A rollup missing
some of its parts is smaller than the truth and a reader will quote it, so it is withheld rather
than shown short. Retry the entity.

**My company shows no contracts at all.** Check which entity you picked. A child level record and
a parent level record with similar names are different subjects, and the page sums a parent and
its registered children only.

**The second definition panel refuses while the rest of the page works.** It needs both of its
arms: the entity breakdown under the identifier and the name match under the text, on the same
year and the same award type set. Half a comparison is not a comparison, so it refuses rather than
substituting a figure taken on different filters.

**The typeahead suggests nothing for two characters.** It starts at two characters and the bundled
index covers the head of the recipient list only. Keep typing; everything outside the bundle is
answered by the live suggestion endpoint.

**Nothing loads at all and the console is quiet.** Check that you are serving the directory rather
than opening it from the file system: the page loads its modules and its bundled name index as
same origin requests. Any static server will do, and there is no build step.

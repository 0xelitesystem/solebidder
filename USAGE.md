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

## Why

USAspending.gov publishes all the underlying rows and it is free, official and complete. What it
does not do is compute. Its recipient profile shows the top five rows of eight categories and then
hands you off to advanced search. It never turns those rows into a share, never names a customer
dependence, and never states a competition proportion. Those are the three facts an analyst
actually wants and they are one division away from data that is already public.

The commercial tools that do compute them start in the low thousands of dollars a year and most
of them want an API key before they will talk to you. There is no free, browser native, signup
free tool for this question. This is that.

## Quickstart

1. Open the page. Nothing loads over the network until you ask for something, apart from the date
   the source publishes about itself.
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

If a panel is still waiting after three seconds it says out loud that the source is cold. That is
true: the same query has been measured at twenty six seconds cold and four tenths of a second once
the upstream cache is warm. There is no spinner anywhere on this page, because a spinner implies
progress it cannot see.

## Six ways to use it

### 1. Sizing single customer risk before a credit or equity call

**SITUATION.** You are looking at a contractor and you need to know how exposed it is to one
buyer. The annual report says "the United States government" and stops there.

**WHAT YOU DO.** Search the name, pick the parent record, and read the four category panels from
the top. Start with the buying agency panel, then the sub agency panel under it.

**WHAT YOU LEARN.** The share of the fiscal year total that came from one department, the name of
that department, and the same figure one level down. For one large prime in FY2025 that reads 98.8
percent from one department and 57.0 percent from one sub agency inside it. Under the share the
page prints both halves of the division and how many rows were in the denominator, so you can
redo it yourself.

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
The two agree closely, and where the record contradicts itself, for example an award reporting
full and open competition alongside zero offers, that award is shown as reported and excluded from
the count share with a visible excluded tally.

**THE ACTION.** Stop describing the book as competitively bid without a number. If you are writing
a note, quote the sentence the page prints, which names the denominator as the largest contracts
active in that year, not the company's federal money.

### 3. Testing a management claim about government demand

**SITUATION.** Management guided to growing federal demand. You want an exogenous read.

**WHAT YOU DO.** Read the fiscal year spine, ten columns, one call. Then flip the award type set
control and watch what moves.

**WHAT YOU LEARN.** Obligations by fiscal year on one consistent definition, with the year over
year change published as both years in full plus the signed difference in dollars. Where a rise is
too large to render honestly as a percentage, the page says so and gives you the dollars rather
than a number it cannot stand behind.

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
money, ranked, with the top one as a share of the whole. For one large prime in FY2025 that reads
49.1 percent under one product service code and 60.8 percent under one industry classification.

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
  they differ by hundreds of millions on a large prime. The control is visible, the set is on
  every badge, and it is never a hidden default.
- **Warm the query, then work.** The first call against a cold name can take tens of seconds; the
  same call is under half a second once the upstream cache is warm. Run the search, let it land,
  then change the year or the set.
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

## Honest limits

- **One host, no fallback.** Every figure comes from one government API. If it is down, this page
  shows named failures per panel and no figures. There is no honest offline mode, because there
  is no honest bundled figure: the only bulk alternative is a multi gigabyte archive with no cross
  origin headers and links that expire.
- **The parent and child tree is self declared.** It is what a registrant said about itself in
  registration. It is not audited and it is not consolidation under an accounting standard. It
  goes stale: one large laboratory entity still sits in a defence prime's children list years
  after its management contract moved to a different operator. That example is shown on the page
  rather than hidden.
- **Award lists are top N, never a full enumeration.** One large company's contracts for one year
  run to dozens of pages and more than ten minutes of paging, and the deep pages are the slowest.
  The page takes the largest by value, one page, and says so.
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

## Troubleshooting

**A panel says the source is cold and nothing has happened for twenty seconds.** That is expected
and the message is literal. The heavy endpoints have been measured between eleven and forty two
seconds on a cold cache and under two seconds once warm. The request is still open and it has not
been retried into the ground.

**A panel says the source did not respond and offers Retry.** Real 502 and 504 responses arrive
from this API before a 200 on the same query. The page already retried four times with backoff
before showing you that. Press Retry; it usually lands.

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

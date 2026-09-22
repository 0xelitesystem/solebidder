# Fixtures

Every file in this directory is **hand built**. Not one of them is a recorded API response, and
none of them names a real company, a real award or a real agency.

That is a deliberate distinction and it is worth stating plainly, because a fixture is evidence
and evidence has a provenance too.

## What a hand built fixture is for

The figures in these files were chosen so that the arithmetic can be checked on paper in a few
seconds. Amounts sum to round totals, shares land on values a reader can verify without a
calculator, and every file carries an `arithmetic` block spelling out the expected result and
how it is reached. A test that recomputes 0.75 from 750 over 1000 proves the code implements
the formula the design specifies. That is what these prove, and it is the whole of what they
prove.

## What a hand built fixture cannot do

It cannot prove a published figure. Design 7.2 asks for `sole-source.test.js` and
`concentration.test.js` to recompute the figures quoted in the README from **recorded**
responses, so that a stranger who clones the repository can confirm the published percentage
against the bytes the government API actually returned. That requires a live capture, and a
recorded response is the one thing that cannot be written by hand: a file assembled to look
like a capture is a fabricated provenance, which is precisely the failure this product exists
to make impossible.

So no file here claims to be one. When a capture is taken it belongs in `test/fixtures/recorded/`
with the date and the request that produced it, and the recomputation tests point at it. Until
then the README quotes no specific dollar figure, which is the rule the repository already
follows.

## The awkward cases are fixtures too

Four of these files exist only to pin down behaviour at the edges, because that is where a
money product goes wrong quietly:

- `agency-single.hand.json`, one customer at one hundred percent,
- `agency-empty.hand.json`, an empty result set,
- `agency-negative.hand.json`, a deobligation, which is money committed in an earlier action and
  released back in this one, and is ordinary in this data,
- `over-time.hand.json`, which contains a fiscal year with no awards at all, so that a division
  by zero has somewhere to be tested.

None of those may produce a zero, a blank or the text NaN. Each must produce either a figure or
a named sentence saying why there is no figure.

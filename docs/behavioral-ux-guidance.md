# Uniqus Code — behavioral UX & conversion psychology guidance

Guidance for the AIs (and humans) building Uniqus Code's onboarding, activation,
and pricing/upgrade flows. This is **not** a visual-design doc — see
[`design-language.md`](./design-language.md) for the house look. This is about
**behavior**: what measurably changes whether a visitor signs up, whether a new
user comes back, and whether a user upgrades — grounded in how people actually
decide, not in design taste.

## 0. How to read the confidence tags (read first)

This doc was built from a multi-source research pass that fetched ~17 sources
and ran the highest-value claims through adversarial 3-vote verification
(2-of-3 to kill a claim). The verification step surfaced something important
enough to be a finding in its own right: **most of the specific numbers that
circulate in SaaS growth blogs did not survive scrutiny.** Every claim below is
tagged:

- **[CONFIRMED]** — survived adversarial verification, usually backed by a
  primary source (peer-reviewed study, regulator filing, or the company's own
  named executive on the record).
- **[MIXED]** — the core mechanism is real but a specific extrapolation,
  number, or "this is why X happens" claim attached to it was not supported —
  the corrected version is given.
- **[DEBUNKED]** — actively refuted, listed so it doesn't get reintroduced
  later. **Do not cite these numbers in marketing copy, product docs, or
  design rationale.**

The single biggest pattern from this research: content-marketing SEO blogs
(a handful of recurring domains) are a **systematically unreliable source
class** for quantitative UX claims — they attribute precise-sounding stats to
real institutions (MIT Media Lab, Stanford, NN/g, Gartner, McKinsey) with no
traceable citation, and the same fabricated numbers get copy-pasted across
dozens of sites until they read as established fact. Primary sources (FTC
filings, peer-reviewed marketing-science papers, on-record founder/exec
interviews) held up consistently; anonymous growth-blog stats mostly didn't.
**Apply the same skepticism going forward** — a specific percentage lift
attributed only to "a study" or "research shows" with no link is a yellow flag.

---

## 1. Confirmed mechanisms

### Goal-gradient / endowed-progress effect **[CONFIRMED]**
Motivation to finish a goal increases as someone perceives themselves nearing
it — and *perceived* proximity matters as much as *actual* progress. The
classic evidence: a café loyalty-card field study (Kivetz, Urminsky & Zheng,
2006) gave one group a blank 10-stamp card and another a 12-stamp card with 2
stamps pre-filled — same number of purchases required, but the pre-filled
group finished faster. This is the real mechanism behind progress indicators —
but see §2 for how easy it is to misapply (Superhuman's own progress-bar
experiment found *zero* effect).

### Deferred signup / try-before-you-commit **[CONFIRMED]**
Duolingo's growth lead (Gina Gotthilf, on record) confirmed that moving the
signup screen back so users complete real lesson content first produced **"a
20% increase in DAUs."** The mechanism isn't a vague "loss aversion" gloss —
it's that people commit to something once they've already gotten value from
it, and a value-first funnel converts better than a signup-first one.
Uniqus Code's own landing page already does this (the hero prompt box lets a
visitor start describing an app before any signup wall) — this is worth
protecting as a deliberate choice, not accidentally undoing it.

### Intent-capture personalization **[CONFIRMED]**
Headspace asks new users "what brings you to Headspace?" before anything else,
and uses the answer to personalize the following screens. Confirmed across
five independent teardowns. The mechanism: personalized paths reduce the
perceived irrelevance of onboarding content, which is a bigger drop-off driver
than onboarding *length*.

### Peak-end rule — **[CONFIRMED, but bounded]**
People judge an experience mainly by its most intense moment and how it ends,
not its average or total (Kahneman et al., 1993 cold-water study; corroborated
by a 2003 colonoscopy RCT and a 2022 meta-analysis of 174 samples). **Caveat
that matters here:** the effect is well-established for short, bounded
episodes, but the literature is genuinely split on whether it holds for long,
multi-session relationships — several studies found the *first* impression or
a single standout moment predicts overall judgment better than the ending once
an experience spans many separate sessions. A coding platform used across dozens
of sessions is closer to that second category — don't over-invest in one
flashy "success!" screen at the expense of a consistently good experience
across sessions.

### Framing changes trust and decisions, including with AI **[CONFIRMED]**
How a limitation, error, or constraint is *framed* measurably changes both the
decision made and the trust extended — including in human-AI team settings
specifically (not just general marketing framing). Relevant to how error
messages, usage-limit warnings, and upgrade prompts are worded: the same fact
framed as "you've used 90% of your limit" vs. "you have 10% left" produces
different reactions even though it's the same number.

### Amazon Prime's cancellation flow — an FTC-confirmed cautionary case **[CONFIRMED]**
The FTC's own June 2023 filing states Amazon used "manipulative, coercive, or
deceptive" interface design (dark patterns) to enroll and retain Prime
subscribers, forcing users through a multi-page cancellation flow with repeated
discount/downgrade offers before letting them leave — and that Amazon
leadership *knowingly* slowed internal proposals to simplify cancellation
because it would cost revenue. Amazon settled for **$2.5 billion** in September
2025, three days into trial. This is directly relevant to Uniqus Code's own
"compete on trust" positioning (see `notes/vibe-coding-research-consolidated-2026-06-22.md`)
— an easy, honest downgrade/cancel flow is cheap insurance against both
reputational and regulatory risk, and is consistent with the trust wedge
already chosen for this product.

---

## 2. Mixed / contested — use with caution

### Choice overload / "fewer options always convert better" **[MIXED — mostly doesn't hold]**
The literal Hick's Law finding (reaction time rises with number of choices) is
real and old (Hick 1952, Hyman 1953) but describes simple lab stimulus-response
tasks, not consumer decision-making. The popular claim that it explains
"choice overload" or that more options cause people to abandon a decision
**does not hold up**: a meta-analysis of 63 conditions across 50 experiments
(Scheibehenne, Greifeneder & Todd, 2010, *Journal of Consumer Research*) found
the average choice-overload effect size is statistically indistinguishable
from zero. It only shows up under specific conditions (low expertise, high
similarity between options, high stakes, no clear prior preference) — not as a
blanket rule. **Do not justify a design decision with "fewer options = higher
conversion" as if it were settled science** — it's conditional at best.

### Decoy pricing tiers **[MIXED — the popular version is wrong]**
The specific, widely-repeated claim that a deliberately-inferior middle tier
("the decoy") pushes buyers toward a higher tier is a real academic effect
(Huber, Payne & Puto, 1982) — but the effect's own originators later wrote
that pure decoy setups are **"rare in the marketplace today"**, and a
replication meta-analysis (Yang & Lynn, 2014, 91 attempts across 23 product
classes) found it reliably reproduces in only **11 of 91** attempts, mostly in
narrow lab conditions that don't match a real pricing page. What actually
explains why 3-tier "good/better/best" pricing pages tend to work is more
likely the **compromise effect** (buyers gravitate to a safe middle option to
avoid the extremes) combined with plain **anchoring** (a visible top tier
makes the middle one look reasonable) — not a manufactured "loser" option.

### Gamification and long-term retention **[MIXED]**
Reward mechanics (streaks, badges, points) produce a real short-term
engagement lift, but the evidence that this sustains long-term retention is
weak on its own — one fitness-app study found only 25% of users still engaged
after six months despite gamified elements. The pattern across sources: reward
mechanics work when they're tied to intrinsic, self-evident value ("I got
better at this") and when the reward system is legible to the user (users are
more forgiving of a rewards system they understand), not as a substitute for
the product actually being useful.

### Progress bars / checklists as an activation lever **[MIXED — can backfire]**
See Superhuman's own case in §3 — this is worth reading before adding a
progress-bar-style onboarding checklist anywhere in the product.

### Decision fatigue as a general phenomenon **[MIXED]**
A number of the refuted claims below leaned on "decision fatigue" as their
mechanism. A 2025 field study using large-scale real-world professional
decision data found **no credible evidence for decision fatigue** as a general
effect. Treat it as unsettled, not as an established fact to design around.

---

## 3. Real company lessons worth applying

### Superhuman: the progress-bar/checklist approach they tried and abandoned
Superhuman's own head of growth (Gaurav Vohra, First Round Review) has
publicly described testing a checklist/progress-bar-style onboarding "side
quest" and finding **"zero impact... no change in activation rates"** — only
30% of users completed all the optional tasks. They replaced it with
mandatory, non-skippable, full-screen onboarding steps, which lifted
completion from 30%→98% and feature opt-in from 45%→80%. **The lesson that
actually held up under scrutiny is the opposite of the common folklore**:
optional, gamified progress tracking didn't move the needle for them; forcing
a short, complete, no-skip setup did.

### Headspace: value before paywall
Headspace's current onboarding (per a 2026 case study) leads with a felt
3-minute guided breathing session — a real value moment — before showing any
paywall, and its free tier includes a full intro course. The lesson: put a
genuine "this works" moment before asking for money, not after.

### OpenAI / ChatGPT: usage caps as the upgrade lever, not features
ChatGPT's free tier is usage-capped (a message allowance over a rolling
window) rather than feature-gated, and the upgrade screen visually contrasts
an "inviting," highlighted paid plan against a comparatively dead-looking free
one — plus explicitly states what capability the user is about to lose. This
is a **usage-based**, not feature-based, upgrade trigger — directly relevant
to a platform billed on turns/tokens/VM time rather than a fixed feature list.

### AI products need a different pricing psychology than classic SaaS
Unlike traditional SaaS — where serving one more free user costs close to
nothing — AI products have real, variable marginal cost (GPU compute) per
free user. That changes the right default: gate on **usage intensity** (Google
AI's Plus/Pro/Ultra tiers scale with volume and context window, not features;
Midjourney's Fast vs. Relax Mode sells compute priority, not extra
capability; Intercom's Fin prices per resolved outcome, not per seat) rather
than a traditional feature-locked tier ladder. The recommended framing from
this research: gate outcomes and effort saved, not raw access — "this
collapsed a multi-step task into one click" is a more defensible paywall
moment than an arbitrary feature wall.

---

## 4. Debunked — do not cite these

These specific numbers circulate widely in SaaS-growth content but were
traced to sourceless marketing blogs and refuted 3-0 or 2-1 under adversarial
verification. Several were attributed to companies whose own on-record
executives describe something different, or don't mention the number at all.

- **"Duolingo streak users hit 90% D30 retention vs. 20% without a streak."**
  No primary source states this, and it's mathematically inconsistent with
  Duolingo's own disclosed ~12% company-wide D30 retention. (Duolingo *has*
  disclosed real streak numbers elsewhere — e.g. "3.6x more likely to
  complete a course" — use those if a streak stat is needed, not this one.)
- **"Slack teams that reach value in 5 minutes hit 85% 30-day retention vs.
  35% for teams taking 30+ minutes."** No primary source. Slack's actual
  on-record metric (Stewart Butterfield) is entirely different: teams that
  exchange 2,000 messages hit ~93% retention — a message-count threshold, not
  a time-to-value one.
- **"Dropbox's role-based signup segmentation produced 40% higher activation,
  60% faster referral, 25% better 30-day retention."** Dropbox's own former
  head of growth design, who ran this exact initiative, has described it at
  length in two interviews and never cites any of these numbers.
- **"Superhuman uses a visual progress bar tracking 50 clearing actions to
  exploit the endowed-progress effect."** Conflates two unrelated facts; see
  §3 for what Superhuman actually found (progress-bar onboarding had zero
  effect for them).
- **"A ProfitWell study found positive onboarding increases retention by
  7.2%."** This exact figure appears nowhere in any traceable version of that
  study; independent reconstructions cite entirely different numbers.
- **"Carnegie Mellon's HCI Institute found each added onboarding choice raises
  complexity 25-40%, and 3-4+ choices drop completion by up to 60%."** This
  exact phrase returns no hits anywhere else — a fabricated citation.
- **"Notion's design lead" advice on reciprocity** — misattributed (the person
  quoted is Notion's Head of *Product Growth*, not a design lead) and
  misquoted; also not framed by her as a "psychological mechanism," just
  practitioner advice.
- **"Hick's Law is the mechanism behind choice-overload/decision paralysis."**
  Conflates two separate, unrelated research literatures — see §2.

**Pattern to watch for going forward:** all of the debunked claims above traced
back to one of a handful of recurring SaaS-growth-blog domains
(`saasfactor.co`, `design-den` on Medium, `thesigma.co`, `notoriousplg.ai`,
`tearthemdown` on Medium, `uxcam.com`). None of that means those sites are
useless for *ideas*, but a specific percentage or named-study claim from one of
them should be treated as unverified until corroborated by a primary source.

---

## 5. Applying this to Uniqus Code

Given the actual product shape — a chat-based agent workspace, a live preview,
and usage/subscription-based pricing — the strongest-evidenced principles
above point toward:

- **Protect the ungated hero prompt** on the landing page (already in place):
  letting a visitor describe an app and see something happen before hitting a
  signup wall is the single most consistently-evidenced onboarding lever found
  in this research (Duolingo's confirmed 20% DAU lift from the same pattern).
- **Time-to-first-working-preview is the metric to optimize**, not a
  progress-percentage or checklist UI. The goal-gradient effect is about
  *perceived* nearness to a working result — getting a user to a live preview
  fast creates that perception directly; a progress bar is a weaker proxy for
  the same thing and can backfire (Superhuman).
  If an onboarding checklist is used anywhere, make it either fully optional
  with no assumed effect on activation, or mandatory and short — the
  "half-optional, gamified" middle ground is the version that demonstrably
  failed for Superhuman.
- **Frame usage limits and upgrade prompts around value, not raw quota.**
  Since Uniqus Code bills on agent turns/tokens/VM time (real marginal cost
  per user, like other AI products, not classic zero-marginal-cost SaaS), the
  OpenAI and Google/Midjourney/Intercom pattern applies directly: gate on
  usage intensity and describe what the user is about to lose or gain in
  outcome terms ("this next step needs more build capacity") rather than an
  arbitrary feature wall or an unexplained decoy tier.
- **Don't lean on "3-tier decoy pricing" as if it's a solved trick.** If a
  3-tier plan page is used, the more defensible mechanism is anchoring (a
  visible top tier) plus the compromise effect (a reasonable middle option),
  not a deliberately-weak middle tier.
- **Make downgrade/cancel flows easy, not sticky.** This is both the
  best-evidenced regulatory risk in this research (Amazon's $2.5B settlement)
  and consistent with the product's own "compete on trust" positioning — an
  honest, low-friction cancel path is a differentiator against incumbents
  who've been burned here, not just risk mitigation.
- **Don't over-engineer a single "big finish" moment** (e.g. an elaborate
  publish/deploy confirmation animation) at the expense of consistency across
  sessions — the peak-end rule's evidence weakens exactly for multi-session
  products like this one. A reliably good experience across many sessions
  beats one flashy ending.
- **Treat any specific conversion-lift percentage from a growth blog as
  unverified** before using it to justify a product decision or in external
  marketing copy — re-derive it from a primary source or an internal A/B test
  instead.

---

## 6. Methodology

Produced via a 5-phase deep-research pass (Scope → 5 parallel web-search
angles → source fetch & claim extraction → 3-vote adversarial verification on
the highest-value claims → manual synthesis). ~17 sources were fetched in
full; the highest-value ~25 claims were adversarially verified. The workflow's
own automated synthesis step failed (returned placeholder stub output) on this
run, so this document was hand-assembled directly from the verified claim data
rather than the broken auto-summary — every confidence tag above reflects the
actual per-claim vote outcome, not an LLM's unchecked gloss.

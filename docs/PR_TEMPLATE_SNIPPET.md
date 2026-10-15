# PR template snippet — success metric (proposal, NOT committed to any repo)

Today none of the 273 production PRs in the last 60 days declares a success metric, so the dashboard
can only *infer* one from changed paths (`config/path-map.yml`, shown with an "inferred" badge).
If the team agrees, add this block to the PR templates of `www`, `api`, `mobile-ios`, `mobile-android`:

```markdown
## Success metric
<!-- One line, parsed by the Pomelo Platform Analyzer. Leave "n/a" for refactors/chores. -->
Success metric: <metric> | Surface: <section> | Platform: <web/ios/android> | Expected direction: <up/down>
Decision: DEC-<id>   <!-- optional: links this PR to the dashboard decision log -->
```

Accepted `<metric>` wording (keyword-matched): bounce rate · non-bounce CR / conversion · AOV / basket ·
revenue per session · PDP add-to-bag rate · bag→checkout rate · checkout→payment rate.
Surfaces: home, listing, search, pdp, bag, checkout, account, content, platform.

Example:
`Success metric: PDP add to bag rate | Surface: pdp | Platform: web | Expected direction: up`

The dashboard then shows the release card with this metric's change vs the 14-day baseline, a 95% interval,
sample sizes and overlapping releases. It never claims the PR caused the change.

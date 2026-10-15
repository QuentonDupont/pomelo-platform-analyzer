# GitHub production releases (discovery, 2026-10-08)

Source: read-only `gh api` calls against org `pomelofashion`. Window: 2026-08-09 to 2026-10-08.
Data: `discovery/github_releases.json` (76 releases, one record per production go-live, with the PRs it shipped).

## Repos per platform

| Platform | Repo | Notes |
|---|---|---|
| web | `www` | Storefront. Merging to master runs semantic-release (`release.yml`), which creates a GitHub release; that triggers `deploy-pre-prod.yml` (on `release: released`). |
| backend | `api` | Main API (Beanstalk `api-ecs-production`). |
| backend | `api-next` | Monorepo of services with per-service tags (`voucher-validation-v8@x`, `wishlist-get-v8@x`). GitHub only has a `deploy-pre-production.yml` workflow, so the production signal is unknown and this repo was **not imported**. |
| ios | `mobile-ios` | |
| android | `mobile-android` | |

Other active repos that were not imported: `apollo` (admin/back office, which has its own pre-release flow), `henry`, `nimbus`, `multivac`, `neon`, `starship`, `pos-frontend`, `netsuite(-next)`.

## Which signal shows a production go-live

The **GitHub Deployments API is empty** for every repo (`www`, `api`, `api-next`, `mobile-android`). `mobile-ios` has only 2 deployments, both from 2020. **GitHub releases are not production releases.** Semantic-release creates one on every merge, and each one deploys to pre-prod only.

| Repo | Signal used (`signal`) | Evidence | Production releases in 60 days | PRs | Releases with more than 1 PR |
|---|---|---|---|---|---|
| www | `workflow_run`: successful runs of `deploy.yml` (event `repository_dispatch` type `deploy`, sent from outside GitHub) | The run log shows `ENV_NAME=www-svc-production` and `VERSION_LABEL=<semver>`. `go_live_at` = when the run finished (`updated_at`). | 44 | 155 | 25 |
| api | `workflow_run`: successful runs of `deploy-production.yml` (dispatch type `production-deployment`) | The run log shows `VERSION_LABEL=api-production-<sha>-<semver>` and `ENV_NAME=api-ecs-production`. | 16 | 80 | 13 |
| mobile-ios | `workflow_run`: successful runs of `ci-production.yaml` (dispatch type `release`) | Builds the app and sends it to the App Store. `release_id` = the master HEAD SHA at dispatch time. | 14 | 26 | 4 |
| mobile-android | `tag` (weak signal) | Every `deploy_production.yml` run in the window **failed** (`AWS_CONFIG` / `AWS_AMPLIFY_CONFIG` empty in Vault). `release.yml` fails too. The last tag is v4.88.13 (2026-09-26). | 2 | 12 | 2 |

How PRs are matched to a release: compare the previous production version with this one (`compare/prev...this`), then pull PR numbers from commit subjects (`(#123)` or `Merge pull request #123`), skipping `chore(release)` commits. `changed_top_dirs` is the first 2 path segments of each changed file, capped at 10. `success_metric_declared` is a regex over the PR body (success metric / KPI / expected impact). **It is false for all 273 PRs**, so this practice does not exist yet.

## Gaps and uncertainties

1. **Run logs expire after about 30 days.** For www deploys before 2026-09-11 and api deploys before 2026-09-14 the log is gone, and so is the dispatch `client_payload`. For those, `release_id` is inferred as the latest GitHub release published before the dispatch, and the record has a `note` saying so. As a result, one api version (v1.1149.6, a hotfix line) appears after v1.1150.0. The www and api production windows start 2026-08-18 and 2026-08-13 because the earliest successful runs in the window come from those dates.
2. **www go-live time** is when the run finished. That includes the Beanstalk rollout and verification, which take about 20 minutes. The `Set version in Consul` step is the true switch point, but its time is only in the logs.
3. **iOS** `go_live_at` is when the App Store build/upload finished. The real App Store release (review plus phased rollout) is not visible in GitHub. The dispatch `head_sha` is master HEAD at dispatch, which may not be the shipped commit.
4. **Android** has no working production signal in GitHub. Commits #3539–#3543 (2026-09-27 to 2026-10-01) are on master without a tag, so whether they shipped is unknown. Play Console is needed.
5. **api-next**: there is no production deploy workflow in GitHub, so it is not imported.
6. Releases with `pr_count` 0 (www 1, iOS 1) contain only release or merge commits, such as redeploys or version-only bumps.
7. Redeploys of the same version keep only the first successful run.

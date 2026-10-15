# Open Questions

1. **Bounce SQL.** `bounces`, `non_bounces` and `bounce_rate` are Cube.js measures on cube `segment_session` (Superset db "Cube-PROD"). We need the Cube model source (repo or Cube Playground) for the exact rule. Chart 5012 uses `session_duration > 10` as "ex bounce". Is that the same rule?
2. **`bot_flag` is always false** in dataset 63. Are bots removed upstream, or is the flag broken? Web sessions jumped about 51% in wk 28 Sep (mostly bounces, TH and SG Web Mobile). Is this bot traffic?
3. **Market mapping.** id_shop 4 and 10 both report country "Global". Shop 12 = HK (online_sales shop_name "Pomelo HK"). Is 4 = Global USD and 10 = AU? online_sales returned no orders for shops 4 and 10 in wk 14 Sep, while segment_session attributes 29 iOS orders to shop 4.
4. **Order attribution in the brief.** Which source and filter produced 174/163 app and 33/28 web orders, and what makes an order "eligible" (971)? Candidates: `is_billable_order`, `exclude_store_staff_uniform_and_influencer_orders`, excluding platform 'Apollo', `test`, `is_fraud_customer`.
5. **Timezone.** Is `session_start_date` Bangkok local for every market, including SG/HK/AU? The sankey SQL adds +7h to RudderStack UTC timestamps. `online_sales.order_date` timezone is unknown.
6. **Site section.** No page, path or landing-page dimension exists in dataset 63. A section breakdown needs RudderStack page/screen events. Do `pages` / `screens` tables exist?
7. **RudderStack location.** Tables seen in virtual dataset SQL on Superset database "PostgreSQL" (not Cube-PROD) are in schemas `rudderstack_web_production`, `rudderstack_ios` and `rudderstack_android`. Tables include `product_list_viewed` (with `ref_type`), `product_viewed`, `product_added`, `quick_add_to_cart`, `cart_viewed`, `wishlist_product_added_to_cart`, `shipping_address_selected`, `payment_method_selected`, `payment_methods_viewed`, `order_completed`, `sign_in_viewed` and `logged_in`. Session table: `dwh.fact_segment_session`. Other tables: `ods_production.pml_feed`, `dwh.*` sankey tables. `list_datasets` search for "rudder" and "page" returned 0 datasets. No `pages`, `tracks` or `screens` dataset is exposed, and `query_dataset` cannot query raw tables.
8. Android identifier in RudderStack is `context_traits_customer_id` (iOS/web use `user_id`). This matters for any session join.
9. Charts 4988–4999 are on dashboard **527** (Sankey), not 528. Dashboard 528's charts are 5001–5015. Confirm which set the bounce dashboard should mirror.

## GitHub

1. **What sends the production `repository_dispatch` events** for www (`deploy`), api (`production-deployment`) and mobile-ios (`release`)? Is it a Slack bot, the TechOps portal or a person? That system probably keeps a permanent log (version, env, time). GitHub run logs expire after about 30 days, so deploys before mid-Sep 2026 have an *inferred* version.
2. **Is www "go-live" the end of the `deploy.yml` run, or the `Set version in Consul` step?** The two are about 20 minutes apart.
3. **iOS go-live**: `ci-production.yaml` only builds and submits to the App Store. Can we get App Store Connect release / phased-rollout dates?
4. **Android**: all `deploy_production.yml` runs since 2026-09-05 failed (Vault `AWS_CONFIG` / `AWS_AMPLIFY_CONFIG` empty), and `release.yml` fails too. How is Android shipping to Play now? We need Play Console release history. Commits #3539–#3543 are untagged.
5. **api-next** has no production deploy workflow in GitHub. Where are its services deployed to production, and how can we observe it?
6. **Success metrics**: none of the 273 PRs declare a success metric or KPI in the body. Should the PR template add this field so the dashboard can attribute impact?
7. **Scope**: should `apollo`, `henry` or `nimbus` releases also be tracked as possible bounce drivers?

## Phase 2 data pull

1. **Eligible orders.** The brief reproduces with `is_billable_order AND platform != 'Apollo' AND simple_order_status != 'Cancelled'` and *without* the staff/uniform/influencer exclusion. Is including staff-flagged orders (about 18 in the 30 days) intended? Should "eligible" exclude them?
2. **Order date timezone.** `online_sales.order_date` / `order_date_date` timezone is still undocumented. The weekly brief numbers match when we treat it as a Bangkok date. Confirm for SG/HK.
3. **Shop 10 = AU?** It has sessions in segment_session but zero online_sales orders from 10 Aug to 7 Oct. Is AU checkout routed to shop 4 (Global USD)?
4. **No day column in dataset 63.** `session_start_date` is a raw timestamp and Superset/Cube exposes no day-truncated dimension, so daily traffic needs one query per day (about 30–60 s each, and the first call often times out at 30 s). Can a `session_start_day` dimension be added to the Cube model, or can the dashboard read a pre-aggregated table? Today `traffic_daily.json` covers only 18 of 59 days (10–28 Aug, missing 25 Aug).
5. **Funnel stages in dataset 63** are event counts only (`total_product_views`, `total_number_product_list_viewed`, `total_number_products_clicked`, `total_number_added_to_bag`, `total_number_product_searches`). There is no checkout or payment measure, and no distinct-session-per-stage measure. Distinct-session funnels exist only in the sankey virtual datasets 284/285/286. Those start 2026-09-01, are not filtered by shop or bot, and web is not split into desktop and mobile.
6. **Sankey "Hero Banner"** is a synthetic stage-3 event that duplicates `product_list_viewed` rows whose ref_type is not one of home_slider, home_masonry, navigation or app_feed (web/iOS), or that join `pml_feed.page IN ('hero','banner')` (Android). Entry-source shares that include it double-count. Should it be dropped for the dashboard?
7. **Android sankey identifier.** The Android SQL joins on `context_traits_id_customer` and sessions on `user_id`/`device_id`. Is the join rate comparable to iOS and web? Android funnel volumes look low.
8. **Channel and customer mix.** In 10–28 Aug, `channel_group` and `existing_customer` were never null in dataset 63 (channel values: Organic, Other, Other Engagement, Engagement Push, Facebook, Line, Google AdWords, PR & Social). "Other" is large. What does it contain?
9. **Shared session.** Another agent was querying Superset in parallel during this pull (online_sales hourly). Concurrent Cube queries returned HTTP 400 when more than about 3 ran at once.

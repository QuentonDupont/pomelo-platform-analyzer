# Data Dictionary (Phase 0 discovery, 2026-10-08)

Source: Pomelo Superset (read-only MCP). Raw dumps in `discovery/superset/`.

## Dataset 63: traffic / sessions

- Superset dataset 63 = **`public.segment_session`** on database **"Cube-PROD"** (id 3, Postgres-wire **Cube.js SQL API**). It is a physical table with no SQL.
- `main_dttm_col` = `session_start_date` (TIMESTAMP WITHOUT TIME ZONE). Other dttm columns: `transaction_date`, `product_list_viewed_timestamp`. Virtual column `session_start_month = DATE_TRUNC('month', session_start_date)`.
- The only saved Superset metric is `count = COUNT(*)`. **Every KPI is a Cube measure that shows up as a column.** If you select it with dimensions, Cube aggregates it (Superset emits `GROUP BY <dims>, <measures>` and Cube handles that). The measure SQL lives in the **Cube data model, not in Superset**, so it is not visible from here.
- Upstream (inferred from the sankey virtual datasets 276–286): `dwh.fact_segment_session` (`session_start`, `session_end`, `session_duration`, `app_name` IN 'Pomelo - IOS' / 'Pomelo - Android' / 'Pomelo - Web', `user_id`, `device_id`). Session id there = `coalesce(user_id, device_id) || session_start || session_end`.

### Timezone
- `session_start_date` is **most likely Bangkok local time (UTC+7)**. Evidence: the sankey SQL joins RudderStack event `timestamp` (UTC) as `event_time + INTERVAL '7 hour'` against `fact_segment_session.session_start`. The brief's Bangkok-date weekly session counts also reproduce exactly when filtering raw `session_start_date` (see RECONCILIATION.md). Not formally documented.

### Measures (Cube measures exposed as columns; definitions = NOT FOUND, they live in the Cube model)
| Column | Type | Meaning (from name + observed behaviour) | Definition |
|---|---|---|---|
| `total_sessions` | BIGINT | count of sessions | NOT FOUND — definition pending (Cube model) |
| `bounces` | BIGINT | bounced sessions | **NOT FOUND — definition pending** (Cube model). Observed: `bounces + non_bounces = total_sessions` exactly in every row |
| `non_bounces` | BIGINT | non-bounced sessions | NOT FOUND — definition pending |
| `bounce_rate` | NUMERIC | bounces / total_sessions (presumably) | NOT FOUND — definition pending. Chart 5007 plots it as `SUM(bounce_rate)` by day |
| `bounced_users`, `bounced_signed_in_users`, `total_users_not_bounce`, `total_users`, `distinct_signed_in_users` | BIGINT | user-level counts | NOT FOUND |
| `gross_orders` | NUMERIC | orders attributed to sessions | NOT FOUND (session-attributed; differs from online_sales.gross_orders) |
| `gross_s2s_orders`, `gross_eComm_orders`, `gross_offline_orders`, `count_orders_for_channel` | | order variants | NOT FOUND (`gross_eComm_orders` returned 0 for the test weeks) |
| `revenue_after_discount_in_usd` | NUMERIC | session-attributed revenue in USD | NOT FOUND |
| `session_conversion`, `session_conversion_ex_bounce`, `conversion_rate_for_channel` | NUMERIC | CR ratios | NOT FOUND |
| `session_duration`, `avg_session_duration` | NUMERIC | seconds (assumed) | NOT FOUND |
| funnel measures (`total_product_views`, `total_number_added_to_bag`, `percent_user_*`, …) | | | NOT FOUND |

### Bounce definition (CRITICAL)
- **Exact SQL: NOT FOUND — definition pending.** `bounces` / `non_bounces` / `bounce_rate` are Cube measures; their SQL is in the Cube repo/model, which this Superset account cannot see.
- **It does apply to app sessions.** iOS and Android rows have non-zero `bounces` (e.g. TH iOS wk 14 Sep: 6,692 of 16,178), and dashboard 528 has iOS and Android bounce-rate charts.
- **Hint (not a definition):** chart 5012 "All Platforms Conversion Rate (Ex Bounces)" excludes bounces with `WHERE session_duration > 10`. That points to a duration-based rule (≤10 s means bounce), but it may not match the Cube `bounces` measure. Sessions with null `app_name_short_version` are 100% bounces (`zero_length` / empty sessions?). A dimension `zero_length` (BOOLEAN) also exists.
- The sankey SQL treats `session_duration != 0` as a "real" session.

### Site section / landing page
- **NOT FOUND in dataset 63.** It has no page path, page_type or landing-page column. `dynamic_session_start` is a timestamp string, not a section.
- Closest candidate: RudderStack `product_list_viewed.ref_type` (values seen in SQL: `home_slider`, `home_masonry`, `navigation`, `app_feed`, plus others mapped to "Hero Banner"), used by sankey datasets 283–286. That is the entry *list source*, not a URL-based section.

### Dimension columns (dataset 63)
| Column | Values observed (wk 14–20 Sep 2026) |
|---|---|
| `app_name_short_version` (platform) | `iOS`, `Android`, `Web Desktop`, `Web Mobile`, null (all-bounce stubs) |
| `platform_group` | `App`, `Web` |
| `id_shop` (market) | 1=TH (Pomelo), 2=SG, 4=country "Global" (Global USD?), 5=Indonesia, 10="Global" (assumed AU, unconfirmed), 11=Malaysia, 12=HK (shop_name "Pomelo HK" in online_sales), 14=Philippines, 15=Cambodia |
| `country` | Thailand, Singapore, Global, Indonesia, Malaysia, Philippines, Cambodia |
| `country_group` | Thailand, Singapore, Indonesia, Others |
| `bot_flag` | **only `false` present.** Either bots are already removed upstream or the flag is never true |
| others (not enumerated) | `country_platform`, `country_arrangements`, `channel_group`, `Channel`, `channel_grouped_name`, `open_attribution_*` (channel/medium/campaign/partner), `social_paid_flag`, `team`, `existing_customer`, `customer_purchase_behavior`, `tier_name`, `potential_tier`, `was_signed_in`, `was_add_to_cart`, `was_purchase_made`, `zero_length`, `app_only`, `app_name`, `pomelo_man`, `s2s_customer`, `ecomm_customer`, `is_billable_order`, `exclude_store_staff_uniform_and_influencer_orders`, `product_list_viewed_app_version`, `home_feed_*_version_comparison` |

There is no device-model or new-vs-returning column beyond `existing_customer` / `customer_purchase_behavior`. App version is only available as `product_list_viewed_app_version`.

## Dataset 33: online_sales
- `public.online_sales` on Cube-PROD, 957 columns, `main_dttm_col` = `order_date` (timezone not documented). Its only saved metric is `count`. Measures appear as columns again: `gross_orders`, `revenue_after_discount_in_USD`, `gross_revenue_in_USD`, `net_revenue_in_USD`, etc.
- Dimensions: `platform` (iOS, Android, Web Desktop, Web Mobile, **Apollo** = admin/offline-created), `id_shop`, `shop_name`, `country`, `is_billable_order`, `exclude_store_staff_uniform_and_influencer_orders`, `test`, `is_fraud_customer`, `segment_session_start_date`.
- Orders here are by order date and are **not** session-attributed. For example, TH iOS has 151 gross orders for wk 14 Sep against 123 session-attributed in dataset 63.

## Charts inspected
- 5007 iOS Daily Bounce Rate: `SUM(bounce_rate)` by day, filtered `app_name_short_version IN ('iOS')`, dataset 63.
- 5012 All Platforms CR (Ex Bounces): `SUM(session_conversion)`, `WHERE session_duration > 10`, dataset 63.
- 4988 and 4999 are sankeys (dashboard 527) over virtual SQL datasets 276 and 286. Charts 4991, 4993–4998 are on the same dashboard and were not dumped.

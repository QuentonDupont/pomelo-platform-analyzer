# Funnel Event Map (sankey datasets, 2026-10-09)

Source: SQL of the Superset virtual datasets on db "PostgreSQL" (id 2), dumped in
`discovery/superset/datasets_sankey_search.json` (re-checked for 286 with `get_dataset`).
Observed values come from `discovery/snapshots/funnel_transitions.json` (2026-09-01 to 2026-10-08).
Anything marked **unconfirmed** is inference, not something the SQL states.

## 0. How the session sankeys (284 iOS / 285 Android / 286 web / 283 overall) work

- Sessions: `dwh.fact_segment_session WHERE session_duration != 0 AND DATE(session_start) >= DATE('2026-09-01')`.
  The session key is `CASE WHEN user_id IS NOT NULL THEN user_id ELSE device_id END || session_start || session_end`.
  There is no shop/market or bot filter.
- Events: RudderStack tables `rudderstack_ios.*`, `rudderstack_android.*`, `rudderstack_web_production.*`. The identifier is
  `COALESCE(user_id, anonymous_id)`. Android uses `COALESCE(context_traits_id_customer, anonymous_id)`.
- Events are joined to a session when the identifier matches and `event_time + 7h` falls within the session window ±30 min.
- `ranked`/`dedupe` keeps only the **first event per (session, stage)** (`ROW_NUMBER() OVER (PARTITION BY session_id, stage ORDER BY event_time)`, `seq = 1`).
  As a result, each session has at most one stage-3 entry source.
- `next_step` links each stage to the **next higher stage the session reached** (`MIN(c.stage) WHERE c.stage > a.stage`).
  The output `value` is `COUNT(DISTINCT session_id)` grouped by source, target, stages and `event_date` (computed as `DATE(event_time + 7h)`, so Bangkok time).
- Stages: 1 Sign in, 2 Login (iOS `CONCAT(login_method,' Login')`; Android is one event per method: Google/Facebook/Email/Phone/Line),
  3 product_list_viewed source, 4 Product Viewed, 5 Quick Add to Cart, 6 Product Added, 7 Cart Viewed,
  8 Wishlist Viewed (table `wishlist_product_added_to_cart`), 9 Shipping Address Selected, 10 Payment Methods Viewed (app only),
  11 Payment Method Selected, 12 Order Completed.

## (a) product_list_viewed.ref_type values, and what gets folded into "Hero Banner"

Stage 3 emits the raw ref_type **plus** a synthetic `'Hero Banner'` row from the same `product_list_viewed` event, at the **same timestamp**.

**Web (286, also 215/208/218/283)**: Hero Banner is a NOT IN catch-all.
```sql
SELECT COALESCE(user_id::VARCHAR, anonymous_id::VARCHAR), ref_type AS event, 3, "timestamp"
FROM rudderstack_web_production.product_list_viewed
UNION ALL
SELECT COALESCE(user_id::VARCHAR, anonymous_id::VARCHAR), 'Hero Banner', 3, "timestamp"
FROM rudderstack_web_production.product_list_viewed
WHERE ref_type NOT IN ('home_slider', 'home_masonry', 'navigation', 'app_feed')
```
- On web, **every ref_type except home_slider / home_masonry / navigation / app_feed is also labelled "Hero Banner"**.
  That covers external, special_awareness, search, zero_search_result, pdp_just_for_you, category_similar_products, best_sellers,
  skinny_banner, category, error_page, undefined, searchbox and lookbook_shop_look.
  So web "Hero Banner" means "any non-home-feed, non-nav list view". It is not a banner signal.
- Observed web stage-3 values (sessions, Sep 1 to Oct 7): Hero Banner 3,930, navigation 3,270, app_feed 2,899, external 2,076,
  special_awareness 708, search 491, zero_search_result 197, pdp_just_for_you 113, category_similar_products 97,
  best_sellers 51, skinny_banner 44, undefined 22, category 17, error_page 16, searchbox 4, lookbook_shop_look 2, home_slider 1.
  **home_masonry never appears.**

**iOS (284) / Android (285)**: Hero Banner is defined by a CMS join.
```sql
SELECT COALESCE(plv.user_id::VARCHAR, plv.anonymous_id::VARCHAR), 'Hero Banner' AS event, plv.ref_type AS ref_type, 3 AS stage, plv."timestamp", 'IOS'
FROM rudderstack_ios.product_list_viewed plv
LEFT JOIN ods_production.pml_feed pf ON plv.ref_id = pf.id_feed
WHERE pf.page IN ('hero', 'banner')
  AND plv.ref_type NOT IN ('lookbook_shop', 'skinny_banner')
```
- On app, "Hero Banner" means a list view whose `ref_id` is a `pml_feed` row with `page IN ('hero','banner')`, excluding lookbook_shop and skinny_banner.
- Observed iOS values: special_awareness 31,634, app_feed 10,806, external 1,763, navigation 375, Hero Banner 263, lookbook 192,
  full_screen_banner 102, searchbox 99, pdp_similar_products 41, skinny_banner 26, pdp_just_for_you 15, broken_deeplink 9,
  best_sellers 6, pdp_manufacturer 5.
- Observed Android values: special_awareness 1,871, external 720, navigation 33, app_feed 26, Hero Banner 10, NULL 3, searchbox 2,
  pdp_just_for_you 2, plus single sessions for pdp_shop_the_look, profile, landing_page and pdp_similar_products.

**Caveat (all platforms):** the Hero Banner row and its raw ref_type row share a timestamp. `dedupe` keeps one row per stage, so which label wins is
**arbitrary (a tie in ROW_NUMBER)**. Treat the Hero Banner and raw ref_type counts as one combined, non-additive split:
- On web, Hero Banner absorbs an unknown share of external, special_awareness, search and the rest.
- On app, Hero Banner is under-counted. It almost always loses the tie (263 iOS sessions), so app Hero Banner figures are a floor, not a measure.

## (b) What is "Home Feed"?

- Dataset 211 `ios_sankey_home_feed` (older, event-level, not session-joined) defines the home feed as **`ref_type = 'app_feed'`**.
  It splits app_feed list views by the CMS page:
```sql
SELECT anonymous_id, 'Category Feed', null as ref_type, 3 AS stage, timestamp
FROM rudderstack_ios.product_list_viewed plv
  left join (select id_feed, feed_type, page from ods_production.pml_feed) pf on plv.ref_id = pf.id_feed
  where pf.page not in ('hero','banner') and plv.ref_type in ('app_feed')
UNION ALL
SELECT anonymous_id, 'Hero Banner', ref_type, 3 AS stage, timestamp
FROM rudderstack_ios.product_list_viewed plv
  left join (...) pf on plv.ref_id = pf.id_feed
  where pf.page in ('hero','banner') and plv.ref_type not in ('lookbook_shop','skinny_banner')
```
  211 uses the same stages 1 to 12 as the others. Its stage 3 contains only "Category Feed" (non-hero app_feed tiles) and "Hero Banner".
  It counts `COUNT(DISTINCT anonymous_id)` by `DATE(event_time)` (UTC, not Bangkok). It has no session join. Dataset 207 (Android) uses the same pattern.
- Home Feed = `app_feed`, with high confidence for the app. On iOS, Home Feed = app_feed "Category Feed" tiles + app_feed "Hero Banner" tiles.
  In 284/285 the raw `app_feed` label covers both, minus any sessions where the tied Hero Banner row won.
- `home_masonry` and `home_slider` appear **only** in the web Hero Banner exclusion list. They were probably earlier web home-page modules and are now unused (**unconfirmed**).
  They are not observed in Sep/Oct data (home_slider 1 session, home_masonry 0).
- Web also emits `app_feed` (2,899 sessions). That suggests the web home feed reuses the `app_feed` ref_type (**unconfirmed**).
- Dataset 213/215 also attach a `'Category Feed'` *label column* to raw ref_type rows, as in `ref_type AS event, 'Category Feed' AS ref_type`.
  That column is not used in the output, so "Category Feed" is not a distinct event in 213, 215 or 284.

## (c) Is there a "Special Showcase"?

- No dataset SQL contains "showcase" or "special" as a literal label. The only related value is the **raw ref_type `special_awareness`**, which the SQL passes through untouched.
- `special_awareness` is the largest app entry source: 31,634 iOS sessions (≈70% of iOS stage-3 entries) and 1,871 Android sessions.
  On web it is 708 sessions, and part of web Hero Banner because it is not excluded.
- Mapping "Special Showcase" to `special_awareness` is **unconfirmed**. The name and its dominance as the first app list view suggest a
  home-screen campaign or showcase module, but nothing in Superset documents it. Confirm with the app team or the RudderStack tracking plan (`docs/RUDDERSTACK.md`).
- Other banner-like raw values exist and are not folded into Hero Banner on app: `full_screen_banner`, `skinny_banner` (explicitly excluded) and `lookbook`.

## (d) Does any dataset split guest and signed-in sessions in the event funnel?

- **No.** None of 199, 203 to 208, 211, 213 to 218 or 276 to 286 outputs a signed-in or guest column.
  - The older datasets (199 to 218) key on `anonymous_id` only.
  - The session datasets (276 to 286) key on `COALESCE(user_id, anonymous_id)` (Android: `context_traits_id_customer`) against a session id built from `user_id` else `device_id`.
- The only signed-in proxy in the funnel is reaching stage 1 (Sign in) or stage 2 (Login) in the session. That catches sessions that log in *during* the session, not users who were already signed in.
- Signed-in state is available only in Cube dataset 63 (`was_signed_in`), which is used in `session_flags_weekly.json` and `user_funnel_weekly.json`.
- Possible guest under-count (**unconfirmed**): a guest session's identifier is `device_id`, while a guest event's identifier is `anonymous_id`.
  A guest session only picks up events if `anonymous_id = device_id`.
  - Web sankey volume is much lower than web sessions in dataset 63. For example, it shows about 3.3k sessions per week reaching Product Viewed from a list, against about 40k or more web sessions.
  - It jumps about 4x from 2026-09-15, when web guest add-to-bag in dataset 63 also starts registering.
  - Both point to an identity or tracking change around 15 Sep. Don't compare web sankey weeks before and after 2026-09-15.

## Data-quality notes found during the pull

- Dataset 63 `was_add_to_cart` cannot be selected. Superset `/chart/data` returns 400 BAD REQUEST (also for a single day), so `session_flags_weekly.json` has `was_add_to_cart = null`.
- Dataset 63 `total_users_not_bounce` equals `total_users` in every pulled row, so it does not exclude bounced users.
- Week 2026-09-21 has a large web spike in dataset 63 (Web Desktop TH 17k, GL 15k, HK 10k, AU 3.9k guest sessions, against about 3k normally). It is possibly bot or campaign traffic (**unconfirmed**).

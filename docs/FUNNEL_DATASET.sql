-- Per-session funnel dataset for the "Funnel drop-offs by step" table (Pomelo Platform Analyzer).
-- PROPOSAL for the data team to add as a Superset virtual dataset on database "PostgreSQL".
-- The dashboard is read-only and does not create Superset datasets itself.
--
-- Why: the existing Sankey datasets (284/285/286) force a fixed stage order and never record exits,
-- so true drop-off % (sessions at a step that never reached the next one) and list→list flows
-- (Home feed → Product list, Hero Banner → Product list, Special Showcase → Product list) cannot be
-- computed from them. This query keeps each session's FIRST time at every step and compares times.
--
-- Output grain: week (Monday, Asia/Bangkok) × platform × guest flag. Aggregates only.
-- One block per platform; Android identifies users by context_traits_id_customer (see OPEN_QUESTIONS).
-- Mapping assumptions to confirm (marked TODO): Hero Banner ref_types, Special Showcase ref_type,
-- Home feed ref_type.

WITH sessions AS (
  SELECT
    COALESCE(user_id::VARCHAR, device_id::VARCHAR) AS identifier,
    COALESCE(user_id::VARCHAR, device_id::VARCHAR) || session_start::VARCHAR || session_end::VARCHAR AS session_id,
    session_start, session_end,
    (user_id IS NULL) AS is_guest,
    CASE app_name WHEN 'Pomelo - Web' THEN 'web' WHEN 'Pomelo - IOS' THEN 'ios' WHEN 'Pomelo - Android' THEN 'android' END AS platform
  FROM dwh.fact_segment_session
  WHERE session_duration != 0
    AND session_start >= DATE '2026-08-01'
),

-- ---- web events (repeat this block for rudderstack_ios / rudderstack_android with the same step names) ----
web_events AS (
  SELECT COALESCE(user_id::VARCHAR, anonymous_id::VARCHAR) AS identifier, 'login' AS step, "timestamp" AS ts FROM rudderstack_web_production.logged_in
  UNION ALL
  SELECT COALESCE(user_id::VARCHAR, anonymous_id::VARCHAR),
         CASE
           WHEN ref_type = 'app_feed' THEN 'home_feed'                                  -- TODO confirm "Home feed"
           WHEN ref_type IN ('home_slider', 'skinny_banner', 'full_screen_banner') THEN 'hero_banner'  -- TODO confirm banner ref_types
           WHEN ref_type = 'special_awareness' THEN 'special_showcase'                  -- TODO confirm "Special Showcase"
           ELSE 'product_list'
         END,
         "timestamp"
  FROM rudderstack_web_production.product_list_viewed
  UNION ALL SELECT COALESCE(user_id::VARCHAR, anonymous_id::VARCHAR), 'pdp', "timestamp" FROM rudderstack_web_production.product_viewed
  UNION ALL SELECT COALESCE(user_id::VARCHAR, anonymous_id::VARCHAR), 'add_to_cart', "timestamp" FROM rudderstack_web_production.product_added
  UNION ALL SELECT COALESCE(user_id::VARCHAR, anonymous_id::VARCHAR), 'add_to_cart', "timestamp" FROM rudderstack_web_production.quick_add_to_cart
  UNION ALL SELECT COALESCE(user_id::VARCHAR, anonymous_id::VARCHAR), 'cart_view', "timestamp" FROM rudderstack_web_production.cart_viewed
  UNION ALL SELECT COALESCE(user_id::VARCHAR, anonymous_id::VARCHAR), 'address', "timestamp" FROM rudderstack_web_production.shipping_address_selected
  UNION ALL SELECT COALESCE(user_id::VARCHAR, anonymous_id::VARCHAR), 'payment', "timestamp" FROM rudderstack_web_production.payment_method_selected
  UNION ALL SELECT COALESCE(user_id::VARCHAR, anonymous_id::VARCHAR), 'order', "timestamp" FROM rudderstack_web_production.order_completed
),

-- first time each session reached each step (same session window rule as the Sankey datasets: ±30 min, UTC+7)
firsts AS (
  SELECT s.session_id, s.platform, s.is_guest, DATE_TRUNC('week', s.session_start)::DATE AS week, e.step, MIN(e.ts) AS first_ts
  FROM sessions s
  JOIN web_events e
    ON e.identifier = s.identifier
   AND (e.ts + INTERVAL '7 hour') BETWEEN s.session_start - INTERVAL '30 minute' AND s.session_end + INTERVAL '30 minute'
  WHERE s.platform = 'web'
  GROUP BY 1, 2, 3, 4, 5
),

per_session AS (
  SELECT session_id, platform, is_guest, week,
    MAX(first_ts) FILTER (WHERE step = 'login')            AS t_login,
    MAX(first_ts) FILTER (WHERE step = 'home_feed')        AS t_feed,
    MAX(first_ts) FILTER (WHERE step = 'hero_banner')      AS t_banner,
    MAX(first_ts) FILTER (WHERE step = 'special_showcase') AS t_showcase,
    MAX(first_ts) FILTER (WHERE step = 'product_list')     AS t_list,
    MAX(first_ts) FILTER (WHERE step = 'pdp')              AS t_pdp,
    MAX(first_ts) FILTER (WHERE step = 'add_to_cart')      AS t_atc,
    MAX(first_ts) FILTER (WHERE step = 'cart_view')        AS t_cart,
    MAX(first_ts) FILTER (WHERE step = 'address')          AS t_address,
    MAX(first_ts) FILTER (WHERE step = 'payment')          AS t_payment,
    MAX(first_ts) FILTER (WHERE step = 'order')            AS t_order
  FROM firsts
  GROUP BY 1, 2, 3, 4
),

-- one row per (flow step): base = sessions at the FROM step, continued = of those, sessions that reached the TO step later
steps AS (
  SELECT week, platform, is_guest, 'list-pdp' AS step_id, (t_list IS NOT NULL) AS at_from, (t_list IS NOT NULL AND t_pdp > t_list) AS reached_to FROM per_session
  UNION ALL SELECT week, platform, is_guest, 'pdp-atc', t_pdp IS NOT NULL, t_pdp IS NOT NULL AND t_atc > t_pdp FROM per_session
  UNION ALL SELECT week, platform, is_guest, 'atc-cart', t_atc IS NOT NULL, t_atc IS NOT NULL AND t_cart > t_atc FROM per_session
  UNION ALL SELECT week, platform, is_guest, 'cart-address', t_cart IS NOT NULL, t_cart IS NOT NULL AND t_address > t_cart FROM per_session
  UNION ALL SELECT week, platform, is_guest, 'address-payment', t_address IS NOT NULL, t_address IS NOT NULL AND t_payment > t_address FROM per_session
  UNION ALL SELECT week, platform, is_guest, 'payment-order', t_payment IS NOT NULL, t_payment IS NOT NULL AND t_order > t_payment FROM per_session
  UNION ALL SELECT week, platform, is_guest, 'cart-order', t_cart IS NOT NULL, t_cart IS NOT NULL AND t_order > t_cart FROM per_session
  UNION ALL SELECT week, platform, is_guest, 'login-feed', t_login IS NOT NULL, t_login IS NOT NULL AND t_feed > t_login FROM per_session
  UNION ALL SELECT week, platform, is_guest, 'feed-pdp', t_feed IS NOT NULL, t_feed IS NOT NULL AND t_pdp > t_feed FROM per_session
  UNION ALL SELECT week, platform, is_guest, 'feed-list', t_feed IS NOT NULL, t_feed IS NOT NULL AND t_list > t_feed FROM per_session
  UNION ALL SELECT week, platform, is_guest, 'banner-list', t_banner IS NOT NULL, t_banner IS NOT NULL AND t_list > t_banner FROM per_session
  UNION ALL SELECT week, platform, is_guest, 'banner-pdp', t_banner IS NOT NULL, t_banner IS NOT NULL AND t_pdp > t_banner FROM per_session
  UNION ALL SELECT week, platform, is_guest, 'showcase-pdp', t_showcase IS NOT NULL, t_showcase IS NOT NULL AND t_pdp > t_showcase FROM per_session
  UNION ALL SELECT week, platform, is_guest, 'showcase-list', t_showcase IS NOT NULL, t_showcase IS NOT NULL AND t_list > t_showcase FROM per_session
)

SELECT week, platform, is_guest, step_id,
       COUNT(*) FILTER (WHERE at_from)    AS sessions_at_step,
       COUNT(*) FILTER (WHERE reached_to) AS sessions_reached_next
FROM steps
GROUP BY 1, 2, 3, 4
ORDER BY 1, 2, 3, 4;

-- Drop-off % = 1 - sessions_reached_next / sessions_at_step.
-- "Guest session: Cart → Order complete" = step_id 'cart-order' WHERE is_guest.

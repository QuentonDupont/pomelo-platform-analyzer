"""Phase 0: write trimmed Superset discovery artefacts (aggregates only, values transcribed from
read-only query_dataset / get_chart calls on 2026-10-08)."""
import json
import os

O = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "discovery", "superset")


def w(n, o):
    with open(os.path.join(O, n), "w") as f:
        json.dump(o, f, indent=2)


w("dashboard_462.json", {"id": 462, "title": "Channel Non Bounce Traffic and Conversion Analysis",
  "chart_ids": [4481, 4482, 4483, 4484, 4485, 4486, 4487, 4488, 4489, 4496, 4497, 4498, 4499, 4500, 4501, 4502, 4503, 4504, 4505, 4506, 4507],
  "native_filters": [{"name": "Session Date", "type": "filter_time", "default": "2026-06-01T00:00:00 : 2026-07-15T00:00:00",
                      "chartsInScope": [4481, 4482, 4483, 4484, 4485, 4486, 4487, 4488, 4489]}],
  "note": "Chart definitions not dumped (time budget); per-channel traffic/orders/CR charts."})
w("dashboard_528.json", {"id": 528, "title": "Platform Traffic Analysis", "changed_on": "2026-09-23",
  "charts": {"5001": "All Platforms Daily Non Bounce Traffic", "5002": "iOS Platform Daily Non Bounce Traffic",
             "5003": "Android Platform Daily Non Bounce Traffic", "5004": "Web Desktop Platform Daily Non Bounce Traffic",
             "5005": "Web Mobile Platform Daily Non Bounce Traffic", "5006": "Daily Bounces By Platforms",
             "5007": "iOS Daily Bounce Rate", "5008": "Android Daily Bounce Rate", "5009": "Web Desktop Daily Bounce Rate",
             "5010": "Web Mobile Daily Bounce Rate", "5011": "iOS Conversion Rate (Ex Bounces)",
             "5012": "All Platforms Conversion Rate (Ex Bounces)", "5013": "Android Conversion Rate (Ex Bounces)",
             "5014": "Web Desktop Conversion Rate (Ex Bounces)", "5015": "Web Mobile Conversion Rate (Ex Bounces)"},
  "native_filters": [{"name": "Session Date", "type": "filter_time", "default": "Current month", "chartsInScope": [5001, 5002]}],
  "note": "Charts 4988-4999 named in the brief are NOT on 528; they belong to dashboard 527 'Sankey Dashboard Based on Sessions'."})
w("chart_5007.json", {"id": 5007, "name": "iOS Daily Bounce Rate", "dashboard": 528, "datasource": "63__table",
  "viz": "echarts_timeseries_line", "x_axis": "session_start_date", "time_grain": "P1D",
  "metric": {"type": "SIMPLE", "column": "bounce_rate", "aggregate": "SUM", "label": "Bounce Rate"},
  "groupby": ["app_name_short_version"], "filters": [{"col": "app_name_short_version", "op": "IN", "val": ["iOS"]}], "y_format": ".2%"})
w("chart_5012.json", {"id": 5012, "name": "All Platforms Conversion Rate (Ex Bounces)", "dashboard": 528, "datasource": "63__table",
  "viz": "echarts_timeseries_line", "x_axis": "session_start_date", "time_grain": "P1D",
  "metric": {"type": "SIMPLE", "column": "session_conversion", "aggregate": "SUM", "label": "Conversion Rate Ex Bounce"},
  "filters": [{"col": "session_duration", "op": ">", "val": 10}], "y_format": ".2%",
  "note": "Ex-bounce applied as WHERE session_duration > 10 on top of cube measure session_conversion; the separate session_conversion_ex_bounce measure is NOT used."})
w("chart_4988.json", {"id": 4988, "name": "All Platforms Sessions Flow", "dashboard": 527,
  "datasource": "276__table (all_sessions_for_sankey_chart, virtual SQL on PostgreSQL)", "viz": "sankey_v2",
  "metric": "SUM(value) AS Sessions Count", "groupby": ["source", "target"],
  "filters": [{"col": "date", "op": "TEMPORAL_RANGE", "val": "Current month"}]})
w("chart_4999.json", {"id": 4999, "name": "Web Sessions Ref Type", "dashboard": 527,
  "datasource": "286__table (web_sankey_sessions_ref_type)", "viz": "sankey_v2", "metric": "SUM(value) AS Sessions Count",
  "groupby": ["source", "target"], "filters": [{"col": "event_date", "op": "TEMPORAL_RANGE", "val": "Current month"}]})
w("charts_not_dumped.json", {"ids": [4998, 4997, 4996, 4995, 4994, 4993, 4991],
  "reason": "time budget; all are on dashboard 527 (sankey) over virtual datasets 276-286 - see datasets_sankey_search.json for their SQL"})

shopname = {1: "TH", 2: "SG", 4: "Global USD (shop 4)", 10: "shop 10 (assumed AU - unconfirmed)", 12: "HK"}
# (platform, id_shop, total_sessions, bounces, non_bounces, gross_orders, revenue_after_discount_in_usd)
w1 = [("Android", 1, 3969, 1544, 2425, 8, 300.74), ("iOS", 4, 1039, 376, 663, 29, 1817.69), ("Android", 2, 287, 84, 203, 2, 117.20),
      ("Web Desktop", 2, 880, 705, 175, 3, 147.84), ("Android", 4, 238, 89, 149, 0, None), ("iOS", 1, 16178, 6692, 9486, 123, 6592.12),
      ("iOS", 2, 882, 270, 612, 2, 99.17), ("Web Desktop", 1, 5796, 4056, 1740, 11, 683.31), ("Web Mobile", 4, 3371, 2660, 711, 0, None),
      ("iOS", 12, 63, 18, 45, 0, None), ("Web Desktop", 12, 373, 330, 43, 1, 51.31), ("Web Desktop", 4, 2905, 2337, 568, 0, None),
      ("Android", 10, 13, 7, 6, 0, None), ("Android", 12, 5, 2, 3, 0, None), ("Web Mobile", 10, 307, 248, 59, 0, None),
      ("Web Mobile", 1, 12807, 10292, 2515, 8, 346.69), ("iOS", 10, 46, 23, 23, 0, None), ("Web Desktop", 10, 306, 285, 21, 0, None),
      ("Web Mobile", 12, 608, 470, 138, 2, 154.03), ("Web Mobile", 2, 1643, 1296, 347, 3, 186.04), (None, 1, 53, 53, 0, 0, None),
      (None, 2, 6, 6, 0, 0, None), (None, 4, 12, 12, 0, 0, None)]
w2 = [("iOS", 4, 1026, 380, 646, 20, 1411.91), ("Android", 1, 3686, 1489, 2197, 9, 365.22), ("Android", 2, 272, 103, 169, 2, 41.69),
      ("Android", 4, 289, 96, 193, 0, None), ("Web Desktop", 2, 797, 649, 148, 1, 36.48), (None, 1, 45, 45, 0, 0, None),
      ("Web Mobile", 10, 1096, 1033, 63, 0, None), (None, 2, 4, 4, 0, 0, None), ("Android", 12, 10, 5, 5, 0, None),
      ("Web Mobile", 1, 21222, 18752, 2470, 14, 520.84), ("iOS", 10, 58, 22, 36, 0, None), ("Web Mobile", 12, 1782, 1650, 132, 1, 50.98),
      ("Web Mobile", 2, 5478, 5200, 278, 3, 96.95), ("Web Desktop", 10, 532, 482, 50, 0, None), (None, 4, 13, 13, 0, 0, None),
      ("iOS", 1, 14707, 6020, 8687, 104, 5963.27), ("Web Desktop", 1, 3678, 2258, 1420, 9, 316.89), ("iOS", 2, 802, 268, 534, 9, 565.64),
      ("iOS", 12, 58, 21, 37, 0, None), ("Web Desktop", 4, 3147, 2618, 529, 0, None), ("Web Desktop", 12, 790, 701, 89, 0, None),
      ("Web Mobile", 4, 5399, 4564, 835, 0, None), ("Android", 10, 8, 2, 6, 0, None)]
rows = []
for ws, data in (("2026-09-14", w1), ("2026-09-28", w2)):
    for p, s, t, b, nb, o, r in data:
        rows.append({"week_start": ws, "platform": p or "unknown (null app_name_short_version)", "id_shop": s, "market": shopname[s],
                     "total_sessions": t, "bounce_sessions": b, "non_bounce_sessions": nb, "orders": o,
                     "booked_revenue_usd": r if r is not None else (0 if o == 0 else None)})
rows.sort(key=lambda x: (x["week_start"], x["id_shop"], x["platform"]))
w("weekly_aggregates.json", {
    "source": "Superset dataset 63 = Cube-PROD public.segment_session; filters bot_flag=false, id_shop IN (1,2,4,10,12), session_start_date in [week_start, week_start+7d); orders = cube measure gross_orders (session-attributed), booked_revenue_usd = revenue_after_discount_in_usd (session-attributed). Queried 2026-10-08.",
    "rows": rows})
w("section_aggregates.json", {"status": "NOT AVAILABLE",
  "reason": "dataset 63 has no landing-page / site-section column (dynamic_session_start is a timestamp). Closest candidate: rudderstack_*.product_list_viewed.ref_type (e.g. home_slider, home_masonry, navigation, app_feed) used by sankey datasets 276-286; not aggregatable by week via query_dataset.",
  "rows": []})

for ws in ("2026-09-14", "2026-09-28"):
    R = [r for r in rows if r["week_start"] == ws]
    app = [r for r in R if r["platform"] in ("iOS", "Android")]
    web = [r for r in R if r["platform"].startswith("Web")]
    s = lambda rs, k: sum(r[k] for r in rs)
    print(ws, "APP nb", s(app, "non_bounce_sessions"), "iOS nb", s([r for r in app if r["platform"] == "iOS"], "non_bounce_sessions"),
          "orders", s(app, "orders"), "iOS orders", s([r for r in app if r["platform"] == "iOS"], "orders"),
          "total", s(app, "total_sessions"), "bounces", s(app, "bounce_sessions"),
          "| WEB nb", s(web, "non_bounce_sessions"), "orders", s(web, "orders"), "total", s(web, "total_sessions"), "bounces", s(web, "bounce_sessions"),
          "| TH WEB nb", s([r for r in web if r["id_shop"] == 1], "non_bounce_sessions"), "orders", s([r for r in web if r["id_shop"] == 1], "orders"))

# Reconciliation vs CEO brief (run 2026-10-08)

Method: `query_dataset` on dataset 63 (`segment_session`, Cube-PROD) with `bot_flag = false`, `id_shop IN (1 TH, 2 SG, 4 Global USD, 10 assumed AU, 12 HK)`. Weeks are `session_start_date >= '2026-09-14' AND < '2026-09-21'` and `>= '2026-09-28' AND < '2026-10-05'`, using raw dates and assuming Bangkok local time. "Sessions" in the brief means **non_bounces**. Orders = dataset 63 `gross_orders` (session-attributed). Rows are in `discovery/superset/weekly_aggregates.json`.

| Brief metric | Brief | Reproduced | Status |
|---|---|---|---|
| App non-bounce sessions wk1 | 13,615 | 13,615 (iOS 10,829 + Android 2,786) | **reproduced** |
| App non-bounce sessions wk2 | 12,510 | 12,510 (iOS 9,940 + Android 2,570) | **reproduced** |
| App orders wk1 | 174 | 164 (iOS 154 + Android 10) | differs (−10, −5.7%) |
| App orders wk2 | 163 | 144 (iOS 133 + Android 11) | differs (−19, −11.7%) |
| App non-bounce CR wk1 | 1.278% | 1.205% | differs (follows from orders) |
| App non-bounce CR wk2 | 1.303% | 1.151% | differs |
| Web 5-mkt non-bounce sessions wk1 | 6,317 | 6,317 | **reproduced** |
| Web 5-mkt non-bounce sessions wk2 | 6,014 | 6,014 | **reproduced** |
| Web orders wk1 | 33 | 28 | differs (−5) |
| Web orders wk2 | 28 | 28 | reproduced (but TH/other mix differs, see below) |
| Web CR wk1 / wk2 | 0.5224% / 0.4656% | 0.4433% / 0.4656% | wk1 differs, wk2 matches |
| TH web non-bounce sessions wk1 / wk2 | 4,255 / 3,890 | 4,255 / 3,890 | **reproduced** |
| TH web orders wk1 / wk2 | 21 / 21 | 19 / 23 | differs (−2 / +2) |
| TH web CR wk1 / wk2 | 0.4935% / 0.5398% | 0.4465% / 0.5913% | differs |
| 7 Sep–6 Oct eligible orders | 971 | not run | could-not-run (time budget; "eligible" filter undefined) |
| 300 daily shop/platform traffic groups | 300 | not run | could-not-run (time budget) |

Conclusions:
- **Sessions reconcile exactly.** The brief used dataset 63 `non_bounces` with shops {1,2,4,10,12}, so shop 10 is confirmed in scope (most likely AU). This also suggests `session_start_date` is already in Bangkok dates.
- **Orders do not reconcile using `segment_session.gross_orders`.** The brief probably attributed orders a different way, for example joining `online_sales` orders to sessions via `segment_session_start_date`, or applying an "eligible" filter (`is_billable_order` / `exclude_store_staff_uniform_and_influencer_orders` / non-Apollo). It is also possible that Cube attribution has changed since the brief was produced. `online_sales` by order_date is far higher: TH iOS alone has 151 wk1, and the Apollo platform has 54 orders. So the brief is neither raw online_sales nor raw segment_session.
- Bounce context (not in brief): app bounce rate is 40.1% wk1 (9,105/22,720) and 40.2% wk2 (8,406/20,916). Web bounce rate rose from **78.2% to 86.3%**: total web sessions went from 28,996 to 43,921 while non-bounce fell. TH Web Mobile went from 12,807 to 21,222 sessions and SG Web Mobile from 1,643 to 5,478. This looks like a bot or paid-traffic spike that `bot_flag` is not catching, since `bot_flag` is always false.

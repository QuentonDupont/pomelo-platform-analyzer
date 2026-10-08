# RudderStack — what the transformations repo tells us

Source (read-only): `pomelofashion/rudderstack-docker-transformations` @ master, read 2026-10-08.

## What this repo is
Destination/source **transformations**, not the warehouse schema. `src/transformerRegistry.js` registers four:

| Key | File | Role |
|---|---|---|
| `filtersEvent-v1` | transformationsFBFiltersEvents.js | Facebook destination: drops `page` calls, `identify`, SDK-managed commerce events, and `properties.id_shop` ∈ {12, 10, 4} |
| `branchFilters-v1` | transformationsBranchFilters.js | Branch destination **allowlist** (below) |
| `branchWebhookSource-v1` | transformationsBranchWebhookSource.js | Branch → RudderStack webhook source |
| `WebhookNetcoreDestination-v1` | transformationsNetcoreDestination.js | Netcore destination |

So it **cannot** confirm the bounce definition or the session model — those must come from Superset dataset 63 / warehouse tables.

## Event vocabulary actually emitted (from the Branch allowlist)
Two naming conventions coexist — Branch standard events (UPPER_SNAKE) and Segment-spec style (Title Case):

| Funnel step (dashboard) | Candidate event(s) | Notes |
|---|---|---|
| Session start | `WEB_SESSION_START` (web), `OPEN` (app) | candidate session anchor; verify in warehouse |
| Landing | `Landing Page Viewed` | useful for D4 landing-page loss view |
| Listing interaction | `VIEW_ITEMS`, `Product List Filtered`, `Product List Sorted` | listing engagement — candidate "non-bounce" interactions |
| Search | `SEARCH` | |
| PDP | `VIEW_ITEM` | FB filter also knows `Product Viewed` / `View Content` → **dedupe across conventions** |
| Add to bag | `ADD_TO_CART`, `Wishlist Product Added to Cart`, `Recommended Size Added To Bag` | FB filter also knows `Product Added` |
| Bag | `VIEW_CART` | |
| Checkout | `INITIATE_PURCHASE`, `Checkout Step Completed` | FB filter also knows `Checkout Started` |
| Payment | `Payment Method Selected`, `Credit Card Selected`, `Select Pick Up Payment` | |
| Order | `PURCHASE` | FB filter also knows `Order Completed`; **dashboard uses backend orders** per CEO brief |

`properties.id_shop` is the shop/market key on events (shops 4, 10, 12 are excluded from Facebook — likely out-of-scope markets; mapping pending).

## Consequences for the build
1. Funnel counts must count **sessions reaching a step**, deduplicated across both naming conventions.
2. The Branch allowlist is a subset — the warehouse may hold more events; run `SELECT event, count(*)` over the last 30 days once warehouse access exists.
3. Pending: map `id_shop` → TH/SG/HK/GL/AU and confirm 4/10/12 (see OPEN_QUESTIONS).

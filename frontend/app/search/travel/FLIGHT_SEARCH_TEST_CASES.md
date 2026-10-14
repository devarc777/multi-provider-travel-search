# Flight search – test cases

Use this list to verify the new error messages and behavior. No changes to hotel or booking flows.

---

## A. Manual search (user fills form and clicks Search)

| # | Scenario | Expected error / behavior |
|---|----------|---------------------------|
| A1 | User leaves "From" empty and clicks Search | **"Please enter a departure city or airport code."** |
| A2 | Backend returns **429** with JSON `{ "message": "Custom rate limit text" }` | **"Custom rate limit text"** (backend message shown). |
| A3 | Backend returns **429** with non-JSON or empty body | **"Flight search limit reached. Please wait a few minutes and try again."** |
| A4 | Backend returns **5xx** (500, 502, 503) | **"Flight search is temporarily unavailable. Please try again in a few minutes."** (no raw backend message). |
| A5 | Backend returns **4xx** (e.g. 400, 404) with JSON `{ "message": "..." }` | Backend **message** shown. |
| A6 | Backend returns **4xx** without a clear message | **"We couldn't load flight results. Please try again in a moment."** |
| A7 | Response OK but body is **not an array** (e.g. `{}` or string) | **"We couldn't load flight results. Please try again in a moment."** |
| A8 | Response OK, body is **array with length > 0** | No error; flights listed. |
| A9 | Response OK, body is **empty array** `[]` | **"No flights found for your search. Try different dates or airports."** |
| A10 | **Network failure** (e.g. backend down, no internet, CORS) | **"We couldn't reach the server. Check your connection and try again."** |

---

## B. Initial load (landing with URL params e.g. `?from=NYC&to=LAX&dates=...`)

| # | Scenario | Expected error / behavior |
|---|----------|---------------------------|
| B1 | URL has **no `from`** (e.g. `/search/travel` only) | No request; no error; user sees empty form. |
| B2 | Backend returns **429** with JSON `{ "message": "..." }` | That **message** shown. |
| B3 | Backend returns **429** with non-JSON or empty body | **"Flight search limit reached. Please wait a few minutes and try again."** |
| B4 | Backend returns **5xx** | **"Flight search is temporarily unavailable. Please try again in a few minutes."** |
| B5 | Backend returns **4xx** with `body.message` | Backend **message** shown. |
| B6 | Backend returns **4xx** without message | **"We couldn't load flight results. Please try again in a moment."** |
| B7 | Response OK but body is **not an array** | **"We couldn't load flight results. Please try again in a moment."** |
| B8 | Response OK, body is **empty array** | **"No flights found for this search. Try different cities or dates."** |
| B9 | Response OK, body is **array with flights** | No error; flights listed. |
| B10 | **Network failure** during initial fetch | **"We couldn't reach the server. Check your connection and try again."** |

---

## C. Consistency checks

| # | Check |
|---|--------|
| C1 | For the **same** backend response (e.g. 429, 5xx, empty array), **initial load** and **manual search** show the **same** type of message (wording may differ slightly for “no results”: “this search” vs “your search”). |
| C2 | **Rate limit** wording is used only for **429** or backend message that says so; **empty results** never show “rate limit”, only “No flights found…”. |
| C3 | **Hotel search** and **flight booking** flows are unchanged; only flight **search** (list) error messages were updated. |

---

## D. Quick smoke tests (minimal set)

1. Search with **From** empty → see "Please enter a departure city or airport code."
2. Search with valid **From** and backend returns **empty array** → see "No flights found for your search. Try different dates or airports."
3. Open URL with **?from=XXX** and backend returns **empty array** → see "No flights found for this search. Try different cities or dates."
4. Simulate **429** (e.g. mock or backend) → see "Flight search limit reached..." or backend message.
5. Turn off network and search → see "We couldn't reach the server. Check your connection and try again."

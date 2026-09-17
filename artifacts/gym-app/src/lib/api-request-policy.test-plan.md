# Phase 3 request-storm invariants

This file documents the runtime invariants enforced by the API fetch wrapper in `src/main.tsx`.

- Identical in-flight GETs for quiet read endpoints are coalesced.
- Pagination requests for the same quiet resource are serialized rather than fan-out in parallel.
- Successful quiet reads are reused for idle polling for up to 10 minutes.
- A successful API mutation clears the read cache so mutation-driven refreshes are fresh.
- Pointer/keyboard interaction creates a short fresh-read window so explicit user refresh actions are not served stale cache.
- Returning to a visible tab clears quiet-read cache so changes from another browser/user can be observed.
- Aborted queued requests fail before network dispatch when their signal is already aborted.

The quiet endpoints are `/api/payments`, `/api/vouchers`, `/api/ledger/balance`, and `/api/notifications/count`.

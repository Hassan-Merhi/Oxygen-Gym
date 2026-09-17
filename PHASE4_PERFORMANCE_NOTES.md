Phase 4 performance work targets the slow production read paths observed in Render logs.

- Cash account statements now push optional date bounds into the canonical SQL stream instead of reconstructing all history and filtering in Node.
- The canonical cash query narrows reusable payment/voucher CTE columns and uses NOT MATERIALIZED so PostgreSQL can plan indexed probes instead of forcing broad CTE materialization.
- Legacy member receipt de-duplication now uses a range predicate on payment_date rather than casting payment_date to date, allowing the member/date index to be used.
- New idempotent partial/composite indexes cover canonical cash sources, account statement ordering, recorded voucher listing, and notification count/detail filters.

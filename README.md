# Cupcake Delights

Cafe & bakery ordering with table QR codes.

## Features
- Table QR codes → customer menu with EN / አማ toggle
- Single cart; "Order received" with order number + private receipt link
- Staff dashboard: order list with auto-refresh, new-order highlight/sound
- Staff-only cancellation with a reason (audited)
- Admin/cashier ordering on/off switch; menu and prices stay admin-editable
- Telegram notifications (bilingual by setting), never blocking an order
- Supabase-backed auth, RBAC and append-only audit log
- Forced password change on first/admin-reset login; HttpOnly session cookie
- VAT settings are display only — totals are computed from DB prices, exactly

## Roles
- **Admin**: full access — menu, staff, settings, analytics, audit, ordering toggle
- **Cashier**: order list, cancel, ordering toggle
- **Waiter**: order list, cancel

There is no kitchen role, order status flow or payments table.

## Setup

### Existing project (do not reset)
The live DB has real menu items, categories and table tokens. Run, with a
`DATABASE_URL` in `.env`:

```bash
npm run backup         # timestamped in-DB snapshot, written first
npm run migrate        # applies sql/010_simplify.sql in place
npm run migrate:step4  # adds the atomic create_order RPC (idempotent)
npm run verify:db      # read-only schema/data checks (never applies SQL or seeds)
```

All staff are then forced to choose a new password at next login. See
`SUPABASE_SETUP.md` § 1b and § 9 (one-time pre-handover audit purge).

### Fresh project
```bash
npm run setup      # applies sql/001–004, creates Storage buckets, seeds users
```
Initial passwords come from `*_INITIAL_PASSWORD` in `.env` and
`node scripts/seed-users.js`.

## Tests
`npm run smoke:offline` runs fully offline against an in-process Supabase REST
stub. By default `npm run smoke` targets a **disposable** Supabase project in
`.env.test` and refuses to run if it is the live project. The owner has
explicitly authorised live smoke for this project: with `ALLOW_LIVE_SMOKE=1`
the same scripts target `.env`, use only dedicated `smoke_*` users, deactivate
them afterwards, and leave the append-only audit rows for the one-time
pre-handover purge (`sql/011_purge_audit_live.sql`).

`npm run reset` is test-only, never targets live, and requires
`ALLOW_TEST_RESET=1` (`npm run reset:test`).

See `MIGRATION_PLAN.md` and `CODE_PLAN.md` for the build plan.

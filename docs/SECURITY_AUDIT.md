# Security & transaction-integrity audit (Phase A, 2026-10-10)

Scope: multi-tenancy, authentication, RBAC, sync push/pull, device identity, numbering, duplicate
prevention, sales/returns/cancellations, inventory, ledgers, tax, loyalty, import/export, audit log,
local data. Every confirmed issue has a regression test in
`apps/api/tests/Feature/SecurityAuditTest.php` (12 tests) or `apps/web/src/lib/__tests__/sync-engine.test.ts`.

## Confirmed and fixed

| # | Severity | Finding | Fix | Test |
| --- | --- | --- | --- | --- |
| 1 | Critical | Sale line `taxable`/`tax_total`/`total` were stored as sent by the device. Refunds are pro-rated from these, so a tampered payload could refund far more than was charged. | Line amounts are always the server calculation; mismatch flagged `totals_mismatch`. | `test_manipulated_line_totals_never_reach_the_ledger_or_refunds` |
| 2 | High | When the device total disagreed with the server, the device total was stored and posted to the customer ledger. | Server total is authoritative; device total kept in `sales.meta` for review. | `test_server_total_is_authoritative_for_the_customer_balance` |
| 3 | High | Sync push authorized operations with the permissions of the client-supplied `user_id` (forged owner id ⇒ owner rights). | Operations by another member are allowed only for permissions held by both the author and the authenticated pusher. | `TenancyAndRbacTest::test_forging_another_members_user_id_does_not_escalate_privileges` |
| 4 | High | Device id (visible on every synced sale) was the only device credential: any member could act as, or re-register, another device. | Per-device secret issued at registration (SHA-256 stored), required as `X-Device-Secret`; re-registering an existing device requires its secret. Pre-existing devices receive a secret on their next registration. | `test_device_identity_requires_its_secret`, web `sends the device secret…` |
| 5 | High | Loyalty points earned/redeemed were taken from the device (unbounded earning, over-redemption). | Earned points computed from loyalty settings; redeemed points derived from the loyalty payment; over-redemption flagged `loyalty_over_redeemed`; idempotent through operation ids. | `test_loyalty_points_are_computed_and_checked_on_the_server` |
| 6 | High | Returns were accepted against quotations/estimates (refund of money never taken) and against cancelled invoices (double reversal). | Non-invoice returns rejected (preserved as rejected operations); returns on cancelled invoices kept and flagged `returned_after_cancel` + critical notification. | `test_refund_replay_and_refunds_on_non_invoices`, `test_return_after_cancellation_is_kept_and_flagged` |
| 7 | Medium | Negative payment amounts accepted. | `payments.*.amount` must be ≥ 0. | `test_negative_lines_and_negative_payments` |
| 8 | Medium | Negative invoice lines acted as refunds without `sales.refund`. | Flagged `negative_line_without_permission`. | same |
| 9 | Medium | Unit prices below catalogue and altered tax snapshots were not checked (only `min_selling_price`). | Flags `price_override_without_permission` and `tax_mismatch`; invalid coupons flagged `invalid_coupon`. | `test_cashier_price_and_tax_manipulation_is_flagged` |
| 10 | Medium | A customer payment could be applied to another customer's invoice (supplier payments likewise). | Invoice/purchase must belong to the party. | `test_payment_cannot_be_applied_to_another_customers_invoice` |
| 11 | Medium | Store-restricted members could register devices in, and post operations to, other stores. | Store access enforced at device registration and for every operation carrying `store_id`/`from_store_id`. | `test_store_restricted_members_cannot_work_in_other_stores` |
| 12 | Medium | A permanently rejected operation could never succeed, even after the cause (e.g. a missing permission) was fixed — retries replayed the stored rejection. | Rejected operations (which changed nothing) are re-evaluated on retry; the earlier rejection is written to the audit log (`SYNC_RETRY`). | `test_unauthorized_stock_adjustment_is_rejected_and_preserved` |
| 13 | Medium | IMEI/serial ids of a different product could be marked sold on a line. | Serial must belong to the line's product/variant, else skipped and flagged `serial_mismatch`. | covered by flag; IMEI flows in Phase D |
| 14 | Medium | A disabled or removed employee could keep signing in offline on a device indefinitely. | Server returns `code: business_access_denied`; the app removes the business from that account, deletes the offline verifier when no business remains, closes the business and keeps unsynced data. | `test_disabled_members_lose_access_with_a_machine_readable_code`, web `stops and revokes local access…` |

## Verified as sound (no change needed)

- Tenant isolation: `X-Business-Id` membership check, `BusinessScope`, cross-tenant id guessing → `dependency_missing` (existing tests).
- Idempotency: unique `operation_id` and entity ids; replayed sales, returns and payments are not applied twice; concurrent duplicate pushes resolved through the unique index.
- Numbering: block numbers accepted only for the owning device, inside the block range and period, with the expected format and unused in the document register.
- Every pushed operation re-checks its permission (`sales.create`, `sales.refund`, `inventory.adjust`, `purchases.*`, `settings.manage` …).
- Concurrent writes are serialized per business (`BusinessLock`); inventory changes only through the movement ledger.

## Residual risks (accepted, documented)

- **Offline policy:** offline sales are never rejected for business-rule anomalies; they are recorded and flagged for a manager (`Sales → Flagged for review`). Catalogue price or tax changes made while a device was offline can raise false `price_override_without_permission`/`tax_mismatch` flags.
- **Shared credit limits offline:** two offline devices can each sell on credit within the cached limit and together exceed it; flagged `credit_limit_exceeded` after sync.
- **Data at rest on the device:** IndexedDB (including the API token, device secret and cost prices) is readable by anyone with access to the OS user profile. Mitigations: OS accounts, sign-out, revoke lost devices.
- **Offline sign-in after password change:** the old password keeps working offline on a device until that device signs in online again.
- **Legacy devices:** a device registered before secrets existed is claimed by whoever re-registers it first (normally the device itself on its next sync).
- **Visibility of synced data:** all members' devices receive master data (including purchase prices and employee contact details); the UI hides them per permission, but they are present in IndexedDB.
- **Return point reversal:** loyalty points are not yet reversed on returns (Phase E).

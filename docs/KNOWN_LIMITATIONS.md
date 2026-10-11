# Known limitations

Honest list of what is not implemented or behaves differently from what some shops may expect.

## Platform
- **Browser printing only.** Receipts, KOTs and labels print through the browser print dialog to
  any installed printer (thermal or A4). Direct ESC/POS (raw USB/Bluetooth/network) printing, cash
  drawer kick and silent printing are not implemented; in kiosk-mode Chrome (`--kiosk-printing`)
  printing is silent.
- **Hardware scanners** that type like a keyboard are supported (including on idle screens).
  Camera barcode scanning is not implemented.
- The service worker (offline start) is only active in production builds over HTTPS or localhost.
- Data on a device lives in that browser profile. Clearing site data before sync loses unsynced
  work unless a device backup was downloaded (Settings → Backup).

## Business features
- GST e-invoicing (IRN/QR from the IRP), e-way bills and GSTR JSON filing exports are not
  implemented; the GST/HSN report can be exported to Excel/CSV.
- Product images upload is not implemented (the `image_url` field exists).
- Serial-tracked items in **purchase returns** are not supported; return them with a stock
  adjustment noted against the purchase.
- Loyalty points are recalculated and checked by the server, but are not yet reversed on returns.
- Offline sales are never rejected: anomalies are flagged for review (see docs/SECURITY_AUDIT.md for
  the flags and residual risks, including shared credit limits across offline devices).
- Reports run on the device over the data it holds. A device registered to one store receives only
  that store's sales; owners see all stores on a device without a store or via the server report
  endpoints.
- Employee, role, store and device management, business profile edits, password change and the
  audit log require an internet connection.
- Paying a customer's dues from the customer page creates one receipt per invoice settled
  (oldest first) rather than a single receipt.
- Translations: English is complete. Hindi, Malayalam and Tamil cover the core billing screens
  (navigation, POS, payment, receipts, offline/sync messages); other text falls back to English and
  the translations should be reviewed by native speakers.

## Sync
- After a push succeeds but before the next pull completes, local stock figures for those items
  use the last server quantity plus still-unconfirmed movements; they settle on the next pull
  (normally within the same sync cycle).
- Discarding a failed operation (Sync Center) is only offered for master data; financial records
  can only be retried.

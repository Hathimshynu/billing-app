# ShopDesk user manual

## Getting started
1. **Sign in** with your email and password (the first sign-in on a device needs internet).
2. **Choose your business.** The first time, ShopDesk downloads your products, customers and
   settings to this device. After that it works without internet.
3. Owners creating a new business pick the business type (supermarket, pharmacy, jewellery …);
   ShopDesk turns on the right features, tax rates and units.

## Working offline
- When the internet is down, an **Offline Mode** bar appears. Keep billing normally — everything is
  saved on this device and sent to the server automatically when the internet returns.
- The cloud icon in the top bar shows how many changes are waiting. **Sync Center** (sidebar) shows
  details and has a **Sync now** button.
- Invoices made offline get a final number from numbers reserved in advance. If those run out, the
  invoice gets a temporary number (`TMP-…`) that changes to a final number after syncing.
- Do not clear browser data while changes are waiting. If you must, first download a **device
  backup** (Settings → Backup).

## Billing (POS)
| Key | Action |
| --- | --- |
| F2 | Search / scan |
| F3 | Edit selected line |
| F4 | Customer |
| F6 | Bill discount / coupon |
| F7 | Held bills |
| F8 | Payment |
| F9 | Hold bill |
| F10 / Enter | Complete sale (in payment) |
| Delete | Remove selected line |
| Esc | Back to search |

Keys can be changed in Settings → POS.

1. Scan a barcode or type a name, SKU, IMEI or batch. Tap products in the grid on touch screens.
2. Items sold by weight ask for the quantity; weighing-scale labels are read automatically.
3. Products with sizes/colours ask for the variant; mobiles/electronics ask for the IMEI/serial.
4. Medicines are taken from the batch that expires first. Expired stock cannot be sold.
5. Tap a line to change quantity, price (if allowed), discount, notes or add-ons.
6. **Pay**: Cash (enter amount received to see change), UPI (QR shown when your UPI ID is set),
   Card, Credit (customer account), or **Split** across methods. Jewellery shops can take old gold.
7. The receipt prints automatically (if enabled) and can be reprinted in 58 mm, 80 mm or A4.

Other documents: choose **Quotation / Estimate / Proforma / Delivery challan** in the document
type menu. Quotations can later be converted to invoices.

**Restaurants:** choose Dine-in and a table, add items and press **Send KOT**. The kitchen screen
shows orders. Open the table again to add more or to bill it.

## Sales, returns and cancellations
Open **Sales** → an invoice to reprint, collect a balance, **Return** items (credit note; choose
whether stock goes back) or **Cancel** (needs permission and a reason).

## Products & stock
- **Products** → New product. Enter price, tax, barcode (or generate one), opening stock. Pharmacy:
  batch & expiry; jewellery: weights, purity, making & wastage; mobiles: IMEI tracking & warranty.
- **Inventory**: stock per item, stock ledger, **Adjust stock** (count corrections, damage,
  expired), **Transfer** to another store; **Expiry** lists expired and soon-expiring batches.
- **Purchases**: record supplier bills (stock in now) or purchase orders (receive later), with
  batches/expiry or IMEIs; pay suppliers and return goods.
- **Settings → Import**: upload CSV or Excel for products, customers or suppliers (download the
  template first). Errors are shown per row; only valid rows are imported.

## Customers, suppliers and money
- Customer and supplier pages show balance, ledger and statements (print / WhatsApp reminder).
- **Expenses**: record daily expenses with an optional receipt photo.
- **Cash register**: open with the opening cash, record cash in/out, close with a denomination
  count; the difference is shown.
- **Reports**: sales, items & margin, categories, customers, cashiers, payment methods,
  GST/HSN summary, profit & loss, stock valuation, dues — exportable to CSV, Excel, PDF and JSON.

## Conflicts
If two devices change the same product or customer field while offline, **Conflict Center** asks
which value to keep. Sales and payments never conflict — they are always kept.

## Administration (owners/managers, needs internet)
Employees & roles, stores, devices (revoke a lost tablet), business details, invoice numbering,
audit log, full data export.

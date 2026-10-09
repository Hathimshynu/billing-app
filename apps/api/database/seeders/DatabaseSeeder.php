<?php

namespace Database\Seeders;

use App\Models\BusinessUser;
use App\Models\ProductBatch;
use App\Models\ProductSerial;
use App\Models\Role;
use App\Models\User;
use App\Services\Business\BusinessService;
use App\Support\Tenancy\TenantContext;
use Database\Seeders\Support\DemoBuilder;
use Illuminate\Database\Seeder;
use Illuminate\Support\Str;

/**
 * Demo data: one owner (owner@shopdesk.test / Password123) running seven businesses of different
 * types, plus a cashier (cashier@shopdesk.test / Password123) at FreshMart.
 */
class DatabaseSeeder extends Seeder
{
    public const PASSWORD = 'Password123';

    public function run(): void
    {
        mt_srand(2026);
        $owner = User::query()->create([
            'name' => 'Arjun Nair',
            'email' => 'owner@shopdesk.test',
            'phone' => '9847012345',
            'password' => self::PASSWORD,
        ]);

        $this->supermarket($owner);
        $this->pharmacy($owner);
        $this->jewellery($owner);
        $this->mobile($owner);
        $this->clothing($owner);
        $this->electronics($owner);
        $this->restaurant($owner);

        app(TenantContext::class)->clear();
        $this->command?->info('Demo login: owner@shopdesk.test / '.self::PASSWORD.' (7 businesses), cashier@shopdesk.test / '.self::PASSWORD);
    }

    /** Valid GSTIN for demo data (computes the checksum character). */
    public static function gstin(string $first14): string
    {
        $chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        $sum = 0;
        for ($i = 0; $i < 14; $i++) {
            $product = strpos($chars, $first14[$i]) * ($i % 2 === 0 ? 1 : 2);
            $sum += intdiv($product, 36) + ($product % 36);
        }

        return $first14.$chars[(36 - ($sum % 36)) % 36];
    }

    /** 15-digit IMEI with a valid Luhn check digit. */
    public static function imei(string $first14): string
    {
        $sum = 0;
        for ($i = 0; $i < 14; $i++) {
            $d = (int) $first14[$i];
            if ($i % 2 === 1) {
                $d *= 2;
                $d = $d > 9 ? $d - 9 : $d;
            }
            $sum += $d;
        }

        return $first14.((10 - ($sum % 10)) % 10);
    }

    private static function ean(int $seq, string $prefix = '890'): string
    {
        $body = $prefix.str_pad((string) $seq, 12 - strlen($prefix), '0', STR_PAD_LEFT);
        $sum = 0;
        for ($i = 0; $i < 12; $i++) {
            $sum += (int) $body[11 - $i] * ($i % 2 === 0 ? 3 : 1);
        }

        return $body.((10 - ($sum % 10)) % 10);
    }

    /** @param array<string, mixed> $data */
    private function business(User $owner, array $data): DemoBuilder
    {
        $business = app(BusinessService::class)->create($owner, $data + [
            'country' => 'IN', 'currency' => 'INR', 'timezone' => 'Asia/Kolkata', 'tax_system' => 'gst',
        ]);

        return new DemoBuilder($business, $owner);
    }

    /** Spread sales over the last two weeks for dashboards and reports. */
    private function history(DemoBuilder $b, array $catalog, array $customers, int $count): void
    {
        for ($n = 0; $n < $count; $n++) {
            $day = mt_rand(0, 13);
            $at = now()->subDays($day)->setTime(mt_rand(9, 20), mt_rand(0, 59));
            $lines = [];
            $picked = (array) array_rand($catalog, min(mt_rand(1, 4), count($catalog)));
            foreach ($picked as $key) {
                $item = $catalog[$key];
                $lines[] = $item + ['quantity' => $item['weighed'] ?? false ? mt_rand(5, 30) / 10 : mt_rand(1, 3)];
            }
            $lines = array_map(fn ($l) => array_diff_key($l, ['weighed' => true]), $lines);
            $customer = mt_rand(0, 3) === 0 && $customers ? $customers[array_rand($customers)] : null;
            $method = ['cash', 'cash', 'upi', 'upi', 'card'][mt_rand(0, 4)];
            $b->sale($lines, $customer, $at, null, [], $method);
        }
    }

    private function supermarket(User $owner): void
    {
        $b = $this->business($owner, [
            'name' => 'FreshMart Supermarket', 'business_type' => 'supermarket', 'state_code' => '32',
            'gstin' => self::gstin('32AAKFF4321M1Z'), 'phone' => '9847011111', 'email' => 'hello@freshmart.test',
            'address' => 'MG Road, Ernakulam', 'city' => 'Kochi', 'pincode' => '682016',
        ]);
        $items = [
            ['name' => 'Basmati Rice (Loose)', 'unit' => 'kg', 'product_type' => 'weighed', 'plu_code' => '00101', 'selling_price' => 95, 'mrp' => 110, 'tax' => 0, 'category' => 'Groceries', 'hsn_code' => '1006', 'stock' => 120, 'weighed' => true],
            ['name' => 'Sugar (Loose)', 'unit' => 'kg', 'product_type' => 'weighed', 'plu_code' => '00102', 'selling_price' => 46, 'mrp' => 50, 'tax' => 5, 'category' => 'Groceries', 'hsn_code' => '1701', 'stock' => 80, 'weighed' => true],
            ['name' => 'Tomato', 'unit' => 'kg', 'product_type' => 'weighed', 'plu_code' => '00201', 'selling_price' => 32, 'mrp' => null, 'tax' => 0, 'category' => 'Fruits & Vegetables', 'hsn_code' => '0702', 'stock' => 40, 'weighed' => true],
            ['name' => 'Onion', 'unit' => 'kg', 'product_type' => 'weighed', 'plu_code' => '00202', 'selling_price' => 38, 'mrp' => null, 'tax' => 0, 'category' => 'Fruits & Vegetables', 'hsn_code' => '0703', 'stock' => 60, 'weighed' => true],
            ['name' => 'Robusta Banana', 'unit' => 'dozen', 'selling_price' => 60, 'mrp' => null, 'tax' => 0, 'category' => 'Fruits & Vegetables', 'hsn_code' => '0803', 'stock' => 25],
            ['name' => 'Sona Masoori Rice 5kg', 'selling_price' => 385, 'mrp' => 420, 'tax' => 5, 'category' => 'Groceries', 'hsn_code' => '1006', 'stock' => 30],
            ['name' => 'Aashirvaad Atta 5kg', 'selling_price' => 245, 'mrp' => 265, 'tax' => 5, 'category' => 'Groceries', 'hsn_code' => '1101', 'stock' => 24],
            ['name' => 'Toor Dal 1kg', 'selling_price' => 165, 'mrp' => 180, 'tax' => 5, 'category' => 'Groceries', 'hsn_code' => '0713', 'stock' => 40],
            ['name' => 'Amul Butter 500g', 'selling_price' => 285, 'mrp' => 285, 'tax' => 12, 'category' => 'Dairy', 'hsn_code' => '0405', 'stock' => 18, 'track_expiry' => true],
            ['name' => 'Milma Milk 500ml', 'selling_price' => 28, 'mrp' => 28, 'tax' => 0, 'category' => 'Dairy', 'hsn_code' => '0401', 'stock' => 60],
            ['name' => 'Britannia Good Day 200g', 'selling_price' => 40, 'mrp' => 40, 'tax' => 18, 'category' => 'Snacks', 'hsn_code' => '1905', 'stock' => 48],
            ['name' => 'Maggi Noodles 70g', 'selling_price' => 14, 'mrp' => 14, 'tax' => 18, 'category' => 'Snacks', 'hsn_code' => '1902', 'stock' => 120],
            ['name' => 'Coca-Cola 750ml', 'selling_price' => 45, 'mrp' => 45, 'tax' => 18, 'category' => 'Beverages', 'hsn_code' => '2202', 'stock' => 36],
            ['name' => 'Surf Excel Matic 1kg', 'selling_price' => 140, 'mrp' => 150, 'tax' => 18, 'category' => 'Household', 'hsn_code' => '3402', 'stock' => 3],
            ['name' => 'Colgate Strong Teeth 200g', 'selling_price' => 110, 'mrp' => 118, 'tax' => 18, 'category' => 'Personal Care', 'hsn_code' => '3306', 'stock' => 32],
        ];
        $catalog = [];
        foreach ($items as $i => $item) {
            $stock = $item['stock'];
            $weighed = $item['weighed'] ?? false;
            unset($item['stock'], $item['weighed']);
            $id = $b->product($item + ['barcode' => $weighed ? null : self::ean(4100 + $i), 'sku' => 'FM'.str_pad((string) ($i + 1), 4, '0', STR_PAD_LEFT), 'reorder_level' => $weighed ? 10 : 6], $stock);
            $catalog[] = ['product_id' => $id, 'name' => $item['name'], 'unit_price' => $item['selling_price'], 'tax' => $item['tax'], 'weighed' => $weighed];
        }
        $customers = [
            $b->customer('Lakshmi Pillai', '9847100001', ['email' => 'lakshmi@example.com', 'tier' => 'Gold']),
            $b->customer('Thomas Mathew', '9847100002', ['credit_limit' => 5000]),
            $b->customer('Fatima Rahman', '9847100003'),
        ];
        $b->supplier('Kerala Agro Wholesale', '9846200001', ['gstin' => self::gstin('32AADCK8899L1Z')]);
        $b->supplier('HUL Distributor - Kochi', '9846200002');
        $this->history($b, $catalog, $customers, 60);
        // A credit customer with an outstanding balance.
        $b->sale([$catalog[5] + ['quantity' => 2], $catalog[7] + ['quantity' => 3]], $customers[1], now()->subDays(3), [['method' => 'credit', 'amount' => 1265]]);

        // Cashier account for this store.
        $cashier = User::query()->create(['name' => 'Divya K', 'email' => 'cashier@shopdesk.test', 'phone' => '9847099999', 'password' => self::PASSWORD]);
        BusinessUser::query()->create(['user_id' => $cashier->id, 'role_id' => Role::query()->where('key', 'cashier')->value('id'), 'status' => 'active']);
        $b->leave();
    }

    private function pharmacy(User $owner): void
    {
        $b = $this->business($owner, [
            'name' => 'HealthCare Pharmacy', 'business_type' => 'pharmacy', 'state_code' => '32',
            'gstin' => self::gstin('32AAHCH1234P1Z'), 'phone' => '9847022222', 'address' => 'Palarivattom, Kochi', 'city' => 'Kochi',
        ]);
        $supplier = $b->supplier('MedLife Distributors', '9846300001', ['gstin' => self::gstin('32AAMCM5566D1Z'), 'credit_days' => 45]);
        $medicines = [
            ['name' => 'Paracetamol 500mg Tablet (10s)', 'generic' => 'Paracetamol', 'mfr' => 'Micro Labs', 'schedule' => 'OTC', 'rx' => false, 'mrp' => 25, 'price' => 22, 'cost' => 15, 'tax' => 12, 'cat' => 'Tablets',
                'batches' => [['ABC123', '+30 months', 100], ['PCM887', '+50 days', 20], ['EXP001', '-20 days', 5]]],
            ['name' => 'Amoxicillin 500mg Capsule (10s)', 'generic' => 'Amoxicillin', 'mfr' => 'Cipla', 'schedule' => 'H', 'rx' => true, 'mrp' => 120, 'price' => 112, 'cost' => 78, 'tax' => 12, 'cat' => 'Capsules',
                'batches' => [['AMX221', '+18 months', 40]]],
            ['name' => 'Cetirizine 10mg Tablet (10s)', 'generic' => 'Cetirizine', 'mfr' => 'Dr. Reddy\'s', 'schedule' => 'H', 'rx' => false, 'mrp' => 35, 'price' => 32, 'cost' => 18, 'tax' => 12, 'cat' => 'Tablets',
                'batches' => [['CTZ510', '+24 months', 60]]],
            ['name' => 'Pantoprazole 40mg Tablet (15s)', 'generic' => 'Pantoprazole', 'mfr' => 'Sun Pharma', 'schedule' => 'H', 'rx' => true, 'mrp' => 150, 'price' => 140, 'cost' => 92, 'tax' => 12, 'cat' => 'Tablets',
                'batches' => [['PAN044', '+15 months', 30]]],
            ['name' => 'Azithromycin 500mg Tablet (3s)', 'generic' => 'Azithromycin', 'mfr' => 'Alkem', 'schedule' => 'H1', 'rx' => true, 'mrp' => 119, 'price' => 115, 'cost' => 70, 'tax' => 12, 'cat' => 'Tablets',
                'batches' => [['AZI902', '+70 days', 12]]],
            ['name' => 'ORS Electrolyte Sachet', 'generic' => 'Oral Rehydration Salts', 'mfr' => 'FDC', 'schedule' => 'OTC', 'rx' => false, 'mrp' => 21, 'price' => 21, 'cost' => 12, 'tax' => 12, 'cat' => 'OTC',
                'batches' => [['ORS777', '+20 months', 80]]],
            ['name' => 'Benadryl Cough Syrup 100ml', 'generic' => 'Diphenhydramine', 'mfr' => 'Johnson & Johnson', 'schedule' => 'OTC', 'rx' => false, 'mrp' => 115, 'price' => 110, 'cost' => 74, 'tax' => 12, 'cat' => 'Syrups',
                'batches' => [['BND115', '+12 months', 25]]],
        ];
        $catalog = [];
        foreach ($medicines as $i => $m) {
            $id = $b->product([
                'name' => $m['name'], 'category' => $m['cat'], 'unit' => 'strip', 'barcode' => self::ean(5200 + $i), 'sku' => 'RX'.str_pad((string) ($i + 1), 4, '0', STR_PAD_LEFT),
                'hsn_code' => '3004', 'selling_price' => $m['price'], 'mrp' => $m['mrp'], 'tax' => $m['tax'], 'track_batch' => true, 'track_expiry' => true, 'reorder_level' => 10,
                'attributes' => ['generic_name' => $m['generic'], 'manufacturer' => $m['mfr'], 'schedule' => $m['schedule'], 'prescription_required' => $m['rx']],
            ], 0, $m['cost']);
            foreach ($m['batches'] as [$batchNo, $expiry, $qty]) {
                $b->purchase($supplier, [[
                    'product_id' => $id, 'name' => $m['name'], 'quantity' => $qty, 'unit_cost' => $m['cost'], 'mrp' => $m['mrp'],
                    'batch_no' => $batchNo, 'expiry_date' => now()->modify($expiry)->toDateString(), 'tax' => $m['tax'],
                ]], now()->subDays(40));
            }
            $batch = ProductBatch::query()->where('product_id', $id)->where('expiry_date', '>', now()->toDateString())->orderBy('expiry_date')->first();
            $catalog[] = ['product_id' => $id, 'name' => $m['name'], 'unit_price' => $m['price'], 'tax' => $m['tax'], 'batch_id' => $batch?->id, 'hsn_code' => '3004'];
        }
        $b->product(['name' => 'Digital Thermometer', 'category' => 'Surgical', 'barcode' => self::ean(5300), 'hsn_code' => '9025', 'selling_price' => 299, 'mrp' => 349, 'tax' => 18], 15, 180);
        $customers = [$b->customer('Rajan Varghese', '9847200001'), $b->customer('Anjali Das', '9847200002')];
        $this->history($b, $catalog, $customers, 25);
        $b->leave();
    }

    private function jewellery(User $owner): void
    {
        $b = $this->business($owner, [
            'name' => 'Royal Gold Jewellery', 'business_type' => 'jewellery', 'state_code' => '32',
            'gstin' => self::gstin('32AAFCR7788J1Z'), 'phone' => '9847033333', 'address' => 'Broadway, Kochi', 'city' => 'Kochi',
        ]);
        foreach ([['gold', '24K', 11850], ['gold', '22K', 10865], ['gold', '18K', 8890], ['silver', 'S999', 142], ['silver', 'S925', 131], ['platinum', 'PT950', 4250]] as [$metal, $purity, $rate]) {
            $b->op('CREATE_METAL_RATE', 'metal_rate', ['metal' => $metal, 'purity' => $purity, 'rate_per_gram' => $rate, 'effective_from' => now()->startOfDay()->toIso8601String()]);
        }
        $pieces = [
            ['22K Gold Necklace - Lakshmi Design', 'Gold Ornaments', ['metal' => 'gold', 'purity' => '22K', 'gross_weight' => 24.58, 'net_weight' => 23.95, 'stone_weight' => 0.63, 'making_charge_type' => 'percent', 'making_charge_value' => 12, 'wastage_type' => 'percent', 'wastage_value' => 2, 'stone_charges' => 3500, 'other_charges' => 0, 'design_no' => 'NK-1042', 'huid' => 'AB12CD']],
            ['22K Gold Bangles (Pair)', 'Gold Ornaments', ['metal' => 'gold', 'purity' => '22K', 'gross_weight' => 32.1, 'net_weight' => 32.1, 'stone_weight' => 0, 'making_charge_type' => 'per_gram', 'making_charge_value' => 450, 'wastage_type' => 'percent', 'wastage_value' => 1.5, 'stone_charges' => 0, 'other_charges' => 0, 'design_no' => 'BG-2210', 'huid' => 'XK94PL']],
            ['22K Gold Ring - Floral', 'Gold Ornaments', ['metal' => 'gold', 'purity' => '22K', 'gross_weight' => 4.12, 'net_weight' => 4.12, 'stone_weight' => 0, 'making_charge_type' => 'per_gram', 'making_charge_value' => 550, 'wastage_type' => 'percent', 'wastage_value' => 2, 'stone_charges' => 0, 'other_charges' => 0, 'design_no' => 'RG-0311', 'huid' => 'QW33ER']],
            ['18K Diamond Solitaire Ring', 'Diamond', ['metal' => 'gold', 'purity' => '18K', 'gross_weight' => 4.25, 'net_weight' => 3.9, 'stone_weight' => 0.35, 'making_charge_type' => 'fixed', 'making_charge_value' => 3500, 'wastage_type' => 'percent', 'wastage_value' => 0, 'stone_charges' => 45000, 'other_charges' => 500, 'design_no' => 'DR-7001', 'huid' => 'DM77SR']],
            ['Silver Anklets (Pair) S925', 'Silver Ornaments', ['metal' => 'silver', 'purity' => 'S925', 'gross_weight' => 45, 'net_weight' => 45, 'stone_weight' => 0, 'making_charge_type' => 'per_gram', 'making_charge_value' => 25, 'wastage_type' => 'percent', 'wastage_value' => 0, 'stone_charges' => 0, 'other_charges' => 0, 'design_no' => 'SA-0045', 'huid' => null]],
            ['24K Gold Coin 10g', 'Coins & Bars', ['metal' => 'gold', 'purity' => '24K', 'gross_weight' => 10, 'net_weight' => 10, 'stone_weight' => 0, 'making_charge_type' => 'fixed', 'making_charge_value' => 500, 'wastage_type' => 'percent', 'wastage_value' => 0, 'stone_charges' => 0, 'other_charges' => 0, 'design_no' => 'CN-0010', 'huid' => 'GC10GM']],
        ];
        foreach ($pieces as $i => [$name, $cat, $attrs]) {
            $b->product([
                'name' => $name, 'product_type' => 'jewellery', 'category' => $cat, 'unit' => 'pcs', 'barcode' => self::ean(7700 + $i, '20'), 'sku' => 'RG'.str_pad((string) ($i + 1), 4, '0', STR_PAD_LEFT),
                'hsn_code' => '7113', 'selling_price' => 0, 'mrp' => null, 'tax' => 3, 'price_includes_tax' => false, 'reorder_level' => 0, 'attributes' => $attrs,
            ], 1, 0);
        }
        $customer = $b->customer('Sreedevi Menon', '9847300001');
        $b->op('CREATE_JEWELLERY_ORDER', 'jewellery_order', [
            'store_id' => $b->store->id, 'order_number' => 'JO-'.now()->year.'-00001', 'type' => 'repair', 'customer_id' => $customer, 'customer_name' => 'Sreedevi Menon',
            'customer_phone' => '9847300001', 'description' => 'Chain clasp repair and polishing', 'metal' => 'gold', 'purity' => '22K', 'weight' => 12.4,
            'estimated_amount' => 850, 'advance_paid' => 300, 'advance_method' => 'cash', 'due_date' => now()->addDays(4)->toDateString(), 'status' => 'in_progress',
        ]);
        $b->leave();
    }

    private function mobile(User $owner): void
    {
        $b = $this->business($owner, [
            'name' => 'SmartMobile Store', 'business_type' => 'mobile', 'state_code' => '32',
            'gstin' => self::gstin('32AAGCS3456K1Z'), 'phone' => '9847044444', 'address' => 'Kaloor, Kochi', 'city' => 'Kochi',
        ]);
        $supplier = $b->supplier('Redington India - Kochi', '9846400001', ['credit_days' => 15]);
        $phones = [
            ['Samsung Galaxy A55 5G (8GB/128GB, Awesome Navy)', 'Samsung', 'Galaxy A55', '8GB', '128GB', 'Awesome Navy', 31999, 35999, 27500, '35693803564'],
            ['Apple iPhone 16 (128GB, Black)', 'Apple', 'iPhone 16', '8GB', '128GB', 'Black', 69900, 79900, 62000, '35345612789'],
            ['Redmi Note 14 Pro 5G (8GB/256GB, Titan Black)', 'Xiaomi', 'Redmi Note 14 Pro', '8GB', '256GB', 'Titan Black', 24999, 28999, 21000, '86412305567'],
        ];
        $catalog = [];
        foreach ($phones as $i => [$name, $brand, $model, $ram, $storage, $color, $price, $mrp, $cost, $imeiPrefix]) {
            $id = $b->product([
                'name' => $name, 'category' => 'Smartphones', 'barcode' => self::ean(8800 + $i), 'sku' => 'PH'.str_pad((string) ($i + 1), 4, '0', STR_PAD_LEFT), 'hsn_code' => '8517',
                'selling_price' => $price, 'mrp' => $mrp, 'tax' => 18, 'track_serial' => true, 'warranty_months' => 12, 'reorder_level' => 2,
                'attributes' => ['brand' => $brand, 'model' => $model, 'ram' => $ram, 'storage' => $storage, 'color' => $color],
            ], 0, $cost);
            $imeis = array_map(fn ($n) => self::imei($imeiPrefix.str_pad((string) $n, 3, '0', STR_PAD_LEFT)), range(1, 4));
            $b->purchase($supplier, [['product_id' => $id, 'name' => $name, 'quantity' => 4, 'unit_cost' => $cost, 'serial_numbers' => $imeis, 'tax' => 18]], now()->subDays(20));
            $catalog[] = ['id' => $id, 'name' => $name, 'price' => $price];
        }
        foreach ([['20W USB-C Fast Charger', 999, 'Chargers'], ['Type-C to Type-C Cable 1m', 299, 'Cables'], ['Tempered Glass Screen Guard', 199, 'Screen Protectors'], ['Silicone Back Case', 349, 'Cases'], ['boAt Airdopes 141', 1299, 'Earbuds'], ['10000mAh Power Bank', 1499, 'Power Banks']] as $i => [$name, $price, $cat]) {
            $b->product(['name' => $name, 'category' => $cat, 'barcode' => self::ean(8900 + $i), 'hsn_code' => '8504', 'selling_price' => $price, 'mrp' => round($price * 1.2), 'tax' => 18], 25);
        }
        $customer = $b->customer('Kevin Joseph', '9847400001', ['email' => 'kevin@example.com']);
        $serial = ProductSerial::query()->where('product_id', $catalog[0]['id'])->where('status', 'in_stock')->first();
        $b->sale([[
            'product_id' => $catalog[0]['id'], 'name' => $catalog[0]['name'], 'quantity' => 1, 'unit_price' => $catalog[0]['price'], 'tax' => 18,
            'serial_ids' => [$serial->id], 'serial_numbers' => [$serial->serial_no], 'hsn_code' => '8517',
        ]], $customer, now()->subDays(2), [['method' => 'upi', 'amount' => $catalog[0]['price'], 'reference' => 'UPI-'.Str::upper(Str::random(10))]]);
        $b->leave();
    }

    private function clothing(User $owner): void
    {
        $b = $this->business($owner, [
            'name' => 'Fashion Hub', 'business_type' => 'clothing', 'state_code' => '32',
            'gstin' => self::gstin('32AAFCF2468H1Z'), 'phone' => '9847055555', 'address' => 'Lulu Mall, Edappally', 'city' => 'Kochi',
        ]);
        $styles = [
            ['Classic Crew Neck T-Shirt', 'Men', ['S', 'M', 'L', 'XL'], ['Black', 'White'], 499, 5, 'TEE'],
            ['Slim Fit Stretch Jeans', 'Men', ['30', '32', '34', '36'], ['Indigo'], 1299, 5, 'JNS'],
            ['Cotton Straight Kurta', 'Women', ['S', 'M', 'L'], ['Maroon', 'Navy'], 899, 5, 'KUR'],
            ['Kids Printed Hoodie', 'Kids', ['4Y', '6Y', '8Y'], ['Yellow', 'Grey'], 749, 5, 'HOD'],
        ];
        $seq = 1;
        foreach ($styles as [$name, $cat, $sizes, $colors, $price, $tax, $code]) {
            $variants = [];
            foreach ($colors as $color) {
                foreach ($sizes as $size) {
                    $variants[] = [
                        'id' => (string) Str::uuid7(), 'name' => "{$size} / {$color}", 'sku' => "{$code}-{$size}-".strtoupper(substr($color, 0, 3)),
                        'barcode' => self::ean(9100 + $seq++, '20'), 'attributes' => ['Size' => $size, 'Color' => $color],
                        'selling_price' => $price, 'mrp' => $price, 'purchase_price' => round($price * 0.55, 2), 'active' => true, 'sort_order' => count($variants),
                    ];
                }
            }
            $id = $b->product([
                'name' => $name, 'category' => $cat, 'sku' => $code, 'hsn_code' => '6109', 'selling_price' => $price, 'mrp' => $price, 'tax' => $tax,
                'has_variants' => true, 'variant_attributes' => [['name' => 'Size', 'values' => $sizes], ['name' => 'Color', 'values' => $colors]],
                'variants' => $variants, 'attributes' => ['material' => 'Cotton', 'season' => 'All Season'], 'reorder_level' => 3,
            ], 0, round($price * 0.55, 2));
            foreach ($variants as $v) {
                $b->openingStock($id, mt_rand(3, 12), round($price * 0.55, 2), $v['id']);
            }
        }
        $b->product(['name' => 'Running Shoes - Air Flex', 'category' => 'Footwear', 'barcode' => self::ean(9500), 'hsn_code' => '6404', 'selling_price' => 2499, 'mrp' => 2999, 'tax' => 12], 10, 1400);
        $b->customer('Neha Sharma', '9847500001');
        $b->leave();
    }

    private function electronics(User $owner): void
    {
        $b = $this->business($owner, [
            'name' => 'TechZone Electronics', 'business_type' => 'electronics', 'state_code' => '33',
            'gstin' => self::gstin('33AAGCT9876E1Z'), 'phone' => '9840066666', 'address' => 'T. Nagar, Chennai', 'city' => 'Chennai',
        ]);
        $supplier = $b->supplier('Sony India Distribution', '9840100001');
        foreach ([
            ['Sony Bravia 55" 4K Google TV', 'Televisions', 64990, 74990, 52000, 24, 'SNYB55'],
            ['HP 15s Laptop (i5, 16GB, 512GB SSD)', 'Laptops', 58990, 66990, 49000, 12, 'HP15S'],
            ['LG 260L Frost-Free Refrigerator', 'Appliances', 27490, 32990, 22500, 12, 'LG260'],
        ] as $i => [$name, $cat, $price, $mrp, $cost, $warranty, $prefix]) {
            $id = $b->product(['name' => $name, 'category' => $cat, 'barcode' => self::ean(6100 + $i), 'hsn_code' => '8528', 'selling_price' => $price, 'mrp' => $mrp, 'tax' => 18, 'track_serial' => true, 'warranty_months' => $warranty, 'reorder_level' => 1], 0, $cost);
            $b->purchase($supplier, [['product_id' => $id, 'name' => $name, 'quantity' => 3, 'unit_cost' => $cost, 'tax' => 18, 'serial_numbers' => array_map(fn ($n) => $prefix.'-'.now()->format('y').str_pad((string) $n, 5, '0', STR_PAD_LEFT), range(1, 3))]], now()->subDays(15));
        }
        foreach ([['JBL Flip 6 Bluetooth Speaker', 'Audio', 9999], ['Logitech M331 Silent Wireless Mouse', 'Accessories', 795], ['HDMI 2.1 Cable 2m', 'Accessories', 399]] as $i => [$name, $cat, $price]) {
            $b->product(['name' => $name, 'category' => $cat, 'barcode' => self::ean(6200 + $i), 'hsn_code' => '8518', 'selling_price' => $price, 'mrp' => round($price * 1.15), 'tax' => 18], 12);
        }
        $b->customer('Karthik Raja', '9840200001', ['state_code' => '33']);
        $b->leave();
    }

    private function restaurant(User $owner): void
    {
        $b = $this->business($owner, [
            'name' => 'Spice Garden Restaurant', 'business_type' => 'restaurant', 'state_code' => '32',
            'gstin' => self::gstin('32AAKFS1357R1Z'), 'phone' => '9847077777', 'address' => 'Fort Kochi', 'city' => 'Kochi',
        ]);
        foreach (range(1, 8) as $n) {
            $b->op('CREATE_RESTAURANT_TABLE', 'restaurant_table', ['store_id' => $b->store->id, 'name' => "T{$n}", 'area' => $n <= 5 ? 'Indoor' : 'Garden', 'capacity' => $n % 3 === 0 ? 6 : 4, 'sort_order' => $n, 'active' => true]);
        }
        $menu = [
            ['Paneer Butter Masala', 'Main Course', 280, []],
            ['Chicken Biryani', 'Rice', 320, [['id' => (string) Str::uuid7(), 'name' => 'Add-ons', 'min' => 0, 'max' => 3, 'options' => [['id' => (string) Str::uuid7(), 'name' => 'Extra Raita', 'price' => 30], ['id' => (string) Str::uuid7(), 'name' => 'Extra Chicken', 'price' => 90], ['id' => (string) Str::uuid7(), 'name' => 'Boiled Egg', 'price' => 20]]]]],
            ['Masala Dosa', 'Starters', 120, []],
            ['Butter Naan', 'Breads', 55, []],
            ['Veg Fried Rice', 'Rice', 180, []],
            ['Kerala Fish Curry', 'Main Course', 340, [['id' => (string) Str::uuid7(), 'name' => 'Spice level', 'min' => 1, 'max' => 1, 'options' => [['id' => (string) Str::uuid7(), 'name' => 'Mild', 'price' => 0], ['id' => (string) Str::uuid7(), 'name' => 'Medium', 'price' => 0], ['id' => (string) Str::uuid7(), 'name' => 'Hot', 'price' => 0]]]]],
            ['Gulab Jamun (2 pcs)', 'Desserts', 90, []],
            ['Fresh Lime Soda', 'Beverages', 80, [['id' => (string) Str::uuid7(), 'name' => 'Style', 'min' => 1, 'max' => 1, 'options' => [['id' => (string) Str::uuid7(), 'name' => 'Sweet', 'price' => 0], ['id' => (string) Str::uuid7(), 'name' => 'Salted', 'price' => 0]]]]],
            ['Filter Coffee', 'Beverages', 45, []],
        ];
        $catalog = [];
        foreach ($menu as $i => [$name, $cat, $price, $modifiers]) {
            $id = $b->product(['name' => $name, 'category' => $cat, 'unit' => 'plate', 'sku' => 'MN'.str_pad((string) ($i + 1), 3, '0', STR_PAD_LEFT), 'hsn_code' => '9963', 'selling_price' => $price, 'mrp' => null, 'tax' => 5, 'price_includes_tax' => false, 'track_inventory' => false, 'modifiers' => $modifiers, 'reorder_level' => 0]);
            $catalog[] = ['product_id' => $id, 'name' => $name, 'unit_price' => $price, 'tax' => 5, 'inclusive' => false];
        }
        $this->history($b, $catalog, [], 30);
        $b->leave();
    }
}

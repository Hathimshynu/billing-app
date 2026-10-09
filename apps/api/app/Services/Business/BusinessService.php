<?php

namespace App\Services\Business;

use App\Domain\Auth\Permissions;
use App\Domain\Business\BusinessTypes;
use App\Models\Business;
use App\Models\BusinessSetting;
use App\Models\BusinessUser;
use App\Models\Category;
use App\Models\ExpenseCategory;
use App\Models\Permission;
use App\Models\Role;
use App\Models\Store;
use App\Models\TaxRate;
use App\Models\Unit;
use App\Models\User;
use App\Services\Audit\AuditLogger;
use App\Support\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;

/**
 * Business onboarding: creates the business with sensible defaults for its industry — roles &
 * permissions, a default store, units, tax rates, categories, expense categories and settings.
 */
class BusinessService
{
    public function __construct(
        private readonly TenantContext $tenant,
        private readonly AuditLogger $audit,
    ) {}

    public static function syncPermissionCatalogue(): void
    {
        $now = now();
        $rows = array_map(fn (string $key) => [
            'key' => $key,
            'group' => Permissions::groupOf($key),
            'description' => $key,
            'created_at' => $now,
            'updated_at' => $now,
        ], Permissions::all());
        Permission::query()->upsert($rows, ['key'], ['group', 'updated_at']);
    }

    /** @param array<string, mixed> $data */
    public function create(User $owner, array $data): Business
    {
        return DB::transaction(function () use ($owner, $data) {
            self::syncPermissionCatalogue();
            $type = $data['business_type'];
            $defaults = BusinessTypes::DEFAULTS[$type] ?? BusinessTypes::DEFAULTS['general'];
            $taxSystem = $data['tax_system'] ?? 'gst';

            $business = Business::query()->create([
                'owner_id' => $owner->id,
                'name' => $data['name'],
                'legal_name' => $data['legal_name'] ?? null,
                'business_type' => $type,
                'modules' => array_values(array_unique($data['modules'] ?? $defaults['modules'])),
                'country' => $data['country'] ?? 'IN',
                'currency' => $data['currency'] ?? 'INR',
                'currency_decimals' => $data['currency_decimals'] ?? 2,
                'locale' => $data['locale'] ?? 'en-IN',
                'timezone' => $data['timezone'] ?? 'Asia/Kolkata',
                'date_format' => $data['date_format'] ?? 'DD/MM/YYYY',
                'tax_system' => $taxSystem,
                'gstin' => $data['gstin'] ?? null,
                'state_code' => $data['state_code'] ?? (! empty($data['gstin']) ? substr($data['gstin'], 0, 2) : null),
                'fy_start_month' => $data['fy_start_month'] ?? (($data['country'] ?? 'IN') === 'IN' ? 4 : 1),
                'phone' => $data['phone'] ?? null,
                'email' => $data['email'] ?? null,
                'address' => $data['address'] ?? null,
                'city' => $data['city'] ?? null,
                'pincode' => $data['pincode'] ?? null,
            ]);

            $previous = $this->tenant->hasBusiness() ? $this->tenant->business() : null;
            $this->tenant->setBusiness($business);
            try {
                $roles = $this->createRoles();
                $store = Store::query()->create([
                    'name' => $data['store_name'] ?? 'Main Store',
                    'code' => 'MAIN',
                    'address' => $data['address'] ?? null,
                    'phone' => $data['phone'] ?? null,
                    'gstin' => $data['gstin'] ?? null,
                    'state_code' => $business->state_code,
                    'is_default' => true,
                ]);
                BusinessUser::query()->create([
                    'user_id' => $owner->id,
                    'role_id' => $roles['owner']->id,
                    'status' => 'active',
                ]);
                $this->createCatalogDefaults($business, $defaults, $taxSystem);
                $this->createSettings($defaults);
                $this->audit->log('BUSINESS_CREATED', 'business', $business->id, null, ['name' => $business->name, 'type' => $type], $owner->id, null, $business->id);
                $business->setRelation('defaultStore', $store);
            } finally {
                $this->tenant->setBusiness($previous);
            }

            return $business;
        });
    }

    /** @return array<string, Role> */
    private function createRoles(): array
    {
        $permissionIds = Permission::query()->pluck('id', 'key');
        $roles = [];
        foreach (Permissions::defaultRoles() as $key => $def) {
            $role = Role::query()->create([
                'key' => $key,
                'name' => $def['name'],
                'description' => $def['description'],
                'is_system' => true,
            ]);
            $role->permissions()->sync($permissionIds->only($def['permissions'])->values()->all());
            $roles[$key] = $role;
        }

        return $roles;
    }

    /** @param array<string, mixed> $defaults */
    private function createCatalogDefaults(Business $business, array $defaults, string $taxSystem): void
    {
        foreach ($defaults['units'] as $code) {
            $def = BusinessTypes::UNITS[$code] ?? ['name' => strtoupper($code), 'decimal' => false];
            Unit::query()->create(['code' => $code, 'name' => $def['name'], 'allow_decimal' => $def['decimal']]);
        }

        $kind = match ($taxSystem) {
            'gst' => 'gst',
            'vat' => 'vat',
            'none' => 'exempt',
            default => 'simple',
        };
        $first = true;
        foreach ($defaults['taxes'] as $rate) {
            if ($taxSystem === 'none') {
                break;
            }
            $label = match ($kind) {
                'gst' => $rate == 0 ? 'GST Exempt (0%)' : "GST {$rate}%",
                'vat' => "VAT {$rate}%",
                default => "Tax {$rate}%",
            };
            TaxRate::query()->create([
                'name' => $label,
                'kind' => $rate == 0 ? 'exempt' : $kind,
                'rate' => $rate,
                'cess_rate' => 0,
                'is_default' => $first && $rate > 0 ? true : false,
            ]);
            if ($rate > 0) {
                $first = false;
            }
        }
        if ($taxSystem === 'none') {
            TaxRate::query()->create(['name' => 'No Tax', 'kind' => 'exempt', 'rate' => 0, 'cess_rate' => 0, 'is_default' => true]);
        }

        foreach ($defaults['categories'] as $i => $name) {
            Category::query()->create(['name' => $name, 'sort_order' => $i]);
        }
        foreach (BusinessTypes::EXPENSE_CATEGORIES as $name) {
            ExpenseCategory::query()->create(['name' => $name]);
        }
    }

    /** @param array<string, mixed> $defaults */
    private function createSettings(array $defaults): void
    {
        foreach (self::defaultSettings($defaults) as $key => $value) {
            BusinessSetting::query()->create(['key' => $key, 'value' => $value]);
        }
    }

    /**
     * @param  array<string, mixed>  $defaults
     * @return array<string, array<string, mixed>>
     */
    public static function defaultSettings(array $defaults = []): array
    {
        return [
            'invoice' => [
                'formats' => (object) [],
                'terms' => 'Goods once sold will not be taken back without the bill.',
                'footer' => 'Thank you for shopping with us!',
                'show_hsn_summary' => true,
                'show_mrp_savings' => true,
                'round_off' => '1.00',
                'default_doc_type' => 'invoice',
                'number_block_size' => 50,
                'quotation_validity_days' => 15,
                'upi_id' => null,
                'bank_details' => null,
                'prices_include_tax' => $defaults['inclusive'] ?? true,
            ],
            'pos' => [
                'allow_negative_stock' => true,
                'default_customer_required' => false,
                'quick_amounts' => [100, 200, 500, 2000],
                'enabled_payment_methods' => ['cash', 'upi', 'card', 'credit'],
                'print_after_sale' => true,
                'require_register' => false,
                'scale_barcode' => [
                    'enabled' => in_array('weighing', $defaults['modules'] ?? [], true),
                    'prefixes' => ['2'],
                    'item_code_length' => 5,
                    'value_type' => 'weight',
                    'value_length' => 5,
                    'value_decimals' => 3,
                    'validate_check_digit' => true,
                ],
                'near_expiry_days' => 90,
                'max_discount_percent' => 100,
                'service_charge_percent' => 0,
                'service_charge_tax_rate_id' => null,
                'shortcuts' => (object) [],
                'product_grid' => 'grid',
            ],
            'printer' => [
                'paper' => '80mm',
                'connection' => 'browser',
                'copies' => 1,
                'show_logo' => true,
                'header_text' => '',
                'footer_text' => '',
                'kot_paper' => '80mm',
            ],
            'loyalty' => [
                'enabled' => in_array('loyalty', $defaults['modules'] ?? [], true),
                'earn_per_100' => 1,
                'point_value' => 1,
                'min_redeem_points' => 50,
                'tiers' => [['name' => 'Silver', 'min_spend' => 0], ['name' => 'Gold', 'min_spend' => 25000], ['name' => 'Platinum', 'min_spend' => 100000]],
            ],
            'notifications' => [
                'low_stock' => true,
                'expiry' => true,
                'near_expiry_days' => 90,
                'customer_dues' => true,
                'supplier_dues' => true,
                'register_mismatch' => true,
                'sync_failed' => true,
            ],
        ];
    }
}

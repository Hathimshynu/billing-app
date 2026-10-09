<?php

namespace App\Domain\Auth;

/**
 * Permission catalogue and default role templates. Mirrors packages/shared/src/permissions.ts.
 * The server is the authority: every REST request and every synced operation is checked here.
 */
final class Permissions
{
    /** @var array<string, list<string>> */
    public const GROUPS = [
        'dashboard' => ['dashboard.view'],
        'sales' => [
            'sales.view', 'sales.create', 'sales.discount', 'sales.price_override', 'sales.credit',
            'sales.credit_override', 'sales.refund', 'sales.delete', 'sales.sell_expired', 'sales.view_all',
        ],
        'products' => ['products.view', 'products.create', 'products.edit', 'products.delete', 'products.view_cost'],
        'inventory' => ['inventory.view', 'inventory.adjust', 'inventory.transfer'],
        'purchases' => ['purchases.view', 'purchases.create', 'purchases.edit', 'purchases.delete', 'purchases.return'],
        'customers' => ['customers.view', 'customers.create', 'customers.edit', 'customers.delete', 'customers.payments'],
        'suppliers' => ['suppliers.view', 'suppliers.create', 'suppliers.edit', 'suppliers.delete', 'suppliers.payments'],
        'expenses' => ['expenses.view', 'expenses.create', 'expenses.delete'],
        'cash_register' => ['cash_register.open', 'cash_register.close', 'cash_register.manage'],
        'reports' => ['reports.view', 'reports.financial'],
        'industry' => ['restaurant.manage', 'kitchen.view', 'jewellery.rates', 'jewellery.orders'],
        'administration' => [
            'settings.manage', 'users.manage', 'roles.manage', 'devices.manage', 'stores.manage',
            'audit.view', 'sync.manage', 'backup.manage', 'data.import', 'data.export',
        ],
    ];

    /** @return list<string> */
    public static function all(): array
    {
        return array_merge(...array_values(self::GROUPS));
    }

    public static function groupOf(string $permission): string
    {
        foreach (self::GROUPS as $group => $permissions) {
            if (in_array($permission, $permissions, true)) {
                return $group;
            }
        }

        return 'other';
    }

    /** @return array<string, array{name: string, description: string, permissions: list<string>}> */
    public static function defaultRoles(): array
    {
        $all = self::all();
        $without = fn (string ...$excluded) => array_values(array_diff($all, $excluded));

        return [
            'owner' => ['name' => 'Owner', 'description' => 'Full access to everything', 'permissions' => $all],
            'admin' => ['name' => 'Admin', 'description' => 'Full access except ownership', 'permissions' => $all],
            'manager' => [
                'name' => 'Manager',
                'description' => 'Runs the store day to day',
                'permissions' => $without('roles.manage', 'backup.manage', 'devices.manage', 'stores.manage', 'settings.manage'),
            ],
            'cashier' => [
                'name' => 'Cashier',
                'description' => 'Billing at the counter',
                'permissions' => [
                    'dashboard.view', 'sales.view', 'sales.create', 'sales.discount', 'sales.credit', 'products.view',
                    'inventory.view', 'customers.view', 'customers.create', 'customers.payments', 'cash_register.open',
                    'cash_register.close', 'cash_register.manage', 'expenses.create', 'restaurant.manage', 'kitchen.view',
                ],
            ],
            'inventory_manager' => [
                'name' => 'Inventory Manager',
                'description' => 'Products, stock and purchasing',
                'permissions' => [
                    'dashboard.view', 'products.view', 'products.create', 'products.edit', 'products.view_cost',
                    'inventory.view', 'inventory.adjust', 'inventory.transfer', 'purchases.view', 'purchases.create',
                    'purchases.edit', 'purchases.return', 'suppliers.view', 'suppliers.create', 'suppliers.edit',
                    'reports.view', 'data.import', 'data.export',
                ],
            ],
            'accountant' => [
                'name' => 'Accountant',
                'description' => 'Finance, ledgers and reports',
                'permissions' => [
                    'dashboard.view', 'sales.view', 'sales.view_all', 'products.view', 'products.view_cost',
                    'purchases.view', 'customers.view', 'customers.payments', 'suppliers.view', 'suppliers.payments',
                    'expenses.view', 'expenses.create', 'expenses.delete', 'reports.view', 'reports.financial',
                    'data.export', 'audit.view',
                ],
            ],
            'pharmacist' => [
                'name' => 'Pharmacist',
                'description' => 'Dispensing and batch management',
                'permissions' => [
                    'dashboard.view', 'sales.view', 'sales.create', 'sales.discount', 'sales.refund', 'products.view',
                    'products.edit', 'inventory.view', 'inventory.adjust', 'customers.view', 'customers.create',
                    'purchases.view', 'cash_register.open', 'cash_register.close',
                ],
            ],
            'sales_staff' => [
                'name' => 'Sales Staff',
                'description' => 'Prepares quotations and sales',
                'permissions' => ['sales.view', 'sales.create', 'products.view', 'inventory.view', 'customers.view', 'customers.create'],
            ],
        ];
    }
}

/**
 * Granular permissions and default role templates. The server is the authority (it re-checks every
 * permission on every request and every synced operation); the client uses the same keys only to
 * hide UI the user cannot use. Mirrored in PHP by App\Domain\Auth\Permissions.
 */

export const PERMISSION_GROUPS = {
  dashboard: ['dashboard.view'],
  sales: [
    'sales.view',
    'sales.create',
    'sales.discount',
    'sales.price_override',
    'sales.credit',
    'sales.credit_override',
    'sales.refund',
    'sales.delete',
    'sales.sell_expired',
    'sales.view_all',
  ],
  products: ['products.view', 'products.create', 'products.edit', 'products.delete', 'products.view_cost'],
  inventory: ['inventory.view', 'inventory.adjust', 'inventory.transfer'],
  purchases: ['purchases.view', 'purchases.create', 'purchases.edit', 'purchases.delete', 'purchases.return'],
  customers: ['customers.view', 'customers.create', 'customers.edit', 'customers.delete', 'customers.payments'],
  suppliers: ['suppliers.view', 'suppliers.create', 'suppliers.edit', 'suppliers.delete', 'suppliers.payments'],
  expenses: ['expenses.view', 'expenses.create', 'expenses.delete'],
  cash_register: ['cash_register.open', 'cash_register.close', 'cash_register.manage'],
  reports: ['reports.view', 'reports.financial'],
  industry: ['restaurant.manage', 'kitchen.view', 'jewellery.rates', 'jewellery.orders'],
  administration: [
    'settings.manage',
    'users.manage',
    'roles.manage',
    'devices.manage',
    'stores.manage',
    'audit.view',
    'sync.manage',
    'backup.manage',
    'data.import',
    'data.export',
  ],
} as const;

export type PermissionGroup = keyof typeof PERMISSION_GROUPS;
export type Permission = (typeof PERMISSION_GROUPS)[PermissionGroup][number];

export const ALL_PERMISSIONS: Permission[] = Object.values(PERMISSION_GROUPS).flat() as Permission[];

export const PERMISSION_LABELS: Record<Permission, string> = {
  'dashboard.view': 'View dashboard',
  'sales.view': 'View sales',
  'sales.create': 'Create sales',
  'sales.discount': 'Give discounts',
  'sales.price_override': 'Change selling price at POS',
  'sales.credit': 'Sell on credit',
  'sales.credit_override': 'Exceed customer credit limit',
  'sales.refund': 'Process returns & refunds',
  'sales.delete': 'Cancel sales',
  'sales.sell_expired': 'Sell expired stock',
  'sales.view_all': "View other cashiers' sales",
  'products.view': 'View products',
  'products.create': 'Create products',
  'products.edit': 'Edit products & prices',
  'products.delete': 'Delete products',
  'products.view_cost': 'View cost prices & margins',
  'inventory.view': 'View inventory',
  'inventory.adjust': 'Adjust stock',
  'inventory.transfer': 'Transfer stock between stores',
  'purchases.view': 'View purchases',
  'purchases.create': 'Create purchases & orders',
  'purchases.edit': 'Receive / edit purchases',
  'purchases.delete': 'Cancel purchases',
  'purchases.return': 'Return purchases',
  'customers.view': 'View customers',
  'customers.create': 'Create customers',
  'customers.edit': 'Edit customers',
  'customers.delete': 'Delete customers',
  'customers.payments': 'Collect customer payments',
  'suppliers.view': 'View suppliers',
  'suppliers.create': 'Create suppliers',
  'suppliers.edit': 'Edit suppliers',
  'suppliers.delete': 'Delete suppliers',
  'suppliers.payments': 'Pay suppliers',
  'expenses.view': 'View expenses',
  'expenses.create': 'Record expenses',
  'expenses.delete': 'Void expenses',
  'cash_register.open': 'Open cash register',
  'cash_register.close': 'Close cash register',
  'cash_register.manage': 'Cash in / cash out',
  'reports.view': 'View reports',
  'reports.financial': 'View profit & financial reports',
  'restaurant.manage': 'Manage tables & orders',
  'kitchen.view': 'Kitchen display',
  'jewellery.rates': 'Update metal rates',
  'jewellery.orders': 'Manage repair & custom orders',
  'settings.manage': 'Manage business settings',
  'users.manage': 'Manage employees',
  'roles.manage': 'Manage roles & permissions',
  'devices.manage': 'Manage devices',
  'stores.manage': 'Manage stores',
  'audit.view': 'View audit log',
  'sync.manage': 'Resolve sync conflicts',
  'backup.manage': 'Backup & restore',
  'data.import': 'Import data',
  'data.export': 'Export data',
};

export type SystemRole =
  | 'owner'
  | 'admin'
  | 'manager'
  | 'cashier'
  | 'inventory_manager'
  | 'accountant'
  | 'pharmacist'
  | 'sales_staff';

const without = (...excluded: Permission[]) => ALL_PERMISSIONS.filter((p) => !excluded.includes(p));

export const DEFAULT_ROLES: Record<SystemRole, { name: string; description: string; permissions: Permission[] }> = {
  owner: { name: 'Owner', description: 'Full access to everything', permissions: [...ALL_PERMISSIONS] },
  admin: { name: 'Admin', description: 'Full access except ownership', permissions: [...ALL_PERMISSIONS] },
  manager: {
    name: 'Manager',
    description: 'Runs the store day to day',
    permissions: without('roles.manage', 'backup.manage', 'devices.manage', 'stores.manage', 'settings.manage'),
  },
  cashier: {
    name: 'Cashier',
    description: 'Billing at the counter',
    permissions: [
      'dashboard.view',
      'sales.view',
      'sales.create',
      'sales.discount',
      'sales.credit',
      'products.view',
      'inventory.view',
      'customers.view',
      'customers.create',
      'customers.payments',
      'cash_register.open',
      'cash_register.close',
      'cash_register.manage',
      'expenses.create',
      'restaurant.manage',
      'kitchen.view',
    ],
  },
  inventory_manager: {
    name: 'Inventory Manager',
    description: 'Products, stock and purchasing',
    permissions: [
      'dashboard.view',
      'products.view',
      'products.create',
      'products.edit',
      'products.view_cost',
      'inventory.view',
      'inventory.adjust',
      'inventory.transfer',
      'purchases.view',
      'purchases.create',
      'purchases.edit',
      'purchases.return',
      'suppliers.view',
      'suppliers.create',
      'suppliers.edit',
      'reports.view',
      'data.import',
      'data.export',
    ],
  },
  accountant: {
    name: 'Accountant',
    description: 'Finance, ledgers and reports',
    permissions: [
      'dashboard.view',
      'sales.view',
      'sales.view_all',
      'products.view',
      'products.view_cost',
      'purchases.view',
      'customers.view',
      'customers.payments',
      'suppliers.view',
      'suppliers.payments',
      'expenses.view',
      'expenses.create',
      'expenses.delete',
      'reports.view',
      'reports.financial',
      'data.export',
      'audit.view',
    ],
  },
  pharmacist: {
    name: 'Pharmacist',
    description: 'Dispensing and batch management',
    permissions: [
      'dashboard.view',
      'sales.view',
      'sales.create',
      'sales.discount',
      'sales.refund',
      'products.view',
      'products.edit',
      'inventory.view',
      'inventory.adjust',
      'customers.view',
      'customers.create',
      'purchases.view',
      'cash_register.open',
      'cash_register.close',
    ],
  },
  sales_staff: {
    name: 'Sales Staff',
    description: 'Prepares quotations and sales',
    permissions: ['sales.view', 'sales.create', 'products.view', 'inventory.view', 'customers.view', 'customers.create'],
  },
};

export function hasPermission(granted: readonly string[] | null | undefined, permission: Permission | Permission[]): boolean {
  if (!granted) return false;
  const required = Array.isArray(permission) ? permission : [permission];
  return required.every((p) => granted.includes(p));
}

export function hasAnyPermission(granted: readonly string[] | null | undefined, permissions: Permission[]): boolean {
  if (!granted) return false;
  return permissions.some((p) => granted.includes(p));
}

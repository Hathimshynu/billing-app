import {
  BarChart3Icon,
  BoxesIcon,
  ChefHatIcon,
  CloudIcon,
  CoinsIcon,
  FileTextIcon,
  GemIcon,
  HomeIcon,
  LandmarkIcon,
  LayoutGridIcon,
  type LucideIcon,
  PackageIcon,
  ReceiptIcon,
  SettingsIcon,
  ShieldCheckIcon,
  ShoppingCartIcon,
  SmartphoneIcon,
  TimerIcon,
  TruckIcon,
  UserCogIcon,
  UsersIcon,
  WalletIcon,
  WrenchIcon,
} from 'lucide-react';
import type { ModuleKey, Permission } from '@shopdesk/shared';

export interface NavItem {
  path: string;
  /** i18n key + English default */
  label: [string, string];
  icon: LucideIcon;
  /** Visible when the user has ANY of these permissions. */
  permissions?: Permission[];
  /** Visible only when ANY of these modules is enabled for the business. */
  modules?: ModuleKey[];
  shortcut?: string;
}

export interface NavGroup {
  label: [string, string];
  items: NavItem[];
}

export const NAVIGATION: NavGroup[] = [
  {
    label: ['nav.group_main', 'Main'],
    items: [
      { path: '/', label: ['nav.dashboard', 'Dashboard'], icon: HomeIcon, permissions: ['dashboard.view'] },
      { path: '/pos', label: ['nav.pos', 'POS'], icon: ShoppingCartIcon, permissions: ['sales.create'] },
      { path: '/sales', label: ['nav.sales', 'Sales'], icon: ReceiptIcon, permissions: ['sales.view'] },
      { path: '/quotations', label: ['nav.quotations', 'Quotations'], icon: FileTextIcon, permissions: ['sales.create'] },
      { path: '/purchases', label: ['nav.purchases', 'Purchases'], icon: TruckIcon, permissions: ['purchases.view'] },
      { path: '/products', label: ['nav.products', 'Products'], icon: PackageIcon, permissions: ['products.view'] },
      { path: '/inventory', label: ['nav.inventory', 'Inventory'], icon: BoxesIcon, permissions: ['inventory.view'] },
      { path: '/customers', label: ['nav.customers', 'Customers'], icon: UsersIcon, permissions: ['customers.view'] },
      { path: '/suppliers', label: ['nav.suppliers', 'Suppliers'], icon: LandmarkIcon, permissions: ['suppliers.view'] },
      { path: '/expenses', label: ['nav.expenses', 'Expenses'], icon: WalletIcon, permissions: ['expenses.view', 'expenses.create'] },
      { path: '/reports', label: ['nav.reports', 'Reports'], icon: BarChart3Icon, permissions: ['reports.view'] },
    ],
  },
  {
    label: ['nav.group_industry', 'Industry modules'],
    items: [
      { path: '/restaurant/tables', label: ['nav.tables', 'Tables & Orders'], icon: LayoutGridIcon, modules: ['restaurant'], permissions: ['restaurant.manage'] },
      { path: '/restaurant/kitchen', label: ['nav.kitchen', 'Kitchen Display'], icon: ChefHatIcon, modules: ['restaurant'], permissions: ['kitchen.view', 'restaurant.manage'] },
      { path: '/jewellery/rates', label: ['nav.metal_rates', 'Metal Rates'], icon: CoinsIcon, modules: ['jewellery'], permissions: ['jewellery.rates', 'sales.create'] },
      { path: '/jewellery/orders', label: ['nav.jewellery_orders', 'Repair & Custom'], icon: GemIcon, modules: ['jewellery'], permissions: ['jewellery.orders'] },
      { path: '/warranty', label: ['nav.warranty', 'IMEI & Warranty'], icon: SmartphoneIcon, modules: ['serials', 'warranty'], permissions: ['sales.view', 'inventory.view'] },
      { path: '/inventory/expiry', label: ['nav.expiry', 'Batches & Expiry'], icon: TimerIcon, modules: ['batches', 'expiry'], permissions: ['inventory.view'] },
    ],
  },
  {
    label: ['nav.group_admin', 'Management'],
    items: [
      { path: '/employees', label: ['nav.employees', 'Employees'], icon: UserCogIcon, permissions: ['users.manage', 'roles.manage'] },
      { path: '/register', label: ['nav.cash_register', 'Cash Register'], icon: CoinsIcon, permissions: ['cash_register.open', 'cash_register.close'] },
      { path: '/sync', label: ['nav.sync', 'Sync Center'], icon: CloudIcon },
      { path: '/audit', label: ['nav.audit', 'Audit Log'], icon: ShieldCheckIcon, permissions: ['audit.view'] },
      { path: '/catalog', label: ['nav.catalog', 'Catalog setup'], icon: WrenchIcon, permissions: ['products.create', 'settings.manage'] },
      { path: '/settings', label: ['nav.settings', 'Settings'], icon: SettingsIcon, permissions: ['settings.manage'] },
    ],
  },
];

export function visibleNavigation(can: (p: Permission[]) => boolean, hasModule: (m: ModuleKey) => boolean): NavGroup[] {
  return NAVIGATION.map((group) => ({
    ...group,
    items: group.items.filter((item) => (!item.permissions || item.permissions.some((p) => can([p]))) && (!item.modules || item.modules.some(hasModule))),
  })).filter((g) => g.items.length > 0);
}

import { lazy, Suspense, type ComponentType, type ReactNode } from 'react';
import { createBrowserRouter, Navigate, Outlet } from 'react-router';
import type { Permission } from '@shopdesk/shared';
import { AppShell } from './layout/app-shell';
import { RequireAuth, RequireBusiness, RequirePermission } from './guards';
import { FullScreenLoader } from '@/components/common/page';

/** Lazy route with code splitting and an optional permission requirement. */
function page(loader: () => Promise<{ default: ComponentType }>, permission?: Permission | Permission[]) {
  const Component = lazy(loader);
  const element: ReactNode = <Component />;
  return permission ? <RequirePermission permission={permission}>{element}</RequirePermission> : element;
}

const authPages = {
  login: lazy(() => import('@/features/auth/login-page')),
  register: lazy(() => import('@/features/auth/register-page')),
  setup: lazy(() => import('@/features/onboarding/onboarding-page')),
  select: lazy(() => import('@/features/onboarding/select-business-page')),
};

export const router = createBrowserRouter([
  {
    path: '/login',
    element: (
      <Suspense fallback={<FullScreenLoader />}>
        <authPages.login />
      </Suspense>
    ),
  },
  {
    path: '/register',
    element: (
      <Suspense fallback={<FullScreenLoader />}>
        <authPages.register />
      </Suspense>
    ),
  },
  {
    element: (
      <RequireAuth>
        <Suspense fallback={<FullScreenLoader />}>
          <Outlet />
        </Suspense>
      </RequireAuth>
    ),
    children: [
      { path: '/setup', element: <authPages.setup /> },
      { path: '/select-business', element: <authPages.select /> },
      {
        element: (
          <RequireBusiness>
            <AppShell />
          </RequireBusiness>
        ),
        children: [
          { index: true, element: page(() => import('@/features/dashboard/dashboard-page')) },
          { path: 'pos', element: page(() => import('@/features/pos/pos-page'), 'sales.create') },
          { path: 'sales', element: page(() => import('@/features/sales/sales-page'), 'sales.view') },
          { path: 'sales/:id', element: page(() => import('@/features/sales/sale-detail-page'), 'sales.view') },
          { path: 'quotations', element: page(() => import('@/features/sales/quotations-page'), 'sales.create') },
          { path: 'purchases', element: page(() => import('@/features/purchases/purchases-page'), 'purchases.view') },
          { path: 'purchases/new', element: page(() => import('@/features/purchases/purchase-form-page'), 'purchases.create') },
          { path: 'purchases/:id', element: page(() => import('@/features/purchases/purchase-detail-page'), 'purchases.view') },
          { path: 'products', element: page(() => import('@/features/products/products-page'), 'products.view') },
          { path: 'products/new', element: page(() => import('@/features/products/product-form-page'), 'products.create') },
          { path: 'products/:id', element: page(() => import('@/features/products/product-form-page'), 'products.view') },
          { path: 'catalog', element: page(() => import('@/features/products/catalog-page'), ['products.create', 'settings.manage']) },
          { path: 'inventory', element: page(() => import('@/features/inventory/inventory-page'), 'inventory.view') },
          { path: 'inventory/expiry', element: page(() => import('@/features/inventory/expiry-page'), 'inventory.view') },
          { path: 'customers', element: page(() => import('@/features/parties/customers-page'), 'customers.view') },
          { path: 'customers/:id', element: page(() => import('@/features/parties/customer-detail-page'), 'customers.view') },
          { path: 'suppliers', element: page(() => import('@/features/parties/suppliers-page'), 'suppliers.view') },
          { path: 'suppliers/:id', element: page(() => import('@/features/parties/supplier-detail-page'), 'suppliers.view') },
          { path: 'expenses', element: page(() => import('@/features/finance/expenses-page'), ['expenses.view', 'expenses.create']) },
          { path: 'register', element: page(() => import('@/features/finance/cash-register-page'), ['cash_register.open', 'cash_register.close']) },
          { path: 'reports', element: page(() => import('@/features/reports/reports-page'), 'reports.view') },
          { path: 'restaurant/tables', element: page(() => import('@/features/industry/tables-page'), 'restaurant.manage') },
          { path: 'restaurant/kitchen', element: page(() => import('@/features/industry/kitchen-page'), ['kitchen.view', 'restaurant.manage']) },
          { path: 'jewellery/rates', element: page(() => import('@/features/industry/metal-rates-page')) },
          { path: 'jewellery/orders', element: page(() => import('@/features/industry/jewellery-orders-page'), 'jewellery.orders') },
          { path: 'warranty', element: page(() => import('@/features/industry/warranty-page')) },
          { path: 'employees', element: page(() => import('@/features/admin/employees-page'), ['users.manage', 'roles.manage']) },
          { path: 'audit', element: page(() => import('@/features/admin/audit-page'), 'audit.view') },
          { path: 'settings', element: page(() => import('@/features/settings/settings-page'), 'settings.manage') },
          { path: 'settings/:tab', element: page(() => import('@/features/settings/settings-page'), 'settings.manage') },
          { path: 'sync', element: page(() => import('@/features/sync/sync-center-page')) },
          { path: 'sync/conflicts', element: page(() => import('@/features/sync/conflicts-page')) },
          { path: '*', element: page(() => import('@/features/not-found-page')) },
        ],
      },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
]);

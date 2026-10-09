import { Suspense, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import {
  BellIcon,
  CheckIcon,
  ChevronsUpDownIcon,
  HomeIcon,
  LanguagesIcon,
  LogOutIcon,
  MenuIcon,
  MonitorIcon,
  MoonIcon,
  PlusIcon,
  ReceiptIcon,
  SearchIcon,
  ShoppingCartIcon,
  StoreIcon,
  SunIcon,
  PackageIcon,
} from 'lucide-react';
import { BUSINESS_TYPE_DEFS } from '@shopdesk/shared';
import { cn } from '@/lib/utils';
import { useAlerts } from '@/lib/alerts';
import { LANGUAGES, setLanguage } from '@/lib/i18n';
import { useBusiness, useCan, useModules } from '@/hooks/use-app';
import { useSession } from '@/stores/session';
import { useThemeStore, type ThemePreference } from '@/stores/theme';
import { visibleNavigation } from '@/app/navigation';
import { CommandPalette, useCommandPalette } from '@/app/command-palette';
import { OfflineBanner, SyncIndicator, usePendingCount } from '@/components/common/sync-indicator';
import { FullScreenLoader } from '@/components/common/page';
import { confirm } from '@/components/common/confirm';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Kbd } from '@/components/ui/kbd';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from '@/components/ui/sidebar';

function initials(name: string | undefined) {
  return (name ?? '?')
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

function useNav() {
  const can = useCan();
  const hasModule = useModules();
  return visibleNavigation((p) => can(p), hasModule);
}

function BusinessSwitcher() {
  const { t } = useTranslation();
  const business = useBusiness();
  const account = useSession((s) => s.account);
  const selectBusiness = useSession((s) => s.selectBusiness);
  const navigate = useNavigate();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <SidebarMenuButton size="lg" className="data-[state=open]:bg-sidebar-accent">
          <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <StoreIcon className="size-4" />
          </div>
          <div className="grid flex-1 text-left text-sm leading-tight">
            <span className="truncate font-semibold">{business?.name ?? '…'}</span>
            <span className="truncate text-xs text-muted-foreground">{business ? BUSINESS_TYPE_DEFS[business.business_type]?.label : ''}</span>
          </div>
          <ChevronsUpDownIcon className="ml-auto size-4" />
        </SidebarMenuButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-64" align="start">
        <DropdownMenuLabel>{t('shell.businesses', 'Businesses')}</DropdownMenuLabel>
        {account?.memberships.map((m) => (
          <DropdownMenuItem key={m.business.id} onClick={() => void selectBusiness(m.business.id).then(() => navigate('/'))}>
            <StoreIcon /> <span className="truncate">{m.business.name}</span>
            {m.business.id === business?.id ? <CheckIcon className="ml-auto" /> : null}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => navigate('/setup')}>
          <PlusIcon /> {t('shell.new_business', 'Create another business')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function UserMenu({ side = 'right' }: { side?: 'right' | 'bottom' }) {
  const { t, i18n } = useTranslation();
  const account = useSession((s) => s.account);
  const logout = useSession((s) => s.logout);
  const { preference, setPreference } = useThemeStore();
  const { pending } = usePendingCount();
  const navigate = useNavigate();
  const signOut = async () => {
    if (pending > 0) {
      const { confirmed } = await confirm({
        title: t('shell.sign_out_pending_title', 'Changes are still waiting to sync'),
        description: t('shell.sign_out_pending_body', 'They stay safely on this device and will sync after the next sign-in. Sign out anyway?'),
        confirmLabel: t('auth.sign_out', 'Sign out'),
      });
      if (!confirmed) return;
    }
    await logout();
    navigate('/login');
  };
  const themes: Array<[ThemePreference, string, typeof SunIcon]> = [
    ['light', t('theme.light', 'Light'), SunIcon],
    ['dark', t('theme.dark', 'Dark'), MoonIcon],
    ['system', t('theme.system', 'System'), MonitorIcon],
  ];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <SidebarMenuButton size="lg" aria-label={t('shell.account', 'Account')}>
          <Avatar className="size-8 rounded-lg">
            <AvatarFallback className="rounded-lg">{initials(account?.name)}</AvatarFallback>
          </Avatar>
          <div className="grid flex-1 text-left text-sm leading-tight">
            <span className="truncate font-medium">{account?.name}</span>
            <span className="truncate text-xs text-muted-foreground">{account?.email}</span>
          </div>
          <ChevronsUpDownIcon className="ml-auto size-4" />
        </SidebarMenuButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent side={side} align="end" className="w-60">
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <SunIcon /> {t('shell.appearance', 'Appearance')}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            {themes.map(([value, label, Icon]) => (
              <DropdownMenuItem key={value} onClick={() => setPreference(value)}>
                <Icon /> {label} {preference === value ? <CheckIcon className="ml-auto" /> : null}
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <LanguagesIcon /> {t('shell.language', 'Language')}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            {LANGUAGES.map((l) => (
              <DropdownMenuItem key={l.code} onClick={() => setLanguage(l.code)}>
                {l.label} {i18n.language === l.code ? <CheckIcon className="ml-auto" /> : null}
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => void signOut()} variant="destructive">
          <LogOutIcon /> {t('auth.sign_out', 'Sign out')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function AppSidebar() {
  const { t } = useTranslation();
  const groups = useNav();
  const location = useLocation();
  const isActive = (path: string) => (path === '/' ? location.pathname === '/' : location.pathname === path || location.pathname.startsWith(`${path}/`));
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <BusinessSwitcher />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        {groups.map((group) => (
          <SidebarGroup key={group.label[0]}>
            <SidebarGroupLabel>{t(group.label[0], group.label[1])}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => (
                  <SidebarMenuItem key={item.path}>
                    <SidebarMenuButton asChild isActive={isActive(item.path)} tooltip={t(item.label[0], item.label[1])}>
                      <NavLink to={item.path} end={item.path === '/'}>
                        <item.icon />
                        <span>{t(item.label[0], item.label[1])}</span>
                      </NavLink>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <UserMenu />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}

function AlertsButton() {
  const { t } = useTranslation();
  const alerts = useAlerts();
  const count = alerts?.length ?? 0;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label={`${t('shell.alerts', 'Alerts')} (${count})`}>
          <BellIcon />
          {count > 0 ? (
            <span className="absolute -top-0.5 -right-0.5 flex min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-white">
              {count > 99 ? '99+' : count}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="border-b px-4 py-3 text-sm font-semibold">{t('shell.alerts', 'Alerts')}</div>
        <div className="max-h-96 overflow-y-auto">
          {count === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">{t('shell.no_alerts', 'All clear. No alerts right now.')}</p>
          ) : (
            alerts!.slice(0, 50).map((a) => (
              <Link key={a.id} to={a.link} className="flex gap-3 border-b px-4 py-2.5 text-sm last:border-0 hover:bg-muted/60">
                <span className={cn('mt-1.5 size-2 shrink-0 rounded-full', a.severity === 'critical' ? 'bg-destructive' : a.severity === 'warning' ? 'bg-warning' : 'bg-primary')} />
                <span className="min-w-0">
                  <span className="block truncate font-medium">{a.title}</span>
                  <span className="block text-xs text-muted-foreground">{a.body}</span>
                </span>
              </Link>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function ThemeToggle() {
  const { t } = useTranslation();
  const { theme, setPreference } = useThemeStore();
  return (
    <Button variant="ghost" size="icon" onClick={() => setPreference(theme === 'dark' ? 'light' : 'dark')} aria-label={t('shell.toggle_theme', 'Toggle dark mode')}>
      {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
    </Button>
  );
}

function Topbar() {
  const { t } = useTranslation();
  const openPalette = useCommandPalette((s) => s.setOpen);
  return (
    <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 border-b bg-background/85 px-3 backdrop-blur supports-[backdrop-filter]:bg-background/70 sm:px-4">
      <SidebarTrigger className="hidden md:inline-flex" />
      <Link to="/" className="flex items-center gap-2 font-semibold md:hidden" aria-label="Home">
        <span className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <StoreIcon className="size-4" />
        </span>
      </Link>
      <Button variant="outline" className="h-9 flex-1 justify-start gap-2 text-muted-foreground sm:max-w-sm" onClick={() => openPalette(true)} data-testid="global-search">
        <SearchIcon />
        <span className="truncate">{t('shell.search_placeholder', 'Search products, customers, invoices…')}</span>
        <Kbd className="ml-auto hidden sm:inline-flex">Ctrl K</Kbd>
      </Button>
      <div className="ml-auto flex items-center gap-1">
        <SyncIndicator />
        <AlertsButton />
        <ThemeToggle />
      </div>
    </header>
  );
}

function MobileNav() {
  const { t } = useTranslation();
  const groups = useNav();
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const items = [
    { path: '/', label: t('nav.home', 'Home'), icon: HomeIcon },
    { path: '/pos', label: t('nav.pos', 'POS'), icon: ShoppingCartIcon },
    { path: '/sales', label: t('nav.sales', 'Sales'), icon: ReceiptIcon },
    { path: '/products', label: t('nav.products', 'Products'), icon: PackageIcon },
  ];
  return (
    <>
      <nav className="safe-bottom fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t bg-background/95 backdrop-blur md:hidden" aria-label={t('shell.mobile_nav', 'Primary')}>
        {items.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            end={item.path === '/'}
            className={({ isActive }) => cn('flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-medium', isActive ? 'text-primary' : 'text-muted-foreground')}
          >
            <item.icon className="size-5" />
            {item.label}
          </NavLink>
        ))}
        <button type="button" onClick={() => setOpen(true)} className="flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-medium text-muted-foreground">
          <MenuIcon className="size-5" />
          {t('nav.more', 'More')}
        </button>
      </nav>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" className="max-h-[85dvh] overflow-y-auto rounded-t-2xl">
          <SheetHeader>
            <SheetTitle>{t('nav.menu', 'Menu')}</SheetTitle>
          </SheetHeader>
          <div className="space-y-4 px-4 pb-6">
            {groups.map((g) => (
              <div key={g.label[0]}>
                <p className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">{t(g.label[0], g.label[1])}</p>
                <div className="grid grid-cols-3 gap-2">
                  {g.items.map((item) => (
                    <Link
                      key={item.path}
                      to={item.path}
                      onClick={() => setOpen(false)}
                      className={cn('flex flex-col items-center gap-1.5 rounded-xl border p-3 text-center text-xs', location.pathname === item.path && 'border-primary bg-accent')}
                    >
                      <item.icon className="size-5 text-primary" />
                      {t(item.label[0], item.label[1])}
                    </Link>
                  ))}
                </div>
              </div>
            ))}
            <div className="flex justify-end">
              <UserMenu side="bottom" />
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

export function AppShell() {
  const { t } = useTranslation();
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset className="h-dvh min-w-0 overflow-hidden">
        <OfflineBanner />
        <Topbar />
        <main className="min-h-0 flex-1 overflow-y-auto pb-20 md:pb-0" id="main">
          <Suspense fallback={<FullScreenLoader label={t('common.loading', 'Loading…')} />}>
            <Outlet />
          </Suspense>
        </main>
        <MobileNav />
      </SidebarInset>
      <CommandPalette />
    </SidebarProvider>
  );
}

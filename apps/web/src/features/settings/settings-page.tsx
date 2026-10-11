import { useNavigate, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useCan } from '@/hooks/use-app';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Page, PageHeader } from '@/components/common/page';
import { BackupTab, ImportTab } from './data-tabs';
import { BusinessTab, InvoiceTab, PosTab, PrinterTab } from './general-tabs';
import { AppearanceTab, DevicesTab, StoresTab } from './system-tabs';

const TABS = ['business', 'invoice', 'pos', 'printer', 'stores', 'devices', 'import', 'backup', 'appearance'] as const;
type Tab = (typeof TABS)[number];

export default function SettingsPage() {
  const { t } = useTranslation();
  const can = useCan();
  const navigate = useNavigate();
  const params = useParams();
  const tab: Tab = TABS.includes(params.tab as Tab) ? (params.tab as Tab) : 'business';
  const labels: Record<Tab, string> = {
    business: t('settings.t_business', 'Business'),
    invoice: t('settings.t_invoice', 'Invoice'),
    pos: t('settings.t_pos', 'POS'),
    printer: t('settings.t_printer', 'Printing & loyalty'),
    stores: t('settings.t_stores', 'Stores'),
    devices: t('settings.t_devices', 'Devices'),
    import: t('settings.t_import', 'Import'),
    backup: t('settings.t_backup', 'Backup'),
    appearance: t('settings.t_appearance', 'Appearance & account'),
  };
  const visible = TABS.filter((x) => (x === 'import' ? can('data.import') : x === 'devices' ? can('devices.manage') : true));

  return (
    <Page className="max-w-5xl">
      <PageHeader title={t('settings.title', 'Settings')} />
      <Tabs value={tab} onValueChange={(v) => navigate(`/settings/${v}`, { replace: true })}>
        <TabsList className="mb-4 h-auto w-full flex-wrap justify-start">
          {visible.map((x) => (
            <TabsTrigger key={x} value={x}>
              {labels[x]}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="business">
          <BusinessTab />
        </TabsContent>
        <TabsContent value="invoice">
          <InvoiceTab />
        </TabsContent>
        <TabsContent value="pos">
          <PosTab />
        </TabsContent>
        <TabsContent value="printer">
          <PrinterTab />
        </TabsContent>
        <TabsContent value="stores">
          <StoresTab />
        </TabsContent>
        <TabsContent value="devices">
          <DevicesTab />
        </TabsContent>
        <TabsContent value="import">
          <ImportTab />
        </TabsContent>
        <TabsContent value="backup">
          <BackupTab />
        </TabsContent>
        <TabsContent value="appearance">
          <AppearanceTab />
        </TabsContent>
      </Tabs>
    </Page>
  );
}

import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { CompassIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState, Page } from '@/components/common/page';

export default function NotFoundPage() {
  const { t } = useTranslation();
  return (
    <Page>
      <EmptyState
        icon={CompassIcon}
        title={t('notfound.title', 'Page not found')}
        description={t('notfound.description', 'The page you are looking for does not exist or was moved.')}
        action={
          <Button asChild>
            <Link to="/">{t('notfound.home', 'Go to dashboard')}</Link>
          </Button>
        }
      />
    </Page>
  );
}

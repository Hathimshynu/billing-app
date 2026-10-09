import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { loginSchema, type LoginInput } from '@shopdesk/shared';
import { ApiError, errorMessage } from '@/lib/api';
import { useSession } from '@/stores/session';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { FormRow } from '@/components/common/form';
import { AuthLayout } from './auth-layout';

export default function LoginPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { status, login, account } = useSession();
  const reauth = params.get('reauth') === '1';
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<LoginInput>({ resolver: zodResolver(loginSchema), defaultValues: { email: reauth ? (account?.email ?? '') : '', password: '' } });

  useEffect(() => {
    if (status === 'signed_in' && !reauth) navigate(params.get('next') || '/', { replace: true });
  }, [status, reauth, navigate, params]);

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      const { offline } = await login(values.email, values.password);
      if (offline) toast.info(t('auth.offline_signin', 'Signed in offline. Syncing resumes when you are back online.'));
      if (reauth) navigate(-1);
      else navigate(params.get('next') || '/', { replace: true });
    } catch (error) {
      if (error instanceof ApiError && error.field('email')) form.setError('email', { message: error.field('email') });
      else setFormError(errorMessage(error));
    }
  });

  return (
    <AuthLayout
      title={reauth ? t('auth.reauth_title', 'Sign in again') : t('auth.welcome_back', 'Welcome back')}
      subtitle={reauth ? t('auth.reauth_subtitle', 'Your session expired. Pending changes are safe and will sync after you sign in.') : t('auth.sign_in_subtitle', 'Sign in to your shop')}
      footer={
        <>
          {t('auth.no_account', 'New to ShopDesk?')}{' '}
          <Link to="/register" className="font-medium text-primary hover:underline">
            {t('auth.create_account', 'Create an account')}
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <FormRow label={t('auth.email', 'Email')} htmlFor="email" error={form.formState.errors.email?.message}>
          <Input id="email" type="email" autoComplete="username" autoFocus {...form.register('email')} />
        </FormRow>
        <FormRow label={t('auth.password', 'Password')} htmlFor="password" error={form.formState.errors.password?.message}>
          <Input id="password" type="password" autoComplete="current-password" {...form.register('password')} />
        </FormRow>
        {formError ? (
          <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {formError}
          </p>
        ) : null}
        <Button type="submit" className="h-10 w-full" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting ? <Spinner /> : null}
          {t('auth.sign_in', 'Sign in')}
        </Button>
      </form>
    </AuthLayout>
  );
}

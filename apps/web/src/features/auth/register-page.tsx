import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslation } from 'react-i18next';
import { registerSchema, type RegisterInput } from '@shopdesk/shared';
import { ApiError, errorMessage } from '@/lib/api';
import { useSession } from '@/stores/session';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { FormRow } from '@/components/common/form';
import { AuthLayout } from './auth-layout';

export default function RegisterPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const register = useSession((s) => s.register);
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<RegisterInput>({
    resolver: zodResolver(registerSchema),
    defaultValues: { name: '', email: '', phone: null, password: '', password_confirmation: '' },
  });
  const errors = form.formState.errors;

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      await register(values);
      navigate('/setup', { replace: true });
    } catch (error) {
      if (error instanceof ApiError && Object.keys(error.errors).length) {
        for (const [field, messages] of Object.entries(error.errors)) form.setError(field as keyof RegisterInput, { message: messages[0] });
      } else {
        setFormError(errorMessage(error));
      }
    }
  });

  return (
    <AuthLayout
      title={t('auth.register_title', 'Create your account')}
      subtitle={t('auth.register_subtitle', 'Set up your shop in a couple of minutes.')}
      footer={
        <>
          {t('auth.have_account', 'Already have an account?')}{' '}
          <Link to="/login" className="font-medium text-primary hover:underline">
            {t('auth.sign_in', 'Sign in')}
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <FormRow label={t('auth.name', 'Your name')} htmlFor="name" error={errors.name?.message} required>
          <Input id="name" autoComplete="name" autoFocus {...form.register('name')} />
        </FormRow>
        <FormRow label={t('auth.email', 'Email')} htmlFor="email" error={errors.email?.message} required>
          <Input id="email" type="email" autoComplete="email" {...form.register('email')} />
        </FormRow>
        <FormRow label={t('auth.phone', 'Mobile number')} htmlFor="phone" error={errors.phone?.message}>
          <Input id="phone" type="tel" inputMode="tel" autoComplete="tel" {...form.register('phone', { setValueAs: (v) => (v ? v : null) })} />
        </FormRow>
        <FormRow label={t('auth.password', 'Password')} htmlFor="password" error={errors.password?.message} description={t('auth.password_hint', 'At least 8 characters with a letter and a number.')} required>
          <Input id="password" type="password" autoComplete="new-password" {...form.register('password')} />
        </FormRow>
        <FormRow label={t('auth.confirm_password', 'Confirm password')} htmlFor="password_confirmation" error={errors.password_confirmation?.message} required>
          <Input id="password_confirmation" type="password" autoComplete="new-password" {...form.register('password_confirmation')} />
        </FormRow>
        {formError ? (
          <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {formError}
          </p>
        ) : null}
        <Button type="submit" className="h-10 w-full" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting ? <Spinner /> : null}
          {t('auth.create_account', 'Create an account')}
        </Button>
      </form>
    </AuthLayout>
  );
}

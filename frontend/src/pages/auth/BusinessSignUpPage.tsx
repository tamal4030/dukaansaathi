import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useI18n } from '../../lib/i18n';
import { useAuth } from '../../providers/AuthProvider';
import { Field, TextInput } from '../../components/ui';
import { LanguageSelector } from '../../components/LanguageSelector';

export function BusinessSignUpPage() {
  const { t } = useI18n();
  const { signUpBusiness, configured } = useAuth();
  const navigate = useNavigate();

  const [ownerName, setOwnerName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setInfo(null);

    if (password.length < 8) {
      setError(t('auth.passwordTooShort'));
      return;
    }
    if (password !== confirm) {
      setError(t('auth.passwordMismatch'));
      return;
    }

    setBusy(true);
    try {
      const result = await signUpBusiness(email.trim(), password, ownerName.trim());
      if (result.needsConfirmation) {
        setInfo(t('auth.checkEmail'));
      } else {
        // Send the owner straight to business setup rather than a long form.
        navigate('/merchant/setup', { replace: true });
      }
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : t('common.somethingWentWrong'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-dvh bg-canvas">
      <header className="mx-auto flex max-w-md items-center justify-between px-4 py-4">
        <Link to="/" className="text-lg font-bold text-ink">
          {t('app.name')}
        </Link>
        <LanguageSelector />
      </header>

      <main className="mx-auto w-full max-w-md px-4 pb-12">
        <div className="card p-6">
          <h1 className="text-2xl font-bold text-ink">{t('auth.createBusinessAccount')}</h1>
          <p className="mt-1 text-sm text-ink-muted">{t('auth.businessSignUpIntro')}</p>

          {!configured ? (
            <p className="mt-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-900" role="alert">
              {t('auth.notConfigured')}
            </p>
          ) : null}

          <form className="mt-5 space-y-4" onSubmit={submit} noValidate>
            <Field label={t('auth.ownerName')} required>
              {({ id, invalid }) => (
                <TextInput
                  id={id}
                  autoComplete="name"
                  required
                  invalid={invalid}
                  value={ownerName}
                  onChange={(event) => setOwnerName(event.target.value)}
                />
              )}
            </Field>

            <Field label={t('auth.email')} required>
              {({ id, invalid }) => (
                <TextInput
                  id={id}
                  type="email"
                  autoComplete="email"
                  required
                  invalid={invalid}
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              )}
            </Field>

            <Field label={t('auth.password')} hint={t('auth.passwordTooShort')} required>
              {({ id, invalid }) => (
                <TextInput
                  id={id}
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={8}
                  invalid={invalid}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              )}
            </Field>

            <Field label={t('auth.confirmPassword')} required>
              {({ id, invalid }) => (
                <TextInput
                  id={id}
                  type="password"
                  autoComplete="new-password"
                  required
                  invalid={invalid}
                  value={confirm}
                  onChange={(event) => setConfirm(event.target.value)}
                />
              )}
            </Field>

            {error ? (
              <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700" role="alert">
                {error}
              </p>
            ) : null}
            {info ? (
              <p className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800" role="status">
                {info}
              </p>
            ) : null}

            <button type="submit" className="btn-primary w-full py-3" disabled={busy || !configured}>
              {busy ? t('common.loading') : t('auth.createBusinessAccount')}
            </button>
          </form>

          <div className="mt-5 border-t border-slate-200 pt-4 text-sm">
            <p className="text-ink-muted">
              {t('auth.existingBusinessOwner')}{' '}
              <Link to="/business/login" className="font-semibold text-brand-700 hover:underline">
                {t('auth.businessLogin')}
              </Link>
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}

import { useState, type FormEvent } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { signIn, getMe } from '@/lib/api';
import { useSessionStore } from '@/lib/session';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { AlertCircle, Lock, Mail, ArrowRight, Eye, EyeOff } from 'lucide-react';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const navigate = useNavigate();
  const location = useLocation();
  const setSession = useSessionStore((state) => state.setSession);

  const from = (location.state as { from?: { pathname: string } })?.from?.pathname || '/dashboard';

  const handleLogin = async (e: FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      setError('Please provide both email and password.');
      return;
    }

    try {
      setLoading(true);
      setError(null);

      await signIn(email, password);
      const meData = await getMe();

      setSession({
        user: {
          id: meData.id,
          email: meData.email,
          name: meData.name,
          role: meData.role,
          departments: meData.departments || [],
          entities: meData.entities || ['ATA', 'LTA'],
          isActive: meData.isActive,
          avatarUrl: meData.avatarUrl,
        },
        permissions: meData.permissions || [],
        activeEntity: meData.activeEntity || (meData.entities?.[0] ?? 'ATA'),
        unreadCount: meData.unread_notifications ?? 0,
      });

      navigate(from, { replace: true });
    } catch (err) {
      console.error('[Login] Sign-in error:', err);
      setError(err instanceof Error ? err.message : 'Invalid credentials. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const fillCredentials = (quickEmail: string) => {
    setEmail(quickEmail);
    setPassword('password123');
    setError(null);
  };

  return (
    <div
      className="flex min-h-screen w-full items-center justify-center p-4 sm:p-6 bg-[#F8FAFC]"
      data-testid="login-page"
    >
      <div className="w-full max-w-md">
        {/* Brand Header */}
        <div className="text-center mb-6">
          <div className="inline-flex h-12 w-12 items-center justify-center rounded-[10px] bg-[#1E3A8A] text-[#FFFFFF] font-bold text-xl shadow-card mb-3">
            ERP
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold text-[#1E293B] tracking-tight">
            ATA &amp; LTA ERP
          </h1>
          <p className="text-xs sm:text-sm text-[#475569] mt-1">
            Enterprise Ledger &bull; Institutional Access
          </p>
        </div>

        <Card className="border border-[#E2E8F0] shadow-float bg-[#FFFFFF] rounded-[12px] p-0 overflow-hidden">
          <CardHeader className="space-y-1 p-6 border-b border-[#E2E8F0] bg-[#F8FAFC]">
            <CardTitle className="text-lg font-semibold tracking-tight text-[#1E293B]">
              Sign in to your account
            </CardTitle>
            <CardDescription className="text-xs sm:text-sm text-[#475569]">
              Enter your corporate credentials to access the ledger
            </CardDescription>
          </CardHeader>
          <form onSubmit={handleLogin}>
            <CardContent className="space-y-4 p-6">
              {error && (
                <div
                  data-testid="login-error"
                  className="flex items-center gap-2 rounded-[6px] bg-[#FEF2F2] p-3 text-xs text-[#991B1B] border border-[#FCA5A5]"
                >
                  <AlertCircle className="h-4 w-4 shrink-0 text-[#DC2626]" />
                  <span>{error}</span>
                </div>
              )}

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-[#1E293B]" htmlFor="email">
                  Email Address
                </label>
                <div className="relative">
                  <Mail className="absolute left-3 top-2.5 h-4 w-4 text-[#64748B]" />
                  <Input
                    id="email"
                    type="email"
                    placeholder="user@ata-lta.ph"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="pl-9"
                    data-testid="login-email"
                    required
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-[#1E293B]" htmlFor="password">
                  Password
                </label>
                <div className="relative">
                  <Lock className="absolute left-3 top-2.5 h-4 w-4 text-[#64748B]" />
                  <Input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="pl-9 pr-10"
                    data-testid="login-password"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((prev) => !prev)}
                    className="absolute right-3 top-2.5 text-[#64748B] hover:text-[#1E293B] focus:outline-none focus:ring-2 focus:ring-[#1D4ED8] rounded-[4px] p-0.5 transition-colors cursor-pointer"
                    data-testid="password-toggle-btn"
                    id="password-toggle-btn"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    title={showPassword ? 'Hide password' : 'Show password'}
                    tabIndex={0}
                  >
                    {showPassword ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </div>
            </CardContent>

            <CardFooter className="flex flex-col space-y-4 p-6 pt-0">
              <Button
                type="submit"
                className="w-full gap-2 h-10 cursor-pointer"
                disabled={loading}
                data-testid="login-submit"
              >
                {loading ? 'Signing In...' : 'Sign In'}
                <ArrowRight className="h-4 w-4" />
              </Button>

              {/* Dev quick-login buttons */}
              <div className="pt-2 text-center w-full border-t border-[#E2E8F0]">
                <span className="text-xs font-semibold text-[#475569] block mb-2">
                  Quick Development Access
                </span>
                <div className="flex flex-wrap gap-2 justify-center">
                  <Button
                    type="button"
                    variant="outline"
                    size="xs"
                    onClick={() => fillCredentials('dev-admin@ata-lta.ph')}
                    data-testid="dev-admin-btn"
                  >
                    Admin (Full)
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="xs"
                    onClick={() => fillCredentials('dev-docs@ata-lta.ph')}
                    data-testid="dev-docs-btn"
                  >
                    Manager (Docs)
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="xs"
                    onClick={() => fillCredentials('dev-accs@ata-lta.ph')}
                    data-testid="dev-accs-btn"
                  >
                    Accounting
                  </Button>
                </div>
              </div>
            </CardFooter>
          </form>
        </Card>
      </div>
    </div>
  );
}

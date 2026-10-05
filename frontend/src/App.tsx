import { lazy, Suspense, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient, getToken, getMe } from '@/lib/api';
import { useSessionStore } from '@/lib/session';
import { Shell } from '@/components/layout/Shell';
import { RouteGuard } from '@/components/auth/RouteGuard';
import { NotFound } from '@/components/common/NotFound';
import { Toaster } from '@/components/ui/toast';
import { Skeleton } from '@/components/ui/skeleton';
import LoginPage from '@/routes/login';

// Per-module lazy-loaded route chunks (Spec §3.1)
const DashboardPage = lazy(() => import('@/routes/dashboard'));
const OperationsPage = lazy(() => import('@/routes/operations'));
const BillingPage = lazy(() => import('@/routes/billing'));
const DisbursementsPage = lazy(() => import('@/routes/disbursements'));
const TransmittalsPage = lazy(() => import('@/routes/transmittals'));
const DocumentsPage = lazy(() => import('@/routes/documents'));
const ReportsPage = lazy(() => import('@/routes/reports'));
const ClientsPage = lazy(() => import('@/routes/clients'));
const AdminPage = lazy(() => import('@/routes/admin'));
const KitchenSinkPage = lazy(() => import('@/routes/_kitchen-sink'));

function RouteLoadingFallback() {
  return (
    <div className="space-y-4 p-4">
      <Skeleton className="h-8 w-64" />
      <Skeleton className="h-4 w-96" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 pt-4">
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-28 w-full" />
      </div>
      <Skeleton className="h-64 w-full mt-6" />
    </div>
  );
}

export function AppContent() {
  const { setSession, setLoading } = useSessionStore();

  useEffect(() => {
    const initializeAuth = async () => {
      const token = getToken();
      if (!token) {
        setLoading(false);
        return;
      }

      try {
        const me = await getMe();
        setSession({
          user: {
            id: me.id,
            email: me.email,
            name: me.name,
            role: me.role,
            departments: me.departments || [],
            entities: me.entities || ['ATA', 'LTA'],
            isActive: me.isActive,
            avatarUrl: me.avatarUrl,
          },
          permissions: me.permissions || [],
          activeEntity: me.activeEntity || (me.entities?.[0] ?? 'ATA'),
          unreadCount: me.unread_notifications ?? 0,
        });
      } catch (err) {
        console.warn('[App] Session initialization failed:', err);
        setLoading(false);
      }
    };

    void initializeAuth();
  }, [setSession, setLoading]);

  return (
    <BrowserRouter>
      <Routes>
        {/* Public Login Route */}
        <Route path="/login" element={<LoginPage />} />

        {/* Authenticated App Shell */}
        <Route
          element={
            <RouteGuard>
              <Shell />
            </RouteGuard>
          }
        >
          {/* Index redirects to /dashboard */}
          <Route path="/" element={<Navigate to="/dashboard" replace />} />

          {/* Module Routes — Lazy-loaded per module chunk */}
          <Route
            path="/dashboard"
            element={
              <Suspense fallback={<RouteLoadingFallback />}>
                <DashboardPage />
              </Suspense>
            }
          />
          <Route
            path="/operations"
            element={
              <RouteGuard requiredPermission="workflow:view">
                <Suspense fallback={<RouteLoadingFallback />}>
                  <OperationsPage />
                </Suspense>
              </RouteGuard>
            }
          />
          <Route
            path="/billing"
            element={
              <RouteGuard requiredPermission="billing:view">
                <Suspense fallback={<RouteLoadingFallback />}>
                  <BillingPage />
                </Suspense>
              </RouteGuard>
            }
          />
          <Route
            path="/disbursements"
            element={
              <RouteGuard requiredPermission="disbursement:view">
                <Suspense fallback={<RouteLoadingFallback />}>
                  <DisbursementsPage />
                </Suspense>
              </RouteGuard>
            }
          />
          <Route
            path="/transmittals"
            element={
              <RouteGuard requiredPermission="transmittal:view">
                <Suspense fallback={<RouteLoadingFallback />}>
                  <TransmittalsPage />
                </Suspense>
              </RouteGuard>
            }
          />
          <Route
            path="/documents"
            element={
              <RouteGuard requiredPermission="dms:view">
                <Suspense fallback={<RouteLoadingFallback />}>
                  <DocumentsPage />
                </Suspense>
              </RouteGuard>
            }
          />
          <Route
            path="/reports"
            element={
              <RouteGuard requiredPermission="reports:view">
                <Suspense fallback={<RouteLoadingFallback />}>
                  <ReportsPage />
                </Suspense>
              </RouteGuard>
            }
          />
          <Route
            path="/clients"
            element={
              <RouteGuard requiredPermission="clients:view">
                <Suspense fallback={<RouteLoadingFallback />}>
                  <ClientsPage />
                </Suspense>
              </RouteGuard>
            }
          />
          <Route
            path="/admin"
            element={
              <RouteGuard requiredPermission="users:manage">
                <Suspense fallback={<RouteLoadingFallback />}>
                  <AdminPage />
                </Suspense>
              </RouteGuard>
            }
          />

          {/* Dev-only Kitchen Sink Route */}
          <Route
            path="/dev/kitchen-sink"
            element={
              <Suspense fallback={<RouteLoadingFallback />}>
                <KitchenSinkPage />
              </Suspense>
            }
          />

          {/* Global 404 Inside Shell */}
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
      <Toaster />
    </BrowserRouter>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AppContent />
    </QueryClientProvider>
  );
}

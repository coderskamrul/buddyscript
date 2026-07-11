import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import FullPageLoader from './ui/FullPageLoader';

/**
 * The feed is a protected route. The real enforcement is server-side — every
 * /api route requires a valid session — this guard just keeps the UI honest and
 * avoids rendering a shell the user cannot populate.
 */
export function ProtectedRoute() {
  const { isAuthenticated, loading } = useAuth();
  const location = useLocation();

  if (loading) return <FullPageLoader />;

  // `state` remembers where they were headed so login can send them back there
  // instead of dumping them on a generic landing page.
  if (!isAuthenticated) return <Navigate to="/login" replace state={{ from: location }} />;

  return <Outlet />;
}

/** Keeps a signed-in user off the login/register screens. */
export function PublicOnlyRoute() {
  const { isAuthenticated, loading } = useAuth();

  if (loading) return <FullPageLoader />;
  if (isAuthenticated) return <Navigate to="/feed" replace />;

  return <Outlet />;
}

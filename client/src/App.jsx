import { Navigate, Route, Routes } from 'react-router-dom';
import { ProtectedRoute, PublicOnlyRoute } from './components/RouteGuards';
import Login from './pages/Login';
import Register from './pages/Register';
import Feed from './pages/Feed';

export default function App() {
  return (
    <Routes>
      <Route element={<PublicOnlyRoute />}>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
      </Route>

      <Route element={<ProtectedRoute />}>
        <Route path="/feed" element={<Feed />} />
      </Route>

      <Route path="/" element={<Navigate to="/feed" replace />} />
      {/* Anything unrecognized lands on the feed, which then bounces to login if
          there is no session. */}
      <Route path="*" element={<Navigate to="/feed" replace />} />
    </Routes>
  );
}

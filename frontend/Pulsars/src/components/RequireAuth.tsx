import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useSession } from "../hooks/useSession";

/**
 * Renders its children only for a signed-in user; everyone else goes to the login page, which
 * sends them back here afterwards. Also what signs the user out of the UI when the API answers
 * 401 (api/client.ts clears the session).
 */
export default function RequireAuth({ children }: { children: ReactNode }) {
  const session = useSession();
  const location = useLocation();

  if (!session) {
    const from = location.pathname + location.search;
    return <Navigate to="/login" replace state={{ from }} />;
  }
  return children;
}

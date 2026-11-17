import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { signOut } from "../api/auth";

/**
 * Visiting /logout signs you out and shows a clean login page. Going through a route of its own
 * (outside RequireAuth) means the login page doesn't remember where you were, unlike being
 * signed out by an expired token, where it does.
 */
export default function SignOutPage() {
  const navigate = useNavigate();

  useEffect(() => {
    signOut();
    navigate("/login", { replace: true });
  }, [navigate]);

  return null;
}

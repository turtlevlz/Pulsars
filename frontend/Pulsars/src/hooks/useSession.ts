import { useSyncExternalStore } from "react";
import { getSession, subscribe } from "../api/session";

/** The current session, or null when signed out. Re-renders on sign-in and sign-out. */
export function useSession() {
  return useSyncExternalStore(subscribe, getSession);
}

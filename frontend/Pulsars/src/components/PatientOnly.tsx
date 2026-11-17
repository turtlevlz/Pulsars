import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useSession } from "../hooks/useSession";

/** The symptom log and check-ups pages are a patient's own; a medic goes back to the overview. */
export default function PatientOnly({ children }: { children: ReactNode }) {
  const session = useSession();
  if (session?.user.role === "medic") return <Navigate to="/" replace />;
  return children;
}

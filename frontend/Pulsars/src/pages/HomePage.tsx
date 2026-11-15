import { useSession } from "../hooks/useSession";
import DashboardPage from "./DashboardPage";
import MedicDashboardPage from "./MedicDashboardPage";

/** `/`: the patient's own dashboard, or the medic's patient overview. */
export default function HomePage() {
  const session = useSession();
  return session?.user.role === "medic" ? <MedicDashboardPage /> : <DashboardPage />;
}

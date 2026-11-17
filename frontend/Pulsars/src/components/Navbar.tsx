import { NavLink } from "react-router-dom";
import { useSession } from "../hooks/useSession";
import StarMascot from "./StarMascot";
import UserMenu from "./UserMenu";
import "../styles/Navbar.css";

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `navbar__link${isActive ? " navbar__link--active" : ""}`;

export default function Navbar() {
  const session = useSession();

  return (
    <header className="navbar">
      <nav className="navbar__inner" aria-label="Main">
        <NavLink to="/" className="navbar__brand" aria-label="Pulsars home">
          <StarMascot size={40} />
          <span className="navbar__name">Pulsars</span>
        </NavLink>

        {session?.user.role === "medic" && (
          <ul className="navbar__links">
            <li>
              <NavLink to="/" end className={linkClass}>
                Patients
              </NavLink>
            </li>
          </ul>
        )}

        {session?.user.role === "patient" && (
          <ul className="navbar__links">
            <li>
              <NavLink to="/" end className={linkClass}>
                Dashboard
              </NavLink>
            </li>
            <li>
              <NavLink to="/fitness" className={linkClass}>
                Fitness
              </NavLink>
            </li>
            <li>
              <NavLink to="/health-log" className={linkClass}>
                Health Log
              </NavLink>
            </li>
            <li>
              <NavLink to="/symptom-log" className={linkClass}>
                Symptom Log
              </NavLink>
            </li>
            <li>
              <NavLink to="/checkups" className={linkClass}>
                Checkups
              </NavLink>
            </li>
          </ul>
        )}

        {session && <UserMenu user={session.user} />}
      </nav>
    </header>
  );
}

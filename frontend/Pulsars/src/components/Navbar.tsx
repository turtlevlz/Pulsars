import { NavLink } from "react-router-dom";
import StarMascot from "./StarMascot";
import "../styles/Navbar.css";

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `navbar__link${isActive ? " navbar__link--active" : ""}`;

export default function Navbar() {
  return (
    <header className="navbar">
      <nav className="navbar__inner" aria-label="Main">
        <NavLink to="/" className="navbar__brand" aria-label="Pulsars home">
          <StarMascot size={40} />
          <span className="navbar__name">Pulsars</span>
        </NavLink>

        <ul className="navbar__links">
          <li>
            <NavLink to="/" end className={linkClass}>
              Dashboard
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
      </nav>
    </header>
  );
}
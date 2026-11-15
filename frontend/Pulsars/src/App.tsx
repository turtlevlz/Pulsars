import type { FC } from "react";
import { Outlet } from "react-router-dom";
import Navbar from "./components/Navbar";

const App: FC = () => {
  return (
    <div className="app">
      <header>
        <Navbar />
      </header>

      {/* Main Content */}
      <main className="app__main">
        <Outlet />
      </main>
    </div>
  );
};

export default App;



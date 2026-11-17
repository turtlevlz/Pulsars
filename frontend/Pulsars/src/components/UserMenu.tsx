import { useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { useNavigate } from "react-router-dom";
import type { SessionUser } from "../api/session";

/** "Hello <name>" in the navbar; opens a small menu with Log out. */
export default function UserMenu({ user }: { user: SessionUser }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  // Close when clicking or tabbing away from the menu.
  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("focusin", away);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("focusin", away);
    };
  }, [open]);

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape" && open) {
      setOpen(false);
      buttonRef.current?.focus();
    }
  };

  return (
    <div className="user-menu" ref={rootRef} onKeyDown={handleKeyDown}>
      <button
        ref={buttonRef}
        type="button"
        className="user-menu__button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        title={user.email}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="user-menu__hello">Hello {user.name}</span>
        <svg className="user-menu__chevron" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M2 4.5 6 8.5 10 4.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div id={menuId} className="user-menu__list" role="menu">
          <button
            type="button"
            role="menuitem"
            className="user-menu__item"
            autoFocus
            onClick={() => {
              setOpen(false);
              navigate("/logout");
            }}
          >
            Log out
          </button>
        </div>
      )}
    </div>
  );
}

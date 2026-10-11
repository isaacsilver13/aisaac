import { useEffect, useRef } from "react";
import { NavLink } from "react-router-dom";
import { Xmark } from "iconoir-react";

import { NAV_ITEMS, isNavGroup } from "./navItems";

interface MobileDrawerProps {
  open: boolean;
  onClose: () => void;
  apps: { id: string; name: string }[];
}

export function MobileDrawer({ open, onClose, apps }: MobileDrawerProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;

      const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="app-drawer-overlay" onClick={onClose}>
      <div
        ref={dialogRef}
        className="app-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Navigation menu"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          ref={closeButtonRef}
          className="app-drawer-close"
          onClick={onClose}
          aria-label="Close navigation menu"
        >
          <Xmark width={20} height={20} aria-hidden="true" />
        </button>
        <nav className="app-sidebar-nav">
          {NAV_ITEMS.map((item) => isNavGroup(item) ? (
            <div key={item.label}>
              <div className="app-sidebar-link app-drawer-group">
                <item.icon width={17} height={17} aria-hidden="true" />
                <span>{item.label}</span>
              </div>
              <div className="app-drawer-subnav" aria-label={item.label}>
                {item.children.map((child) => (
                  <NavLink
                    key={child.to}
                    to={child.to}
                    onClick={onClose}
                    className={({ isActive }) => `app-sidebar-link${isActive ? " app-sidebar-link-active" : ""}`}
                  >
                    <span>{child.label}</span>
                  </NavLink>
                ))}
              </div>
            </div>
          ) : (
            <div key={item.to}>
              <NavLink
                to={item.to}
                end={item.end}
                onClick={onClose}
                className={({ isActive }) => `app-sidebar-link${isActive ? " app-sidebar-link-active" : ""}`}
              >
                <item.icon width={17} height={17} aria-hidden="true" />
                <span>{item.label}</span>
              </NavLink>
              {item.hasApps && apps.length > 0 && (
                <div className="app-drawer-subnav" aria-label="Applications">
                  {apps.map((app) => (
                    <NavLink
                      key={app.id}
                      to={`/applications/${app.id}/overview`}
                      onClick={onClose}
                      className={({ isActive }) => `app-sidebar-link${isActive ? " app-sidebar-link-active" : ""}`}
                    >
                      <span>{app.name}</span>
                    </NavLink>
                  ))}
                </div>
              )}
            </div>
          ))}
        </nav>
      </div>
    </div>
  );
}

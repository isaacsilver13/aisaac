import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { NavLink } from "react-router-dom";
import { Activity, NavArrowDown, NavArrowRight, SidebarCollapse, SidebarExpand } from "iconoir-react";

import { AppIcon } from "../application/AppIcon";
import { StatusDot } from "../primitives/StatusDot";
import type { Tone } from "../primitives/tone";
import { NAV_ITEMS } from "./navItems";
import { ThemeToggle } from "./ThemeToggle";

interface SystemStatusSummary {
  label: string;
  tone: Tone;
}

export interface SidebarApp {
  id: string;
  name: string;
}

interface SidebarProps {
  status: SystemStatusSummary;
  apps: SidebarApp[];
  collapsed: boolean;
  onToggleCollapsed: () => void;
}

const linkClass = ({ isActive }: { isActive: boolean }) => `app-sidebar-link${isActive ? " app-sidebar-link-active" : ""}`;

export function Sidebar({ status, apps, collapsed, onToggleCollapsed }: SidebarProps) {
  const [appsOpen, setAppsOpen] = useState(true);
  const CollapseIcon = collapsed ? SidebarExpand : SidebarCollapse;

  return (
    <aside className={`app-sidebar${collapsed ? " app-sidebar-collapsed" : ""}`} aria-label="Primary">
      <div className="app-sidebar-brand">
        <div className="brand-mark"><Activity width={16} height={16} aria-hidden="true" /></div>
        <span className="app-sidebar-label">AISAAC</span>
      </div>
      <nav className="app-sidebar-nav">
        {NAV_ITEMS.map((item) => (
          <div key={item.to}>
            <div className="app-sidebar-row">
              <NavLink to={item.to} end={item.end} className={linkClass} title={collapsed ? item.label : undefined}>
                <item.icon width={17} height={17} aria-hidden="true" />
                <span className="app-sidebar-label">{item.label}</span>
              </NavLink>
              {item.hasApps && !collapsed && (
                <button
                  type="button"
                  className="app-sidebar-expand"
                  onClick={() => setAppsOpen((open) => !open)}
                  aria-expanded={appsOpen}
                  aria-label={appsOpen ? "Collapse applications" : "Expand applications"}
                >
                  {appsOpen ? <NavArrowDown width={14} height={14} /> : <NavArrowRight width={14} height={14} />}
                </button>
              )}
            </div>
            <AnimatePresence initial={false}>
              {item.hasApps && appsOpen && !collapsed && (
                <motion.div
                  className="app-sidebar-sub"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  style={{ overflow: "hidden" }}
                >
                  {apps.map((app) => (
                    <NavLink key={app.id} to={`/applications/${app.id}/overview`} className={linkClass}>
                      <AppIcon appId={app.id} size={15} />
                      <span>{app.name}</span>
                    </NavLink>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        ))}
      </nav>
      <div className="app-sidebar-status">
        <StatusDot tone={status.tone} label={status.label} />
        <span className="app-sidebar-label">{status.label}</span>
        <ThemeToggle />
      </div>
      <button
        type="button"
        className="app-sidebar-collapse"
        onClick={onToggleCollapsed}
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        aria-pressed={collapsed}
      >
        <CollapseIcon width={17} height={17} aria-hidden="true" />
        <span className="app-sidebar-label">Collapse</span>
      </button>
    </aside>
  );
}

import { useState } from "react";
import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { Activity, NavArrowDown, NavArrowRight, SidebarCollapse, SidebarExpand } from "iconoir-react";

import { AppIcon } from "../application/AppIcon";
import { StatusDot } from "../primitives/StatusDot";
import type { Tone } from "../primitives/tone";
import { NAV_ITEMS, isNavGroup, type NavGroup } from "./navItems";
import { ThemeToggle } from "./ThemeToggle";
import { motionDuration, motionEase } from "../../theme/motion";

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

function SidebarGroup({ group, collapsed }: { group: NavGroup; collapsed: boolean }) {
  const [open, setOpen] = useState(true);

  // Collapsed: no room for a header, so the group's links show as plain icons.
  if (collapsed) {
    return group.children.map((child) => (
      <NavLink key={child.to} to={child.to} className={linkClass} title={child.label}>
        {({ isActive }) => <>
          {isActive && <motion.span className="app-sidebar-active-indicator" layoutId="active-link" />}
          <child.icon width={17} height={17} aria-hidden="true" />
          <span className="app-sidebar-label">{child.label}</span>
        </>}
      </NavLink>
    ));
  }

  const Arrow = open ? NavArrowDown : NavArrowRight;
  return (
    <div>
      <button type="button" className="app-sidebar-link app-sidebar-group" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <group.icon width={17} height={17} aria-hidden="true" />
        <span className="app-sidebar-label">{group.label}</span>
        <Arrow width={14} height={14} aria-hidden="true" className="app-sidebar-group-arrow" />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            className="app-sidebar-sub"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: motionDuration.standard, ease: motionEase }}
            style={{ overflow: "hidden" }}
          >
            {group.children.map((child) => (
              <NavLink key={child.to} to={child.to} className={linkClass}>
                {({ isActive }) => <>
                  {isActive && <motion.span className="app-sidebar-active-indicator" layoutId="active-link" />}
                  <span>{child.label}</span>
                </>}
              </NavLink>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function Sidebar({ status, apps, collapsed, onToggleCollapsed }: SidebarProps) {
  const [appsOpen, setAppsOpen] = useState(true);
  const location = useLocation();
  const CollapseIcon = collapsed ? SidebarExpand : SidebarCollapse;
  const activeAppId = apps.find((app) => location.pathname.startsWith(`/applications/${app.id}/`))?.id;

  return (
    <aside className={`app-sidebar${collapsed ? " app-sidebar-collapsed" : ""}`} aria-label="Primary">
      <div className="app-sidebar-brand">
        <div className="brand-mark"><Activity width={16} height={16} aria-hidden="true" /></div>
        <span className="app-sidebar-label">AISAAC</span>
      </div>
      <LayoutGroup id="primary-sidebar">
        <nav className="app-sidebar-nav">
          {NAV_ITEMS.map((item) => isNavGroup(item) ? (
            <SidebarGroup key={item.label} group={item} collapsed={collapsed} />
          ) : (
            <div key={item.to}>
              <div className="app-sidebar-row">
                <NavLink to={item.to} end={item.end} className={linkClass} title={collapsed ? item.label : undefined}>
                  {({ isActive }) => (
                    <>
                      {isActive && !(item.hasApps && appsOpen && !collapsed && activeAppId) && (
                        <motion.span className="app-sidebar-active-indicator" layoutId="active-link" />
                      )}
                      <item.icon width={17} height={17} aria-hidden="true" />
                      <span className="app-sidebar-label">{item.label}</span>
                    </>
                  )}
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
                    transition={{ duration: motionDuration.standard, ease: motionEase }}
                    style={{ overflow: "hidden" }}
                  >
                    {apps.map((app) => {
                      const isActive = activeAppId === app.id;
                      return (
                        <Link
                          key={app.id}
                          to={`/applications/${app.id}/overview`}
                          className={`app-sidebar-link${isActive ? " app-sidebar-link-active" : ""}`}
                          aria-current={isActive ? "page" : undefined}
                        >
                          {isActive && <motion.span className="app-sidebar-active-indicator" layoutId="active-link" />}
                          <AppIcon appId={app.id} size={15} />
                          <span>{app.name}</span>
                        </Link>
                      );
                    })}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ))}
        </nav>
      </LayoutGroup>
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

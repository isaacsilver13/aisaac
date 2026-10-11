import type { ComponentType, SVGProps } from "react";
import { AppWindow, Book, Brain, Dashboard, Github, Heart, Settings, Shop, TaskList, Timer, Trophy } from "iconoir-react";

export interface NavItem {
  to: string;
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  /** Matches react-router's `end` prop — true only for the index route. */
  end?: boolean;
  /** Renders the monitored applications as a collapsible sub-list in the sidebar. */
  hasApps?: boolean;
}

/** A labelled, collapsible group of links with no page of its own. */
export interface NavGroup {
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  children: NavItem[];
}

export const isNavGroup = (entry: NavItem | NavGroup): entry is NavGroup => "children" in entry;

export const NAV_ITEMS: (NavItem | NavGroup)[] = [
  { to: "/", label: "Overview", icon: Dashboard, end: true },
  { to: "/applications", label: "Applications", icon: AppWindow, hasApps: true },
  { to: "/github", label: "GitHub", icon: Github },
  { to: "/tasks", label: "Tasks", icon: TaskList },
  {
    label: "Life",
    icon: Heart,
    children: [
      { to: "/sports", label: "Sports", icon: Trophy },
      { to: "/news", label: "News", icon: Book },
      { to: "/shoes", label: "Shoes", icon: Shop },
    ],
  },
  { to: "/automations", label: "Automations", icon: Timer },
  { to: "/knowledge", label: "Knowledge", icon: Brain },
  { to: "/learning", label: "Daily learning", icon: Book },
  { to: "/settings", label: "Settings", icon: Settings },
];

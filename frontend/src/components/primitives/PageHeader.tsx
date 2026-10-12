import type { ReactNode } from "react";

interface PageHeaderProps {
  title: string;
  icon?: ReactNode;
  description?: string;
  lastUpdated?: string;
  actions?: ReactNode;
}

export function PageHeader({ title, icon, description, lastUpdated, actions }: PageHeaderProps) {
  return (
    <div className="ui-page-header">
      <div>
        <h1>{icon}{title}</h1>
        {description && <p>{description}</p>}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        {lastUpdated && <time>Last updated {lastUpdated}</time>}
        {actions}
      </div>
    </div>
  );
}

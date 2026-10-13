import type { HTMLAttributes } from "react";

interface SkeletonProps extends HTMLAttributes<HTMLDivElement> {
  height?: number | string;
}

export function Skeleton({ height = 160, className = "", style, ...props }: SkeletonProps) {
  return (
    <div
      className={`ui-skeleton ${className}`.trim()}
      style={{ height, ...style }}
      aria-hidden="true"
      {...props}
    />
  );
}

interface SkeletonStackProps extends HTMLAttributes<HTMLDivElement> {
  rows?: number;
  rowHeight?: number | string;
}

/** A shaped placeholder for tables, feeds, and other repeated rows. */
export function SkeletonStack({ rows = 4, rowHeight = 48, className = "", ...props }: SkeletonStackProps) {
  return (
    <div className={`ui-skeleton-stack ${className}`.trim()} aria-hidden="true" {...props}>
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton height={rowHeight} key={index} />
      ))}
    </div>
  );
}

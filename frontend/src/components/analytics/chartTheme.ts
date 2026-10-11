// Shared recharts styling, written against theme tokens so light and dark both read.
export const axisTick = { fill: "var(--muted)", fontSize: 11 };
export const tooltipProps = {
  cursor: { fill: "var(--hover)" },
  contentStyle: {
    background: "var(--surface)",
    border: "1px solid var(--line)",
    borderRadius: 8,
    fontSize: 12,
    color: "var(--ink)",
  },
  labelStyle: { color: "var(--ink)" },
};

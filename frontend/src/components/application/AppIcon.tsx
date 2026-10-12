import { createElement, type ComponentType, type SVGProps } from "react";
import { AppWindow, Basketball, Coins, Crown, FootballBall, GraphUp, Gym, Link, MusicDoubleNote, Rocket } from "iconoir-react";

/** One icon per registry app id; used by the sidebar, drawer, Applications page and app header. */
const APP_ICONS: Record<string, ComponentType<SVGProps<SVGSVGElement>>> = {
  vinyl: MusicDoubleNote,
  "nfl-confidence": FootballBall,
  "betting-aggregator": Coins,
  "nba-prediction": Basketball,
  "gym-tracker": Gym,
  "portfolio-analysis": GraphUp,
  "aisaac-rocket": Rocket,
  chess: Crown,
  "nba-teammates-chain": Link,
};

export function AppIcon({ appId, size = 16 }: { appId: string; size?: number }) {
  return createElement(APP_ICONS[appId] ?? AppWindow, { width: size, height: size, "aria-hidden": true });
}

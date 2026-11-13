// A board's event theme as CSS variables on a wrapper. With "use the venue's colors" (the
// default look), the venue's theme from the box wins when there is one; standalone, the
// board's own colors apply.

import type { CSSProperties, ReactNode } from "react";
import type { Theme } from "@leaderboard/shared";
import { uploadUrl } from "../api";

export function themeVars(t: Theme): CSSProperties {
  const v = (name: string, own: string) => (t.useVenue ? `var(${name}, ${own})` : own);
  const bg =
    t.background.kind === "image" && t.background.image
      ? `linear-gradient(rgba(0,0,0,.45), rgba(0,0,0,.6)), url("${uploadUrl(t.background.image)}") center / cover no-repeat, ${t.background.color}`
      : t.background.kind === "gradient"
        ? `linear-gradient(160deg, ${t.background.color}, ${t.background.color2})`
        : t.background.color;
  return {
    "--accent": v("--venue-primary", t.accent),
    "--accent2": v("--venue-accent", t.accent2),
    "--ink": v("--venue-text", t.text),
    "--board-bg": t.useVenue ? `var(--venue-bg, ${t.background.color})` : t.background.color,
    "--board-bg-full": t.useVenue && t.background.kind !== "image" ? `var(--venue-bg, ${bg})` : bg,
  } as CSSProperties;
}

export function Themed({ theme, className, children, style }: { theme: Theme; className?: string; children: ReactNode; style?: CSSProperties }) {
  return (
    <div className={`themed title-${theme.titleStyle} ${className ?? ""}`} style={{ ...themeVars(theme), ...style }}>
      {children}
    </div>
  );
}

export function BoardTitle({ theme, title, subtitle, big }: { theme: Theme; title: string; subtitle?: string; big?: boolean }) {
  return (
    <div className={`board-title ${big ? "big" : ""} ${title.length > 26 ? "long" : ""}`}>
      <h1>
        {theme.emoji && <span className="emoji">{theme.emoji}</span>}
        <span className="text">{title}</span>
      </h1>
      {subtitle && <p className="subtitle">{subtitle}</p>}
    </div>
  );
}

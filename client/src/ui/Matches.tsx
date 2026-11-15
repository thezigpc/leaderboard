import type { DerivedMatch } from "@leaderboard/shared";
import { scoreText, slotName } from "./format";

export function MatchLine({
  m,
  names,
  all,
  follow,
  onClick,
  showLabel = true,
}: {
  m: DerivedMatch;
  names: Map<string, string>;
  all: DerivedMatch[];
  follow?: string;
  onClick?: () => void;
  showLabel?: boolean;
}) {
  const side = (s: "a" | "b") => {
    const slot = m[s];
    const id = slot.kind === "player" ? slot.id : undefined;
    const won = m.state === "done" && !!id && m.winner === id;
    const draw = m.state === "done" && m.result?.winner === null;
    return (
      <span className={`ml-side ${won ? "won" : ""} ${m.state === "done" && !won && !draw ? "lost" : ""} ${slot.kind !== "player" ? "tbd" : ""} ${follow && id === follow ? "me" : ""}`}>
        {slotName(slot, names, all)}
      </span>
    );
  };
  const Tag = onClick ? "button" : "div";
  return (
    <Tag className={`match-line ${m.state}`} onClick={onClick} type={onClick ? "button" : undefined}>
      {showLabel && <span className="ml-label">{m.label}</span>}
      <span className="ml-body">
        {side("a")}
        <span className="ml-vs">{m.state === "done" ? scoreText(m) || (m.result?.winner === null ? "draw" : "def.") : "vs"}</span>
        {side("b")}
      </span>
      {m.lane && m.state !== "done" && <span className="ml-lane">{m.lane}</span>}
      {m.state === "ready" && m.calledAt && !m.game && <span className="ml-called">called</span>}
      {m.game && (
        <span className="ml-game">
          playing in {m.game.name}, room <b>{m.game.room}</b>
        </span>
      )}
      {onClick && m.note && !m.game && (
        <span className="ml-note" title={m.note}>
          needs a result
        </span>
      )}
    </Tag>
  );
}

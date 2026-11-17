import type { Level } from "../../api/metrics";
import { LEVEL_GLYPH, LEVEL_LABEL } from "../../lib/metrics";
import "../../styles/Metrics.css";

type TierBadgeProps = {
  level: Level;
  /** Smaller, for tables. */
  small?: boolean;
};

/** A tier as a word, a shape and a colour: it never relies on colour alone. */
export default function TierBadge({ level, small = false }: TierBadgeProps) {
  return (
    <span className={`tier tier--${level}${small ? " tier--small" : ""}`}>
      <span className="tier__glyph" aria-hidden="true">
        {LEVEL_GLYPH[level]}
      </span>
      {LEVEL_LABEL[level]}
    </span>
  );
}

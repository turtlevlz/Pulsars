import { Link } from "react-router-dom";
import type { MetricStatus } from "../../api/metrics";
import EvidenceChip from "./EvidenceChip";
import TierBadge from "./TierBadge";
import "../../styles/Metrics.css";

type TierNoteProps = {
  status: MetricStatus | null;
  /** The route of the metric's detail page; left out where the reader is already on it. */
  detailsTo?: string;
  /** Show the action to take too (it is left out on the dashboard tiles, the alert strip has it). */
  withAction?: boolean;
  /** Lead with the tier itself, for a card whose header has no room for it. */
  withBadge?: boolean;
};

/** Why a metric has its tier, plus where that comes from, and the sensor quality when it matters. */
export default function TierNote({ status, detailsTo, withAction = false, withBadge = false }: TierNoteProps) {
  if (!status) return <p className="tier-note__reason">Checking...</p>;
  const quality = status.quality.note;
  const meta = (
    <div className="tier-note__meta">
      {withBadge && <TierBadge level={status.level} small />}
      <EvidenceChip level={status.evidenceLevel} />
      {!withBadge && quality && <span className="tier-note__quality">{quality}</span>}
      {detailsTo && (
        <Link to={detailsTo} className="tier-note__link">
          Details
        </Link>
      )}
    </div>
  );
  return (
    <div className="tier-note">
      {withBadge && meta}
      <p className="tier-note__reason" title={status.reason}>
        {status.reason}
      </p>
      {withAction && status.action && (
        <p className="tier-note__action">
          <strong>What to do:</strong> {status.action}
        </p>
      )}
      {withBadge && quality && <p className="tier-note__quality">{quality}</p>}
      {!withBadge && meta}
    </div>
  );
}

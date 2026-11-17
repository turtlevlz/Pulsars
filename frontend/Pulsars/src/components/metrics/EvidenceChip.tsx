import type { EvidenceLevel } from "../../api/metrics";
import { EVIDENCE_HINT, EVIDENCE_LABEL } from "../../lib/metrics";
import "../../styles/Metrics.css";

/** Where a tier comes from. The hover text says every tier is a proposal, not a NASA limit. */
export default function EvidenceChip({ level }: { level: EvidenceLevel }) {
  return (
    <span className="evidence" title={EVIDENCE_HINT[level]}>
      {EVIDENCE_LABEL[level]}
    </span>
  );
}

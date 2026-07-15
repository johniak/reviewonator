import { ShieldAlert, Bug, TriangleAlert, Lightbulb, MessageCircleMore } from "lucide-react";
import type { ReviewComment } from "../types";

const severityDetails = {
  security: { label: "Security", icon: ShieldAlert },
  bug: { label: "Bug", icon: Bug },
  warning: { label: "Warning", icon: TriangleAlert },
  suggestion: { label: "Suggestion", icon: Lightbulb },
  nit: { label: "Nit", icon: MessageCircleMore },
} as const;

export function SeverityBadge({ severity }: Pick<ReviewComment, "severity">) {
  const details = severityDetails[severity];
  const Icon = details.icon;
  return (
    <span className={`severity-badge severity-${severity}`}>
      <Icon aria-hidden="true" size={13} strokeWidth={2.2} />
      {details.label}
    </span>
  );
}

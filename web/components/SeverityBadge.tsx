import { ShieldAlert, Bug, TriangleAlert, Lightbulb, MessageCircleMore, UserRound } from "lucide-react";
import type { ReviewComment } from "../types";

const severityDetails = {
  security: { label: "Security", icon: ShieldAlert },
  bug: { label: "Bug", icon: Bug },
  warning: { label: "Warning", icon: TriangleAlert },
  suggestion: { label: "Suggestion", icon: Lightbulb },
  nit: { label: "Nit", icon: MessageCircleMore },
} as const;

/** Most to least severe, for pickers; the web bundle must not import zod schemas at runtime. */
export const severityOrder = Object.keys(severityDetails) as (keyof typeof severityDetails)[];

export function severityLabel(severity: keyof typeof severityDetails): string {
  return severityDetails[severity].label;
}

/** Marks a comment the user wrote by hand. */
export function AuthorBadge() {
  return (
    <span className="author-badge">
      <UserRound aria-hidden="true" size={13} strokeWidth={2.2} />
      You
    </span>
  );
}

export function SeverityBadge({ severity }: Pick<ReviewComment, "severity">) {
  if (!severity) return null;
  const details = severityDetails[severity];
  const Icon = details.icon;
  return (
    <span className={`severity-badge severity-${severity}`}>
      <Icon aria-hidden="true" size={13} strokeWidth={2.2} />
      {details.label}
    </span>
  );
}

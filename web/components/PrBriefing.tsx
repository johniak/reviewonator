import { ChevronRight, ExternalLink, EyeOff, Ticket } from "lucide-react";
import type { Briefing } from "../../src/domain/review";
import { MarkdownText } from "./MarkdownText";

export function PrBriefing({ briefing, reviewerLanguage, collapsed, onCollapsedChange }: {
  briefing: Briefing;
  reviewerLanguage: string;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
}) {
  const { ticket, text } = briefing;
  const ticketLabel = ticket && (
    <>
      <Ticket aria-hidden="true" size={14} />
      <strong>{ticket.key}</strong>
      {ticket.title && <>{" "}<span>{ticket.title}</span></>}
    </>
  );

  return (
    <section className={`pr-briefing ${collapsed ? "collapsed" : ""}`} aria-labelledby="pr-briefing-title">
      <div className="pr-briefing-heading">
        <h2>
          <button
            type="button"
            id="pr-briefing-title"
            className="pr-briefing-toggle"
            aria-expanded={!collapsed}
            onClick={() => onCollapsedChange(!collapsed)}
          >
            <ChevronRight aria-hidden="true" size={14} />
            About this PR
          </button>
        </h2>
        {!ticket && <span className="briefing-source">No ticket found, based on the code only</span>}
        {ticket?.url && (
          <a className="briefing-ticket" href={ticket.url} target="_blank" rel="noreferrer" title={ticket.title}>
            {ticketLabel}
            <ExternalLink aria-hidden="true" size={13} />
          </a>
        )}
        {ticket && !ticket.url && <span className="briefing-ticket">{ticketLabel}</span>}
        <small><EyeOff aria-hidden="true" size={13} /> Private · {reviewerLanguage}</small>
      </div>
      {!collapsed && <MarkdownText className="briefing-text">{text}</MarkdownText>}
    </section>
  );
}

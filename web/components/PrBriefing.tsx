import { ExternalLink, EyeOff, Ticket } from "lucide-react";
import type { Briefing } from "../../src/domain/review";

export function PrBriefing({ briefing, reviewerLanguage }: { briefing: Briefing; reviewerLanguage: string }) {
  const { ticket, text } = briefing;
  const ticketLabel = ticket && (
    <>
      <Ticket aria-hidden="true" size={14} />
      <strong>{ticket.key}</strong>
      {ticket.title && <>{" "}<span>{ticket.title}</span></>}
    </>
  );

  return (
    <section className="pr-briefing" aria-labelledby="pr-briefing-title">
      <div className="pr-briefing-heading">
        <h2 id="pr-briefing-title">What this PR is about</h2>
        <small><EyeOff aria-hidden="true" size={13} /> Private · {reviewerLanguage}</small>
      </div>
      {!ticket && <p className="briefing-source">No ticket found, based on the code only</p>}
      {ticket?.url && (
        <a className="briefing-ticket" href={ticket.url} target="_blank" rel="noreferrer" title={ticket.title}>
          {ticketLabel}
          <ExternalLink aria-hidden="true" size={13} />
        </a>
      )}
      {ticket && !ticket.url && <p className="briefing-ticket">{ticketLabel}</p>}
      <p className="briefing-text">{text}</p>
    </section>
  );
}

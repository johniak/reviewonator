import { ChevronRight, ExternalLink, EyeOff, Ticket } from "lucide-react";
import type { PullRequest } from "../../src/domain/pull-request";
import type { Briefing } from "../../src/domain/review";
import { MarkdownText } from "./MarkdownText";

export interface PullRequestPeople {
  author: string;
  /** Everyone else who authored a commit in the pull request. */
  contributors: string[];
}

export function pullRequestPeople(pullRequest: Pick<PullRequest, "author" | "commits">): PullRequestPeople {
  const author = pullRequest.author.login;
  const names = pullRequest.commits.flatMap((commit) => commit.authors.map((person) => (
    person.login || (typeof person.name === "string" ? person.name.trim() : "")
  )));
  return { author, contributors: [...new Set(names)].filter((name) => name && name !== author) };
}

export function PrBriefing({ briefing, people, reviewerLanguage, collapsed, onCollapsedChange }: {
  briefing: Briefing;
  people: PullRequestPeople;
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
      {!collapsed && (
        <>
          <p className="briefing-people">
            PR by <strong>{people.author}</strong>
            {people.contributors.length > 0 && (
              <> · Commits also by {people.contributors.map((name, index) => (
                <span key={name}>{index > 0 && ", "}<strong>{name}</strong></span>
              ))}</>
            )}
            {ticket?.author && <> · Ticket by <strong>{ticket.author}</strong></>}
          </p>
          <MarkdownText className="briefing-text">{text}</MarkdownText>
        </>
      )}
    </section>
  );
}

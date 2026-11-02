import { Check, Copy, ExternalLink, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { UpdateNotice } from "../../src/domain/update";

const UPDATE_COMMAND = "reviewonator update";

export function UpdateNoticeToast({ notice, onDismiss }: { notice: UpdateNotice; onDismiss: () => void }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2_000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  async function copyCommand() {
    try {
      await navigator.clipboard.writeText(UPDATE_COMMAND);
      setCopied(true);
    } catch {
      // The command stays visible for manual copying.
    }
  }

  return (
    <aside className="update-notice" role="status">
      <div className="update-notice-body">
        <p>Reviewonator {notice.latest} is available — you have {notice.current}.</p>
        <div className="update-notice-command">
          <code>{UPDATE_COMMAND}</code>
          <button type="button" className="secondary-button" aria-label="Copy update command" onClick={copyCommand}>
            {copied ? <Check aria-hidden="true" size={14} /> : <Copy aria-hidden="true" size={14} />}
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
        <a href={notice.releaseUrl} target="_blank" rel="noreferrer">
          Release notes
          <ExternalLink aria-hidden="true" size={13} />
        </a>
      </div>
      <button type="button" className="icon-button update-notice-dismiss" aria-label="Dismiss update notice" onClick={onDismiss}>
        <X aria-hidden="true" size={16} />
      </button>
    </aside>
  );
}

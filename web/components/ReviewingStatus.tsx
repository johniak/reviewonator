import { Info, LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";

/** After this long without a delivery, the agent may have stopped. */
const stopHintSeconds = 15 * 60;

export function ReviewingStatus({ startedAt }: { startedAt: string }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  const elapsed = Math.floor((now - Date.parse(startedAt)) / 1_000);

  return (
    <section className="review-summary reviewing-status" aria-labelledby="reviewing-status-title">
      <h2 id="reviewing-status-title">Review summary</h2>
      <div className="reviewing-progress">
        <LoaderCircle className="spin" aria-hidden="true" size={16} />
        <span>The AI is reviewing this pull request</span>
        <span className="reviewing-elapsed" title="Time since the review started">{formatElapsed(elapsed)}</span>
      </div>
      {elapsed >= stopHintSeconds && (
        <p className="reviewing-hint">
          <Info aria-hidden="true" size={14} />
          If the agent has stopped, cancel this review and run the skill again.
        </p>
      )}
    </section>
  );
}

/** Formats seconds as `m:ss`, or `h:mm:ss` from an hour on. */
export function formatElapsed(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const rest = String(seconds % 60).padStart(2, "0");
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${rest}` : `${minutes}:${rest}`;
}

import type { KeyboardEvent } from "react";

/** Enter sends the message and Shift+Enter starts a new line, as in a chat. */
export function sendOnEnter(send: () => void) {
  return (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    send();
  };
}

export function SendHint() {
  return (
    <small className="send-hint">
      <kbd>Enter</kbd> to send, <kbd>Shift</kbd>+<kbd>Enter</kbd> for a new line
    </small>
  );
}

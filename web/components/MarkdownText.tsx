import { isValidElement, type ReactNode } from "react";
import Markdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";

/**
 * Renders comment text the way GitHub renders a pull request comment: GitHub Flavored Markdown,
 * with every new line kept as a line break.
 */
export function MarkdownText({ children, className }: { children: string; className?: string }) {
  return (
    <div className={className ? `markdown-text ${className}` : "markdown-text"}>
      <Markdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        components={{
          a: ({ href, children: label }) => <a href={href} target="_blank" rel="noreferrer">{label}</a>,
          pre: ({ children: code }) => <CodeBlock>{code}</CodeBlock>,
        }}
      >
        {children}
      </Markdown>
    </div>
  );
}

function CodeBlock({ children }: { children?: ReactNode }) {
  const language = isValidElement<{ className?: string }>(children)
    ? children.props.className?.match(/language-(\S+)/)?.[1]
    : undefined;

  if (language !== "suggestion") return <pre>{children}</pre>;
  return (
    <div className="markdown-suggestion">
      <span>Suggested change</span>
      <pre>{children}</pre>
    </div>
  );
}

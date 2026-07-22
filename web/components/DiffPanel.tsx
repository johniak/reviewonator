import {
  parseDiffFromFile,
  parsePatchFiles,
  type DiffLineAnnotation,
  type FileDiffMetadata,
} from "@pierre/diffs";
import { FileDiff } from "@pierre/diffs/react";
import {
  AlignJustify,
  Check,
  Columns2,
  ExternalLink,
  FileCode2,
  LoaderCircle,
  MessageSquarePlus,
  Plus,
  Rows3,
  Square,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { FileContext } from "../../src/github/client";
import type {
  CommentActions,
  LineCommentDraft,
  LineCommentDraftActions,
  ReviewComment,
} from "../types";
import { ReviewCommentCard } from "./ReviewCommentCard";

type Props = CommentActions & LineCommentDraftActions & {
  patch: string;
  activePath: string;
  fileUrls: Record<string, string>;
  comments: ReviewComment[];
  reviewerLanguage?: string;
  focusedCommentId: string | null;
  viewMode: "single" | "all";
  onViewModeChange: (mode: "single" | "all") => void;
  diffStyle: "unified" | "split";
  onDiffStyleChange: (style: "unified" | "split") => void;
  loadFileContext: (path: string) => Promise<FileContext>;
};

export function DiffPanel({
  patch,
  activePath,
  fileUrls,
  comments,
  reviewerLanguage = "English",
  focusedCommentId,
  viewMode,
  onViewModeChange,
  diffStyle,
  onDiffStyleChange,
  loadFileContext,
  drafts,
  onCreateDraft,
  onChangeDraft,
  onRemoveDraft,
  ...actions
}: Props) {
  const files = useMemo(
    () => parsePatchFiles(patch, "reviewonator", true).flatMap((item) => item.files),
    [patch],
  );
  const visibleFiles = viewMode === "all"
    ? files
    : files.filter((item) => item.name === activePath);

  if (visibleFiles.length === 0) {
    return (
      <div className="empty-state">
        <FileCode2 size={28} />
        <h2>No renderable diff</h2>
        <p>This file may be binary or contain metadata-only changes.</p>
      </div>
    );
  }

  return (
    <div className="diff-view">
      <div className="view-mode-toolbar" aria-label="Diff view mode">
        <div className="view-control-group">
          <span>Files</span>
          <div className="view-mode-toggle">
            <button
              type="button"
              className={viewMode === "single" ? "active" : ""}
              aria-pressed={viewMode === "single"}
              onClick={() => onViewModeChange("single")}
            >
              <Square aria-hidden="true" size={13} />
              Single file
            </button>
            <button
              type="button"
              className={viewMode === "all" ? "active" : ""}
              aria-pressed={viewMode === "all"}
              onClick={() => onViewModeChange("all")}
            >
              <Rows3 aria-hidden="true" size={14} />
              All files
            </button>
          </div>
        </div>
        <div className="view-control-group">
          <span>Diff</span>
          <div className="view-mode-toggle">
            <button
              type="button"
              className={diffStyle === "unified" ? "active" : ""}
              aria-pressed={diffStyle === "unified"}
              onClick={() => onDiffStyleChange("unified")}
            >
              <AlignJustify aria-hidden="true" size={13} />
              Unified
            </button>
            <button
              type="button"
              className={diffStyle === "split" ? "active" : ""}
              aria-pressed={diffStyle === "split"}
              onClick={() => onDiffStyleChange("split")}
            >
              <Columns2 aria-hidden="true" size={14} />
              Split
            </button>
          </div>
        </div>
        <p className="line-comment-hint">
          <MessageSquarePlus aria-hidden="true" size={14} />
          Hover any line and press <strong>+</strong> to comment.
        </p>
      </div>

      <div
        key={viewMode === "single" ? activePath : "all-files"}
        className={viewMode === "all" ? "all-files-stack" : "single-file-stack"}
      >
        {visibleFiles.map((file) => {
          const lineAnnotations = buildLineAnnotations(file.name, comments, drafts);
          return (
            <FileDiffCard
              key={file.name}
              file={file}
              fileUrl={fileUrls[file.name]}
              annotations={lineAnnotations}
              reviewerLanguage={reviewerLanguage}
              focusedCommentId={focusedCommentId}
              actions={actions}
              diffStyle={diffStyle}
              loadFileContext={loadFileContext}
              onCreateDraft={onCreateDraft}
              onChangeDraft={onChangeDraft}
              onRemoveDraft={onRemoveDraft}
            />
          );
        })}
      </div>
    </div>
  );
}

type LineAnnotationContent = {
  comments: ReviewComment[];
  draft?: LineCommentDraft;
};

export function buildLineAnnotations(
  path: string,
  comments: ReviewComment[],
  drafts: LineCommentDraft[],
): DiffLineAnnotation<LineAnnotationContent>[] {
  const grouped = new Map<string, DiffLineAnnotation<LineAnnotationContent>>();
  const getAnnotation = (side: "deletions" | "additions", lineNumber: number) => {
    const key = `${side}:${lineNumber}`;
    const existing = grouped.get(key);
    if (existing) return existing;
    const annotation: DiffLineAnnotation<LineAnnotationContent> = {
      side,
      lineNumber,
      metadata: { comments: [] },
    };
    grouped.set(key, annotation);
    return annotation;
  };

  for (const comment of comments) {
    if (comment.type === "line" && comment.path === path && comment.line) {
      getAnnotation("additions", comment.line).metadata.comments.push(comment);
    }
  }
  for (const draft of drafts) {
    if (draft.path === path) {
      getAnnotation(draft.side === "LEFT" ? "deletions" : "additions", draft.line).metadata.draft = draft;
    }
  }
  return [...grouped.values()];
}

export function fileSectionId(path: string): string {
  return `file-${path.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

function FileDiffCard({
  file,
  fileUrl,
  annotations,
  reviewerLanguage,
  focusedCommentId,
  actions,
  diffStyle,
  loadFileContext,
  onCreateDraft,
  onChangeDraft,
  onRemoveDraft,
}: {
  file: FileDiffMetadata;
  fileUrl: string | undefined;
  annotations: DiffLineAnnotation<LineAnnotationContent>[];
  reviewerLanguage: string;
  focusedCommentId: string | null;
  actions: CommentActions;
  diffStyle: "unified" | "split";
  loadFileContext: (path: string) => Promise<FileContext>;
} & Pick<LineCommentDraftActions, "onCreateDraft" | "onChangeDraft" | "onRemoveDraft">) {
  const containerRef = useRef<HTMLElement>(null);
  const [shouldLoad, setShouldLoad] = useState(false);
  const [context, setContext] = useState<FileContext | null>(null);
  const [contextError, setContextError] = useState<string | null>(null);

  useEffect(() => {
    const element = containerRef.current;
    if (!element || typeof IntersectionObserver === "undefined") {
      setShouldLoad(true);
      return;
    }
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setShouldLoad(true);
        observer.disconnect();
      }
    }, { rootMargin: "400px" });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!shouldLoad || context || contextError) return;
    let active = true;
    loadFileContext(file.name)
      .then((loaded) => { if (active) setContext(loaded); })
      .catch((error: unknown) => {
        if (active) setContextError(error instanceof Error ? error.message : "Context unavailable");
      });
    return () => { active = false; };
  }, [context, contextError, file.name, loadFileContext, shouldLoad]);

  const expandableFile = useMemo(
    () => context ? buildExpandableDiff(file, context) : file,
    [context, file],
  );

  return (
    <section className="diff-panel" id={fileSectionId(file.name)} ref={containerRef}>
      <div className="diff-toolbar">
        <div>
          <span className="eyebrow">Changed file</span>
          <h2>{file.name}</h2>
        </div>
        <div className="diff-toolbar-actions">
          {!context && !contextError && (
            <span className="context-status"><LoaderCircle className="spin" size={13} /> Loading context</span>
          )}
          {context && (
            <span className="context-status context-ready"><Check size={13} /> Expandable context</span>
          )}
          {contextError && <span className="context-status context-error" title={contextError}>Context unavailable</span>}
          <a className="secondary-button" href={fileUrl} target="_blank" rel="noreferrer">
            View full file on GitHub
            <ExternalLink aria-hidden="true" size={15} />
          </a>
        </div>
      </div>
      <div className="diff-surface">
        <RenderedFileDiff
          file={expandableFile}
          annotations={annotations}
          reviewerLanguage={reviewerLanguage}
          focusedCommentId={focusedCommentId}
          actions={actions}
          diffStyle={diffStyle}
          path={file.name}
          onCreateDraft={onCreateDraft}
          onChangeDraft={onChangeDraft}
          onRemoveDraft={onRemoveDraft}
        />
      </div>
    </section>
  );
}

export function buildExpandableDiff(file: FileDiffMetadata, context: FileContext): FileDiffMetadata {
  try {
    return parseDiffFromFile(
      {
        name: file.prevName ?? file.name,
        contents: context.oldContent ?? "",
        cacheKey: `${file.prevObjectId ?? "empty"}:full`,
      },
      {
        name: file.name,
        contents: context.newContent ?? "",
        cacheKey: `${file.newObjectId ?? "empty"}:full`,
      },
      { context: 3 },
      true,
    );
  } catch {
    return file;
  }
}

function RenderedFileDiff({
  file,
  annotations,
  reviewerLanguage,
  focusedCommentId,
  actions,
  diffStyle,
  path,
  onCreateDraft,
  onChangeDraft,
  onRemoveDraft,
}: {
  file: FileDiffMetadata;
  annotations: DiffLineAnnotation<LineAnnotationContent>[];
  reviewerLanguage: string;
  focusedCommentId: string | null;
  actions: CommentActions;
  diffStyle: "unified" | "split";
  path: string;
} & Pick<LineCommentDraftActions, "onCreateDraft" | "onChangeDraft" | "onRemoveDraft">) {
  return (
    <FileDiff<LineAnnotationContent>
      fileDiff={file}
      options={{
        themeType: "dark",
        theme: "github-dark",
        diffStyle,
        diffIndicators: "bars",
        hunkSeparators: "line-info",
        expansionLineCount: 10,
        overflow: "scroll",
        disableFileHeader: true,
        enableGutterUtility: true,
        lineHoverHighlight: "both",
      }}
      lineAnnotations={annotations}
      renderGutterUtility={(getHoveredLine) => (
        <button
          className="diff-comment-trigger"
          type="button"
          aria-label="Add a comment to this line"
          title="Ask the AI agent to review your comment"
          onClick={() => {
            const hovered = getHoveredLine();
            if (!hovered) return;
            onCreateDraft({
              path,
              line: hovered.lineNumber,
              side: hovered.side === "deletions" ? "LEFT" : "RIGHT",
            });
          }}
        >
          <Plus aria-hidden="true" size={13} />
        </button>
      )}
      renderAnnotation={(annotation) => annotation.metadata ? (
        <div className="line-annotation-stack">
          {annotation.metadata.comments.map((comment) => (
            <ReviewCommentCard
              key={comment.id}
              comment={comment}
              reviewerLanguage={reviewerLanguage}
              focused={comment.id === focusedCommentId}
              {...actions}
            />
          ))}
          {annotation.metadata.draft && (
            <LineCommentDraftCard
              draft={annotation.metadata.draft}
              onChangeDraft={onChangeDraft}
              onRemoveDraft={onRemoveDraft}
            />
          )}
        </div>
      ) : null}
    />
  );
}

export function LineCommentDraftCard({
  draft,
  onChangeDraft,
  onRemoveDraft,
}: {
  draft: LineCommentDraft;
} & Pick<LineCommentDraftActions, "onChangeDraft" | "onRemoveDraft">) {
  const location = { path: draft.path, line: draft.line, side: draft.side };
  return (
    <section className="line-comment-draft" aria-label={`Your comment for ${draft.path} line ${draft.line}`}>
      <div className="line-comment-draft-heading">
        <span><MessageSquarePlus aria-hidden="true" size={14} /> Your comment for the AI agent</span>
        <button
          type="button"
          aria-label="Discard this comment"
          title="Discard"
          onClick={() => onRemoveDraft(location)}
        >
          <Trash2 aria-hidden="true" size={13} />
        </button>
      </div>
      <textarea
        autoFocus
        rows={3}
        value={draft.message}
        placeholder="Write the point in your own words. The AI agent will verify it against the code and rewrite it as a clear review comment."
        onChange={(event) => onChangeDraft(location, event.target.value)}
      />
      <small>This stays private until the AI agent checks it and you explicitly include the revised comment.</small>
    </section>
  );
}

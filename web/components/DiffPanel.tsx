import {
  parseDiffFromFile,
  parsePatchFiles,
  type DiffLineAnnotation,
  type FileDiffMetadata,
} from "@pierre/diffs";
import { FileDiff } from "@pierre/diffs/react";
import { AlignJustify, Check, Columns2, ExternalLink, FileCode2, LoaderCircle, Rows3, Square } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { FileContext } from "../../src/github/client";
import type { CommentActions, ReviewComment } from "../types";
import { ReviewCommentCard } from "./ReviewCommentCard";

type Props = CommentActions & {
  patch: string;
  activePath: string;
  fileUrls: Record<string, string>;
  comments: ReviewComment[];
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
  focusedCommentId,
  viewMode,
  onViewModeChange,
  diffStyle,
  onDiffStyleChange,
  loadFileContext,
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
      </div>

      <div
        key={viewMode === "single" ? activePath : "all-files"}
        className={viewMode === "all" ? "all-files-stack" : "single-file-stack"}
      >
        {visibleFiles.map((file) => {
          const lineAnnotations: DiffLineAnnotation<ReviewComment>[] = comments
            .filter((comment) => comment.type === "line" && comment.path === file.name)
            .map((comment) => ({
              side: "additions",
              lineNumber: comment.line!,
              metadata: comment,
            }));
          return (
            <FileDiffCard
              key={file.name}
              file={file}
              fileUrl={fileUrls[file.name]}
              annotations={lineAnnotations}
              focusedCommentId={focusedCommentId}
              actions={actions}
              diffStyle={diffStyle}
              loadFileContext={loadFileContext}
            />
          );
        })}
      </div>
    </div>
  );
}

export function fileSectionId(path: string): string {
  return `file-${path.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

function FileDiffCard({
  file,
  fileUrl,
  annotations,
  focusedCommentId,
  actions,
  diffStyle,
  loadFileContext,
}: {
  file: FileDiffMetadata;
  fileUrl: string | undefined;
  annotations: DiffLineAnnotation<ReviewComment>[];
  focusedCommentId: string | null;
  actions: CommentActions;
  diffStyle: "unified" | "split";
  loadFileContext: (path: string) => Promise<FileContext>;
}) {
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
          focusedCommentId={focusedCommentId}
          actions={actions}
          diffStyle={diffStyle}
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
  focusedCommentId,
  actions,
  diffStyle,
}: {
  file: FileDiffMetadata;
  annotations: DiffLineAnnotation<ReviewComment>[];
  focusedCommentId: string | null;
  actions: CommentActions;
  diffStyle: "unified" | "split";
}) {
  return (
    <FileDiff<ReviewComment>
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
      }}
      lineAnnotations={annotations}
      renderAnnotation={(annotation) => annotation.metadata
        ? <ReviewCommentCard
            comment={annotation.metadata}
            focused={annotation.metadata.id === focusedCommentId}
            {...actions}
          />
        : null}
    />
  );
}

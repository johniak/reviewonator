import openAiAgent from "../../skills/reviewonator/agents/openai.yaml" with { type: "text" };
import reviewSchema from "../../skills/reviewonator/references/review-schema.md" with { type: "text" };
import skill from "../../skills/reviewonator/SKILL.md" with { type: "text" };
import alias from "../../skills/rr/SKILL.md" with { type: "text" };
import type { SkillFile } from "./skill";

/** Imported only by src/cli.ts: Bun embeds these files in the compiled executable. */
export const embeddedSkillFiles: SkillFile[] = [
  { path: "SKILL.md", content: skill },
  { path: "references/review-schema.md", content: reviewSchema },
  { path: "agents/openai.yaml", content: openAiAgent },
];

export const embeddedAliasFiles: SkillFile[] = [{ path: "SKILL.md", content: alias }];

import { Chip, Meta } from "../../components/ui";
import { compactContextStates, compactSourceSummary, type CreativeContextCounts } from "@shared/creativeContextStatus";

export function StoryContextStatus({
  counts,
  applied,
  trainingAvailable,
  showSources = false,
  compactStatus,
  nextAction,
  canonSummary,
}: {
  counts: CreativeContextCounts;
  applied: boolean;
  trainingAvailable: boolean;
  showSources?: boolean;
  compactStatus?: string;
  nextAction?: string;
  /** Team Canon 引用摘要（server canonStatusLine；null＝專案沒有引用，不佔版面） */
  canonSummary?: string | null;
}) {
  const states = compactContextStates({ ...counts, applied, trainingAvailable });
  const sources = showSources ? compactSourceSummary(counts) : [];
  if (states.length === 0 && sources.length === 0 && !compactStatus && !canonSummary) return null;
  return (
    <div className="story-context-status" data-fb="專案脈絡狀態">
      {compactStatus ? (
        <Meta as="p" className="story-context-status__compact">{compactStatus}</Meta>
      ) : null}
      {states.length > 0 && (
        <div className="story-context-status__states">
          {states.map((state) => (
            <Chip key={state}>{state}</Chip>
          ))}
        </div>
      )}
      {nextAction ? <Meta as="p" className="story-context-status__next">下一步：{nextAction}</Meta> : null}
      {canonSummary ? <Meta as="p" className="story-context-status__canon">{canonSummary}</Meta> : null}
      {sources.length > 0 && (
        <Meta as="p" className="story-context-status__sources">
          {sources.join(" · ")}
        </Meta>
      )}
    </div>
  );
}

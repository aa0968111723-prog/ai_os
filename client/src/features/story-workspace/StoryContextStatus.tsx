import { Chip, Meta } from "../../components/ui";
import { compactContextStates, compactSourceSummary, type CreativeContextCounts } from "@shared/creativeContextStatus";

export function StoryContextStatus({
  counts,
  applied,
  trainingAvailable,
  showSources = false,
}: {
  counts: CreativeContextCounts;
  applied: boolean;
  trainingAvailable: boolean;
  showSources?: boolean;
}) {
  const states = compactContextStates({ ...counts, applied, trainingAvailable });
  const sources = showSources ? compactSourceSummary(counts) : [];
  if (states.length === 0 && sources.length === 0) return null;
  return (
    <div className="story-context-status" data-fb="專案脈絡狀態">
      {states.length > 0 && (
        <div className="story-context-status__states">
          {states.map((state) => (
            <Chip key={state}>{state}</Chip>
          ))}
        </div>
      )}
      {sources.length > 0 && (
        <Meta as="p" className="story-context-status__sources">
          {sources.join(" · ")}
        </Meta>
      )}
    </div>
  );
}

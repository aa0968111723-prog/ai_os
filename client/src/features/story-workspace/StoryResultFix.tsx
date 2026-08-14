import { useMemo, useState } from "react";
import { Button, Card, Chip, Hint, Meta } from "../../components/ui";
import { defForSection, type StoryInlineSectionId } from "./storyInlineNav";
import {
  FEEDBACK_PRESETS,
  diagnoseFeedback,
  presetOf,
  type FeedbackDiagnosis,
} from "./diagnoseFeedback";

/**
 * Single “哪裡需要修改？” entry. Diagnosis is a proposal only.
 * Apply opens the matching section or asks to regenerate selected shots.
 */
export function StoryResultFix({
  onApplySection,
  onRegenerateShots,
  shotChoices,
}: {
  onApplySection: (section: StoryInlineSectionId | "story") => void;
  onRegenerateShots?: (shotIds: string[]) => void;
  shotChoices?: Array<{ id: string; title: string }>;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [picked, setPicked] = useState<FeedbackDiagnosis | null>(null);
  const [selectedShotIds, setSelectedShotIds] = useState<string[]>([]);

  const diagnoses = useMemo(() => diagnoseFeedback(text), [text]);
  const shown = picked ? [picked] : diagnoses;

  if (!open) {
    return (
      <Button type="button" variant="ghost" className="story-result-fix__entry" onClick={() => setOpen(true)}>
        哪裡需要修改？
      </Button>
    );
  }

  return (
    <Card as="section" className="story-result-fix" data-fb="成果回饋">
      <div className="story-result-fix__head">
        <strong>哪裡需要修改？</strong>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          關閉
        </Button>
      </div>
      <div className="story-result-fix__presets" role="group" aria-label="常見問題">
        {FEEDBACK_PRESETS.map((kind) => {
          const preset = presetOf(kind);
          return (
            <Chip
              key={kind}
              selected={picked?.kind === kind}
              onClick={() => setPicked(preset)}
            >
              {preset.label}
            </Chip>
          );
        })}
      </div>
      <label className="story-result-fix__label" htmlFor="story-result-fix-text">
        或自己描述
      </label>
      <textarea
        id="story-result-fix-text"
        className="story-result-fix__text"
        rows={3}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setPicked(null);
        }}
        placeholder="例如：角色長得不一樣、海灘不像淡水、動作太僵硬"
      />
      {shown.length === 0 ? (
        <Hint>描述問題後會建議可能來源。建議不是修改，要按套用才會打開對應區。</Hint>
      ) : (
        shown.map((d) => (
          <div key={d.kind} className="story-result-fix__proposal">
            <Meta as="p">{d.proposal}</Meta>
            <Button
              type="button"
              size="sm"
              variant="primary"
              onClick={() => {
                if (d.section === "story") {
                  setOpen(false);
                  window.scrollTo({ top: 0 });
                  return;
                }
                onApplySection(d.section);
                setOpen(false);
              }}
            >
              套用建議・打開{d.section === "story" ? "故事" : defForSection(d.section).label}
            </Button>
          </div>
        ))
      )}
      {shotChoices && shotChoices.length > 0 && onRegenerateShots && (
        <div className="story-result-fix__shots">
          <Meta as="p">只重生成這些鏡頭（不會重做整部影片）</Meta>
          <div className="story-result-fix__presets">
            {shotChoices.map((shot) => {
              const on = selectedShotIds.includes(shot.id);
              return (
                <Chip
                  key={shot.id}
                  selected={on}
                  onClick={() =>
                    setSelectedShotIds((prev) =>
                      on ? prev.filter((id) => id !== shot.id) : [...prev, shot.id],
                    )
                  }
                >
                  {shot.title}
                </Chip>
              );
            })}
          </div>
          <Button
            type="button"
            size="sm"
            disabled={selectedShotIds.length === 0}
            onClick={() => onRegenerateShots(selectedShotIds)}
          >
            重生成選取的 {selectedShotIds.length} 鏡
          </Button>
        </div>
      )}
    </Card>
  );
}

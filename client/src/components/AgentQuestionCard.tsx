import { useState } from "react";
import type {
  AgentQuestionAnswer,
  AgentQuestionContext,
  AgentQuestionOption,
  AgentQuestionType,
} from "@shared/agentQuestions";
import { Button, Meta, Pill } from "./ui";

export interface AgentQuestionCardQuestion {
  id: string;
  questionType: AgentQuestionType;
  title: string;
  description: string;
  required: boolean;
  options: AgentQuestionOption[];
  allowCustom: boolean;
  defaultOption?: string | null;
  context: AgentQuestionContext;
}

const SINGLE_TYPES = new Set<AgentQuestionType>([
  "single_select", "entity_picker", "image_choice", "model_choice",
  "asset_picker", "person_picker", "scene_picker", "shot_picker",
]);

export function AgentQuestionCard({
  question,
  submitting = false,
  error,
  onAnswer,
}: {
  question: AgentQuestionCardQuestion;
  submitting?: boolean;
  error?: string | null;
  onAnswer: (answer: AgentQuestionAnswer) => void | Promise<void>;
}) {
  const [selected, setSelected] = useState<string[]>(() => question.defaultOption ? [question.defaultOption] : []);
  const [text, setText] = useState("");

  const toggle = (id: string) => {
    setSelected((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  };

  const optionCards = (multi: boolean) => (
    <div className="agent-question__options" role={multi ? "group" : "radiogroup"} aria-label={question.title}>
      {question.options.map((option) => {
        const checked = selected.includes(option.id);
        return (
          <button
            key={option.id}
            type="button"
            className={`agent-question__option${checked ? " is-selected" : ""}`}
            role={multi ? "checkbox" : "radio"}
            aria-checked={checked}
            disabled={submitting}
            onClick={() => multi ? toggle(option.id) : void onAnswer(option.id)}
          >
            {option.imageUrl ? <img src={option.imageUrl} alt="" /> : null}
            <span className="agent-question__option-copy">
              <span className="agent-question__option-title">
                {option.label}
                {option.recommended ? <Pill status="done">建議</Pill> : null}
              </span>
              {option.description ? <Meta>{option.description}</Meta> : null}
            </span>
          </button>
        );
      })}
      {!question.options.length ? <Meta>目前沒有可用選項；請先補齊相關資料後再繼續。</Meta> : null}
    </div>
  );

  const textInput = (kind: "text" | "number" | "date") => (
    <form
      className="agent-question__form"
      onSubmit={(event) => {
        event.preventDefault();
        if (kind === "number") void onAnswer(Number(text));
        else void onAnswer(text);
      }}
    >
      <input
        type={kind}
        value={text}
        required={question.required}
        disabled={submitting}
        aria-label={question.title}
        onChange={(event) => setText(event.target.value)}
      />
      <Button type="submit" variant="primary" disabled={submitting || (question.required && !text.trim())}>
        {submitting ? "送出中…" : "繼續"}
      </Button>
    </form>
  );

  return (
    <section className="agent-question" aria-labelledby={`agent-question-${question.id}`}>
      <div className="agent-question__eyebrow">Aios 需要你確認</div>
      <h3 id={`agent-question-${question.id}`}>{question.title}</h3>
      <p>{question.description}</p>
      <Meta as="p" className="agent-question__reason">原因：{question.context.reason}</Meta>

      {SINGLE_TYPES.has(question.questionType) ? optionCards(false) : null}
      {question.questionType === "multi_select" ? (
        <>
          {optionCards(true)}
          <Button
            type="button"
            variant="primary"
            disabled={submitting || (question.required && selected.length === 0)}
            onClick={() => void onAnswer(selected)}
          >
            {submitting ? "送出中…" : "使用已選項目"}
          </Button>
        </>
      ) : null}
      {question.questionType === "confirm" ? (
        <div className="agent-question__actions">
          <Button type="button" variant="primary" disabled={submitting} onClick={() => void onAnswer(true)}>確認</Button>
          <Button type="button" disabled={submitting} onClick={() => void onAnswer(false)}>取消</Button>
        </div>
      ) : null}
      {question.questionType === "long_text" ? (
        <form
          className="agent-question__form is-stacked"
          onSubmit={(event) => { event.preventDefault(); void onAnswer(text); }}
        >
          <textarea value={text} required={question.required} disabled={submitting} aria-label={question.title} onChange={(event) => setText(event.target.value)} />
          <Button type="submit" variant="primary" disabled={submitting || (question.required && !text.trim())}>繼續</Button>
        </form>
      ) : null}
      {(question.questionType === "text" || question.questionType === "file") ? textInput("text") : null}
      {question.questionType === "number" ? textInput("number") : null}
      {question.questionType === "date" ? textInput("date") : null}
      {error ? <div className="agent-question__error" role="alert">{error}</div> : null}
    </section>
  );
}

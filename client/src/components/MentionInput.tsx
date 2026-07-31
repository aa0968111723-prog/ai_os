import { useMemo, useRef, useState, type CSSProperties } from "react";
import { trpc } from "../api";
import { Meta } from "./ui";

/**
 * @提及輸入框(留言／筆記／排程共用):打 @ 浮出同組成員名單,選了插入「@名字 」。
 * 送出時由呼叫端用 resolveMentions(value, members) 從內文反推被提及的 userId 陣列。
 * 支援單行(input)與多行(textarea)。名單以 listMemberRoles 取得(排除自己)。
 */
export type MemberLite = { userId: string; name: string; groupRole: string };

/** 從內文反推「還留在文字裡的 @名字」對應的 userId(打了又刪的不算) */
export function resolveMentions(text: string, members: MemberLite[]): string[] {
  return members.filter((m) => text.includes(`@${m.name}`)).map((m) => m.userId);
}

export function useGroupMembers(projectId: string | undefined, myId: string | undefined) {
  const roles = trpc.projects.listMemberRoles.useQuery({ projectId: projectId ?? "" }, { enabled: !!projectId });
  const members = useMemo(
    () => (roles.data?.members ?? []).filter((m) => m.userId !== myId),
    [roles.data, myId],
  );
  return members;
}

export function MentionInput({
  value,
  onChange,
  members,
  multiline,
  placeholder,
  ariaLabel,
  maxLength,
  style,
  onEnter,
}: {
  value: string;
  onChange: (v: string) => void;
  members: MemberLite[];
  multiline?: boolean;
  placeholder?: string;
  ariaLabel?: string;
  maxLength?: number;
  style?: CSSProperties;
  onEnter?: () => void;
}) {
  const ref = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const [query, setQuery] = useState<string | null>(null);

  const candidates = useMemo(() => {
    if (query == null) return [];
    return members.filter((m) => m.name.includes(query)).slice(0, 6);
  }, [query, members]);

  const detect = (v: string, caret: number) => {
    const before = v.slice(0, caret);
    const m = before.match(/@([^\s@]*)$/);
    setQuery(m ? m[1] : null);
  };
  const insert = (name: string) => {
    const el = ref.current;
    const caret = el?.selectionStart ?? value.length;
    const before = value.slice(0, caret).replace(/@[^\s@]*$/, `@${name} `);
    onChange(before + value.slice(caret));
    setQuery(null);
    window.setTimeout(() => el?.focus(), 0);
  };

  const common = {
    ref,
    value,
    "aria-label": ariaLabel,
    maxLength,
    placeholder,
    style,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      onChange(e.target.value);
      detect(e.target.value, e.target.selectionStart ?? e.target.value.length);
    },
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === "Escape") setQuery(null);
      if (e.key === "Enter" && !(e.nativeEvent as unknown as { isComposing: boolean }).isComposing) {
        if (candidates.length && query !== null) {
          e.preventDefault();
          insert(candidates[0].name);
          return;
        }
        if (onEnter && !multiline) onEnter();
      }
    },
  };

  return (
    <span style={{ position: "relative", display: multiline ? "block" : "inline-block", flex: multiline ? undefined : 1 }}>
      {multiline ? <textarea {...common} rows={3} /> : <input {...common} />}
      {query !== null && candidates.length > 0 && (
        <div className="mention-pop" role="listbox" aria-label="提及夥伴">
          {candidates.map((m) => (
            <button key={m.userId} type="button" role="option" aria-selected="false" onClick={() => insert(m.name)}>
              @{m.name}
              <Meta style={{ marginLeft: 6 }}>{m.groupRole === "leader" ? "組長" : ""}</Meta>
            </button>
          ))}
        </div>
      )}
    </span>
  );
}

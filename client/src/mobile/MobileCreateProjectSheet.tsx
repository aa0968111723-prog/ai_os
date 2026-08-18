import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation } from "wouter";
import { trpc } from "../api";
import { Icon } from "../components/Icon";
import { Button, Hint } from "../components/ui";
import { useSheetSwipeDismiss } from "../lib/useSheetSwipeDismiss";
import { DEFAULT_PROJECT_FORMAT, PROJECT_FORMATS, normalizeProjectFormat, type ProjectFormat } from "@shared/models";

/**
 * Phone-safe create-project sheet. Launchpad's desktop modal is not mounted
 * below 768px (PhoneRoute only renders MobileHome), so assistant
 * `aios:new-project-idea` has to land here.
 */
export function MobileCreateProjectSheet({
  groupId,
  initialTitle = "",
  onClose,
}: {
  groupId: string;
  initialTitle?: string;
  onClose: () => void;
}) {
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();
  const sheetRef = useRef<HTMLElement | null>(null);
  useSheetSwipeDismiss(sheetRef, onClose, true);

  const options = trpc.options.byGroup.useQuery({ groupId, includeInactive: true }, { enabled: !!groupId });
  const kindOptions = (options.data ?? []).filter((o) => o.type === "kind" && o.active);
  const platformOptions = (options.data ?? []).filter((o) => o.type === "platform" && o.active);

  const [title, setTitle] = useState(initialTitle);
  const [kind, setKind] = useState("");
  const [platform, setPlatform] = useState("");
  const [format, setFormat] = useState<ProjectFormat>(DEFAULT_PROJECT_FORMAT);

  useEffect(() => {
    if (kindOptions.length && !kindOptions.some((o) => o.value === kind)) setKind(kindOptions[0]!.value);
  }, [kindOptions, kind]);
  useEffect(() => {
    if (platformOptions.length && !platformOptions.some((o) => o.value === platform)) {
      setPlatform(platformOptions[0]!.value);
    }
  }, [platformOptions, platform]);

  const pickedPlatform = platformOptions.find((p) => p.value === platform);
  useEffect(() => {
    if (pickedPlatform?.format) setFormat(normalizeProjectFormat(pickedPlatform.format));
  }, [pickedPlatform?.format]);

  const create = trpc.projects.create.useMutation({
    onSuccess: (project) => {
      void utils.phone.home.invalidate();
      void utils.projects.list.invalidate();
      onClose();
      navigate(`/p/${project.id}`);
    },
  });

  const canCreate = !!title.trim() && !!groupId && !!kind && !!platform && !create.isPending;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <>
      <button type="button" className="menu-surface__scrim" aria-hidden tabIndex={-1} onClick={onClose} />
      <aside className="m-sheet" aria-label="建立新專案" ref={sheetRef}>
        <div className="menu-surface__grip" aria-hidden />
        <div className="m-sheet__head">
          <strong>建立新專案</strong>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="關閉建立專案">
            <Icon name="X" size={16} />
          </Button>
        </div>

        <form
          className="m-create"
          onSubmit={(event) => {
            event.preventDefault();
            if (canCreate) create.mutate({ groupId, title: title.trim(), kind, platform, format });
          }}
        >
          <label htmlFor="m-np-title">專案名稱</label>
          <input
            id="m-np-title"
            value={title}
            autoFocus
            maxLength={80}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="例：淡江禪學社・小華"
          />

          <label htmlFor="m-np-kind">內容類型</label>
          <select id="m-np-kind" value={kind} onChange={(e) => setKind(e.target.value)} disabled={!kindOptions.length}>
            {kindOptions.map((opt) => (
              <option key={opt.id} value={opt.value}>{opt.label}</option>
            ))}
          </select>

          <label htmlFor="m-np-platform">發布平台</label>
          <select
            id="m-np-platform"
            value={platform}
            onChange={(e) => setPlatform(e.target.value)}
            disabled={!platformOptions.length}
          >
            {platformOptions.map((opt) => (
              <option key={opt.id} value={opt.value}>{opt.label}</option>
            ))}
          </select>

          <label htmlFor="m-np-format">畫面尺寸</label>
          <select
            id="m-np-format"
            value={format}
            onChange={(e) => setFormat(normalizeProjectFormat(e.target.value))}
          >
            {PROJECT_FORMATS.map((opt) => (
              <option key={opt.id} value={opt.id}>{opt.id} · {opt.use}</option>
            ))}
          </select>

          {!kindOptions.length && !options.isLoading && (
            <Hint>這個組還沒有內容類型——請組長先加一個，才能建專案。</Hint>
          )}
          {create.error && <p className="error" role="alert">{create.error.message}</p>}

          <div className="m-create__actions">
            <Button type="button" onClick={onClose}>取消</Button>
            <Button variant="primary" type="submit" disabled={!canCreate}>
              {create.isPending ? "建立中…" : "建立專案"}
            </Button>
          </div>
        </form>
      </aside>
    </>,
    document.body,
  );
}

import { useState } from "react";
import { trpc } from "../../api";
import { Icon } from "../../components/Icon";
import { Badge, Button, Card, Meta } from "../../components/ui";

export function LibraryOperations({ groupId, projectId }: {
  groupId: string;
  projectId?: string | null;
}) {
  const [message, setMessage] = useState<string | null>(null);
  const utils = trpc.useUtils();
  const me = trpc.auth.me.useQuery();
  const provider = trpc.intelligence.providerStatus.useQuery(undefined, { staleTime: 60_000 });
  const schedule = trpc.intelligence.scheduleBackfill.useMutation({
    onSuccess: (result) => {
      setMessage(result.scheduled > 0
        ? `已排入 ${result.scheduled} 項，AI 會在背景補齊分析。`
        : result.eligible > 0
          ? "符合條件的資料目前已在排程中。"
          : "目前沒有需要補分析的資料。");
      void utils.intelligence.processing.invalidate();
      void utils.intelligence.summary.invalidate();
    },
  });
  const role = me.data?.groups.find((group) => group.groupId === groupId)?.role;
  const canManage = role === "leader" || role === "admin" || me.data?.user.isSuperAdmin === true;

  if (!canManage) return null;
  return (
    <Card className="processing-panel" data-fb="AI 分析管理">
      <div className="processing-panel__heading">
        <span><Icon name="Sparkles" size={17} /> <strong>AI 分析管理</strong></span>
        <Badge>{provider.data?.externalActive ? "外部多模態已啟用" : "本機安全模式"}</Badge>
      </div>
      <Meta as="p">
        {provider.data?.externalActive
          ? `目前模型：${provider.data.activeModelVersion}`
          : "外部模型預設不會產生成本；啟用後才會分析圖片、語音與影片。"}
      </Meta>
      <div>
        <Button
          size="sm"
          variant="tonal"
          disabled={schedule.isPending}
          onClick={() => {
            setMessage(null);
            schedule.mutate({
              groupId,
              projectId: projectId ?? undefined,
              mode: "model_changed",
              limit: 100,
              dryRun: false,
            });
          }}
        >
          <Icon name="RotateCw" size={14} /> {schedule.isPending ? "正在建立排程…" : "補齊舊資料分析"}
        </Button>
      </div>
      {message && <Meta as="p" role="status">{message}</Meta>}
      {schedule.error && <p className="error" role="alert">建立補分析排程失敗：{schedule.error.message}</p>}
    </Card>
  );
}

import { Link } from "wouter";
import { trpc } from "../api";
import { AnimationStudio } from "../features/animation-studio/AnimationStudio";
import { Icon } from "../components/Icon";
import { SecondaryPageHeader } from "../components/SecondaryPageHeader";
import { AssetImg } from "../components/MediaFallback";
import { EmptyState, Hint, Meta, Skeleton } from "../components/ui";
import { studioProjectIdFromLocation } from "@shared/studioDeepLink";

/**
 * 動畫創作室的路由外殼。
 *
 * 創作室一定屬於某一個專案（分鏡、素材、點數都掛在專案下），所以：
 * - `/studio` → 先挑專案（進來沒有指定時的落點）
 * - `/studio/:projectId` → 直接進那個專案的創作室
 * - `/studio?project=<id>` → 同上（live leftover；route 會導到 canonical path）
 *
 * 挑專案這一段刻意留在頁面層而不是塞進創作室裡：創作室已經是三區塊的重版面，
 * 再多一層「還沒選專案」的空狀態會讓它同時要處理兩種完全不同的畫面。
 *
 * 清單不跟 activeGroupId 走——頂欄晶片可能不是動畫組，動畫組小華
 * （81b265dc-d41c-4ace-ae8f-c05b6debefec）仍必須出現。開案走 projects.get，
 * 不在這頁建立專案。
 */
export function AnimationStudioPage({ groupId, projectId }: { groupId: string; projectId?: string }) {
  const queryProjectId =
    projectId ??
    studioProjectIdFromLocation(
      typeof window === "undefined" ? "" : window.location.pathname,
      typeof window === "undefined" ? "" : window.location.search,
    );
  const resolvedId = queryProjectId ?? undefined;
  const projects = trpc.projects.list.useQuery({});
  const open = trpc.projects.get.useQuery(
    { id: resolvedId! },
    { enabled: Boolean(resolvedId), retry: (count, err) => {
      const code = err.data?.code;
      if (code === "FORBIDDEN" || code === "NOT_FOUND") return false;
      return count < 2;
    } },
  );
  const listed = (projects.data ?? []).slice().sort((a, b) => {
    if (!groupId) return 0;
    const ag = a.groupId === groupId ? 0 : 1;
    const bg = b.groupId === groupId ? 0 : 1;
    return ag - bg;
  });

  if (resolvedId) {
    if (open.isLoading) {
      return (
        <div className="page-shell">
          <Skeleton height={320} />
        </div>
      );
    }
    if (!open.data) {
      return (
        <div className="page-shell secondary-page">
          <EmptyState
            icon={<Icon name="Brush" />}
            title={<>找不到這個專案</>}
            description={<>它可能已被封存，或不屬於你目前所在的組別。</>}
            action={<Link href="/studio">回去挑一個專案</Link>}
          />
        </div>
      );
    }
    return (
      <AnimationStudio
        projectId={open.data.id}
        projectTitle={open.data.title}
        projectFormat={open.data.format}
        canEdit={open.data.myProjectRole !== "viewer" && open.data.status !== "archived"}
      />
    );
  }

  return (
    <div className="page-shell secondary-page">
      <SecondaryPageHeader
        eyebrow="動畫創作室"
        title="先挑一個專案開工"
        icon="Brush"
        badge="手繪白板 × 分鏡表"
        description={
          <>
            在大白板上手繪構圖、逐鏡描稿，右邊的 AI 幫你把畫面變成提示詞與旁白，
            畫好的手稿可以直接存成那一鏡的畫面。手機也能畫——會自動切成輕量版。
          </>
        }
      />
      {projects.isLoading ? (
        <Skeleton height={160} />
      ) : listed.length ? (
        <ul className="studio-picker">
          {listed.map((project) => (
            <li key={project.id}>
              <Link href={`/studio/${project.id}`} className="studio-picker__item">
                <span className="studio-picker__cover">
                  {project.coverUrl ? (
                    <AssetImg src={project.coverUrl} alt="" fallbackLabel="封面遺失" fallbackHeight={64} fallbackIconSize={14} />
                  ) : (
                    <Icon name="Clapperboard" size={18} />
                  )}
                </span>
                <span className="studio-picker__text">
                  <b>{project.title}</b>
                  <Meta as="small">{project.format}・{project.kind}</Meta>
                </span>
                <Icon name="ChevronRight" size={16} />
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          icon={<Icon name="Clapperboard" />}
          title={<>還沒有可以開的專案</>}
          description={<>創作室的分鏡與素材都掛在專案底下，先到今日工作台開一個專案再回來。</>}
          action={<Link href="/dashboard">去今日工作台</Link>}
        />
      )}
      <Hint>手稿在存成分鏡畫面之前只留在這台裝置上——換手機或換電腦看不到未存的草稿。</Hint>
    </div>
  );
}

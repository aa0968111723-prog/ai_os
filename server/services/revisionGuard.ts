/**
 * 樂觀併發的伺服器端機制（契約與純函式在 shared/revision.ts）。
 *
 * 這支服務只做一件事：把「讀 → 改 → 寫」這個天生會互相覆蓋的形狀，換成一次
 * `UPDATE ... SET ..., rev = rev + 1 WHERE id = ? AND rev = ?` 的條件寫入，
 * 並在條件沒中時**先嘗試逐欄合併、再決定要不要打擾使用者**。
 *
 * 為什麼條件要下在 UPDATE 本身而不是「先 SELECT 比一下 rev 再 UPDATE」：
 * 後者兩個語句之間仍有空窗，兩個請求可以雙雙讀到 rev=3、雙雙認為自己安全、雙雙寫入。
 * 條件寫入把比對與寫入壓進同一個語句，由資料庫的列鎖保證互斥——這是唯一不需要
 * 額外交易隔離等級就正確的做法。
 */
import { TRPCError } from "@trpc/server";
import { and, eq, inArray, sql, type SQL } from "drizzle-orm";
import type { PgTable, PgColumn } from "drizzle-orm/pg-core";
import { classifyRevisionPatch, type RevisionConflict, type RevisionEntity } from "../../shared/revision";
import { db, schema } from "../db";

/**
 * 帶結構化 payload 的衝突錯誤。`cause` 走 tRPC 的 errorFormatter 掛進 `data.conflict`
 * （見 server/trpc.ts）——前端拿得到「誰改的、改成什麼、哪幾欄撞了」，
 * 才有辦法畫出「查看新版／重新套用我的修改」而不是一句「儲存失敗」。
 */
export class RevisionConflictError extends Error {
  readonly conflict: RevisionConflict;
  constructor(conflict: RevisionConflict) {
    super("REVISION_CONFLICT");
    this.name = "RevisionConflictError";
    this.conflict = conflict;
  }
}

export function isRevisionConflictError(err: unknown): err is RevisionConflictError {
  return err instanceof RevisionConflictError;
}

/** 把衝突包成 tRPC 的 CONFLICT（cause 保留結構化 payload 供 errorFormatter 取用） */
export function revisionConflictTrpcError(conflict: RevisionConflict): TRPCError {
  return new TRPCError({
    code: "CONFLICT",
    message: "夥伴剛剛更新了這筆資料",
    cause: new RevisionConflictError(conflict),
  });
}

export interface ApplyRevisionArgs<TRow extends { id: string; rev: number }> {
  entity: RevisionEntity;
  table: PgTable;
  idColumn: PgColumn;
  revColumn: PgColumn;
  row: TRow;
  /** 只含使用者真的改了的欄位（drizzle 欄位名）。空物件＝沒事可做，直接回原列。 */
  patch: Record<string, unknown>;
  /**
   * 每次都要寫、但**不參與衝突判定**的記帳欄（updatedBy / updatedAt 這類）。
   *
   * 它們必須跟 patch 分開：這些欄位在每一次寫入都會變，若混進 patch，
   * 逐欄比對會看到「baseline 沒有它、現值又跟我的不同」而永遠判成 contested——
   * 於是只要有人碰過這一列，之後每一次儲存都會跳衝突卡，機制當天就會被關掉。
   */
  bookkeeping?: Record<string, unknown>;
  /** 呼叫端載入時看到的 rev；undefined＝舊客戶端／背景路徑，跳過併發檢查（仍會 rev+1） */
  expectedRev?: number;
  /** 呼叫端載入時，patch 涵蓋欄位的原值。缺席時衝突一律不可合併（保守）。 */
  baseline?: Record<string, unknown> | null;
  /** 額外的 WHERE（例如 isNull(deletedAt)）——避免寫進剛被刪掉的列 */
  extraWhere?: SQL | undefined;
  /** 重讀現值（衝突時要回給前端看）。給了才有 currentData，否則回空物件。 */
  reload: () => Promise<TRow | undefined>;
  /** 現值裡「最後是誰改的」欄位名（例如 stories.updatedBy）——查得到就把名字帶進衝突卡 */
  updatedByField?: keyof TRow & string;
  updatedAtField?: keyof TRow & string;
}

export interface ApplyRevisionResult<TRow> {
  row: TRow;
  /**
   * true＝rev 撞了，但逐欄比對後確認兩份修改互不相干，已自動合併落地。
   * 呼叫端可據此回報給前端（讓 UI 說「已與夥伴的修改合併」而不是靜悄悄成功）。
   */
  merged: boolean;
}

/**
 * 條件更新。回傳更新後的列；rev 撞了且無法合併時丟 RevisionConflictError。
 *
 * 合併路徑（rev 不符但欄位不衝突）會**重新以現在的 rev 再試一次**，而不是無條件寫入——
 * 否則合併本身就是另一個沒有併發保護的寫入，第三個人在這中間插進來照樣被吃掉。
 * 重試上限 3 次：撞第 4 次代表這一格正被高頻寫入，此時讓使用者知道比默默重試更誠實。
 */
export async function applyWithRevision<TRow extends { id: string; rev: number }>(
  args: ApplyRevisionArgs<TRow>,
): Promise<ApplyRevisionResult<TRow>> {
  const { table, idColumn, revColumn, patch, bookkeeping, extraWhere, reload } = args;
  if (Object.keys(patch).length === 0) return { row: args.row, merged: false };

  let expected = args.expectedRev;
  let current = args.row;
  let merged = false;

  for (let attempt = 0; attempt < 3; attempt++) {
    // expectedRev 未給＝舊行為：不做併發判定，但 rev 仍要遞增，
    // 否則有帶 expectedRev 的呼叫端會拿著一個永遠不動的數字，防護等於沒開。
    const where =
      expected === undefined
        ? and(eq(idColumn, current.id), extraWhere)
        : and(eq(idColumn, current.id), eq(revColumn, expected), extraWhere);

    const [updated] = await db
      .update(table)
      .set({ ...patch, ...bookkeeping, rev: sql`${revColumn} + 1` })
      .where(where)
      .returning();

    if (updated) return { row: updated as TRow, merged };

    // 0 列：要嘛列不見了（被刪），要嘛 rev 已經前進。重讀後才知道是哪一種。
    const fresh = await reload();
    if (!fresh) {
      throw new TRPCError({ code: "NOT_FOUND", message: "這筆資料剛被夥伴刪除了，你剛才的修改沒有存進去" });
    }

    const plan = classifyRevisionPatch(patch, args.baseline, fresh as unknown as Record<string, unknown>);
    if (plan.contested.length > 0) {
      throw new RevisionConflictError(await buildConflict(args, fresh, expected ?? fresh.rev, plan.contested, plan.mergeable));
    }
    if (plan.mergeable.length === 0) {
      // 我要改的每一欄，別人都已經改成跟我一樣了——這次儲存沒有任何要寫的東西，
      // 直接把新版當結果回去。使用者看到的內容與他打的一致，不需要被打擾。
      return { row: fresh, merged: true };
    }

    // 可合併：以新版的 rev 再試一次，且只送真的還需要寫的欄位。
    expected = fresh.rev;
    current = fresh;
    merged = true;
    for (const field of [...plan.noop]) delete patch[field];
  }

  const fresh = (await reload()) ?? current;
  throw new RevisionConflictError(await buildConflict(args, fresh, expected ?? fresh.rev, Object.keys(patch), []));
}

async function buildConflict<TRow extends { id: string; rev: number }>(
  args: ApplyRevisionArgs<TRow>,
  fresh: TRow,
  expectedRev: number,
  contestedFields: string[],
  mergeableFields: string[],
): Promise<RevisionConflict> {
  return {
    reason: "REVISION_CONFLICT",
    entity: args.entity,
    entityId: fresh.id,
    expectedRev,
    currentRev: fresh.rev,
    currentData: fresh as unknown as Record<string, unknown>,
    contestedFields,
    mergeableFields,
    updatedBy: await resolveActor(args, fresh),
    updatedAt: readInstant(args.updatedAtField ? fresh[args.updatedAtField] : undefined),
  };
}

/** 「是誰改的」：只有現值裡帶得出 userId 才查名字；查不到就回 null（前端說「有夥伴」） */
async function resolveActor<TRow extends { id: string; rev: number }>(
  args: ApplyRevisionArgs<TRow>,
  fresh: TRow,
): Promise<{ userId: string; name: string } | null> {
  const field = args.updatedByField;
  if (!field) return null;
  const userId = fresh[field];
  if (typeof userId !== "string" || userId.length === 0) return null;
  try {
    const [user] = await db
      .select({ id: schema.users.id, name: schema.users.name })
      .from(schema.users)
      .where(eq(schema.users.id, userId));
    return user ? { userId: user.id, name: user.name } : null;
  } catch {
    // 名字查不到不該讓整個衝突流程失敗——沒有名字的衝突卡仍然比「儲存失敗」有用
    return null;
  }
}

function readInstant(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  return null;
}

/** 批次補名字（收件匣／協作中心用）——與衝突無關，但共用同一條「查不到就略過」的規則 */
export async function namesByUserId(userIds: string[]): Promise<Map<string, string>> {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({ id: schema.users.id, name: schema.users.name })
    .from(schema.users)
    .where(inArray(schema.users.id, ids));
  return new Map(rows.map((r) => [r.id, r.name]));
}

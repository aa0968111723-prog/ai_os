import { sql } from "drizzle-orm";
import { db } from "../db";

export type AgentDbIntegritySeverity = "critical" | "warning";

export interface AgentDbIntegrityViolation {
  code: string;
  severity: AgentDbIntegritySeverity;
  entityId: string;
  detail: string;
}

export interface AgentDbIntegrityReport {
  ok: boolean;
  checkedAt: string;
  criticalCount: number;
  warningCount: number;
  violations: AgentDbIntegrityViolation[];
}

let cachedReport: AgentDbIntegrityReport | undefined;

/**
 * Read-only corruption/invariant scanner for the durable Agent DB surface.
 * It deliberately joins receipts through authoritative run ownership and
 * checks cross-project bindings rather than trusting JSON result claims.
 * The result is bounded so readiness and operators cannot accidentally turn
 * data corruption into an unbounded telemetry payload.
 */
export async function runAgentDbIntegrityScan(staleMinutes = 15): Promise<AgentDbIntegrityReport> {
  const result = await db.execute<{ code: string; severity: AgentDbIntegritySeverity; entity_id: string; detail: string }>(sql`
    with violations as (
      select 'RECEIPT_ORPHAN_RUN'::text code, 'critical'::text severity,
             tr.id::text entity_id, 'receipt run_id has no agent_runs row'::text detail
      from agent_tool_receipts tr
      left join agent_runs r on r.id = tr.run_id
      where r.id is null

      union all
      select 'RUN_PROJECT_SCOPE_MISMATCH', 'critical', r.id::text,
             'run project is missing or belongs to a different group'
      from agent_runs r left join projects p on p.id = r.project_id
      where p.id is null or p.group_id <> r.group_id

      union all
      select 'RECEIPT_OWNER_SCOPE_MISMATCH', 'critical', tr.id::text,
             'receipt owner columns are missing or differ from its authoritative run'
      from agent_tool_receipts tr
      join agent_runs r on r.id = tr.run_id
      where tr.user_id is null or tr.group_id is null or tr.project_id is null
         or tr.user_id <> r.user_id or tr.group_id <> r.group_id or tr.project_id <> r.project_id

      union all
      select 'VERIFIED_RECEIPT_MISSING_EVIDENCE', 'critical', tr.id::text,
             'verified receipt is missing result or verified_at'
      from agent_tool_receipts tr
      where tr.status = 'verified'
        and (tr.result is null or tr.verified_at is null)

      union all
      select 'INVALID_RECEIPT_SETTLEMENT', 'critical', tr.id::text,
             'settled receipt is not verified or has invalid actual_points'
      from agent_tool_receipts tr
      where tr.settled = true
        and (tr.status <> 'verified' or tr.actual_points is null or tr.actual_points < 0)

      union all
      select 'SETTLED_RECEIPT_POINT_MISMATCH', 'critical', tr.id::text,
             'settled receipt column does not match its verified result points'
      from agent_tool_receipts tr
      where tr.settled = true and tr.result is not null
        and coalesce(tr.result->>'actualPoints', '') ~ '^[0-9]+$'
        and tr.actual_points <> (tr.result->>'actualPoints')::integer

      union all
      select 'STALE_VERIFIED_UNSETTLED_RECEIPT', 'critical', tr.id::text,
             'verified paid receipt remained unsettled beyond reconciliation window'
      from agent_tool_receipts tr
      where tr.status = 'verified' and tr.settled = false and tr.reserved_points > 0
        and tr.verified_at < now() - (${staleMinutes} * interval '1 minute')

      union all
      select 'DONE_RUN_UNVERIFIED_REQUIRED_STEP', 'critical', r.id::text,
             'done run contains a required tool step without a verified completed result'
      from agent_runs r
      where r.status = 'done' and exists (
        select 1 from jsonb_array_elements(r.steps) step
        where step ? 'toolId'
          and (step->>'status' <> 'completed' or coalesce(step->'verifiedResult'->>'verified', 'false') <> 'true')
      )

      union all
      select 'TERMINAL_RUN_PENDING_QUESTION', 'critical', q.id::text,
             concat('question pending on terminal run ', r.id::text)
      from agent_questions q
      join agent_runs r on r.id = q.run_id
      where q.status = 'pending' and r.status in ('done','failed','stopped','discarded')

      union all
      select 'AGENT_EVENT_ORPHAN_RUN', 'critical', e.id::text,
             'agent event has no owning run'
      from agent_events e left join agent_runs r on r.id = e.run_id
      where r.id is null

      union all
      select 'AGENT_QUESTION_ORPHAN_RUN', 'critical', q.id::text,
             'agent question has no owning run'
      from agent_questions q left join agent_runs r on r.id = q.run_id
      where r.id is null

      union all
      select 'STALE_ACTIVE_RUN', 'warning', r.id::text,
             concat('active run unchanged since ', r.updated_at::text)
      from agent_runs r
      where r.status in ('running','waiting','waiting_user_input','waiting_confirmation','waiting_permission')
        and r.updated_at < now() - (${staleMinutes} * interval '1 minute')

      union all
      select 'DUPLICATE_LOGICAL_RECEIPT', 'critical', min(tr.id::text),
             concat('duplicate run/step/tool/effect count=', count(*)::text)
      from agent_tool_receipts tr
      where tr.effect_fingerprint is not null
      group by tr.run_id, tr.step_id, tr.tool_id, tr.effect_fingerprint
      having count(*) > 1

      union all
      select 'SHOT_BINDING_PROJECT_MISMATCH', 'critical', b.id::text,
             'shot binding target is missing or belongs to another project'
      from context_bindings b
      left join scenes s on b.scope_type = 'shot' and s.id = b.scope_id
      where b.scope_type = 'shot' and (s.id is null or s.project_id <> b.project_id)

      union all
      select 'SCENE_BINDING_PROJECT_MISMATCH', 'critical', b.id::text,
             'scene binding target is missing or belongs to another project'
      from context_bindings b
      left join story_scenes s on b.scope_type = 'scene' and s.id = b.scope_id
      where b.scope_type = 'scene' and (s.id is null or s.project_id <> b.project_id)

      union all
      select 'ASSET_BINDING_GROUP_MISMATCH', 'critical', b.id::text,
             'asset binding carrier is missing or belongs to another group'
      from context_bindings b
      left join assets a on b.resource_kind = 'asset' and a.id = b.resource_id
      where b.resource_kind = 'asset' and (a.id is null or a.group_id <> b.group_id)

      union all
      select 'LIBRARY_USAGE_SCOPE_MISMATCH', 'critical', u.id::text,
             'library usage group does not match project/resource group'
      from library_resource_usages u
      left join projects p on p.id = u.project_id
      left join library_resources lr on lr.id = u.library_resource_id
      where p.id is null or lr.id is null or p.group_id <> u.group_id or lr.group_id <> u.group_id

      union all
      select 'SECRET_CANARY_IN_RECEIPT', 'critical', tr.id::text,
             'receipt result resembles a persisted credential'
      from agent_tool_receipts tr
      where coalesce(tr.result::text, '') ~* '(AIOS_CERT_SECRET_|sk-[A-Za-z0-9_-]{16,}|bearer[[:space:]]+[A-Za-z0-9._-]{16,}|password["'']?[[:space:]]*[:=])'
    )
    select code, severity, entity_id, detail
    from violations
    order by case severity when 'critical' then 0 else 1 end, code, entity_id
    limit 500
  `);
  const violations = result.rows.map((row) => ({
    code: row.code,
    severity: row.severity,
    entityId: row.entity_id,
    detail: row.detail,
  }));
  const criticalCount = violations.filter((item) => item.severity === "critical").length;
  const warningCount = violations.length - criticalCount;
  const report = { ok: criticalCount === 0, checkedAt: new Date().toISOString(), criticalCount, warningCount, violations };
  cachedReport = report;
  return report;
}

export async function getCachedAgentDbIntegrityScan(maxAgeMs = 30_000): Promise<AgentDbIntegrityReport> {
  if (cachedReport && Date.now() - Date.parse(cachedReport.checkedAt) <= maxAgeMs) return cachedReport;
  return runAgentDbIntegrityScan();
}

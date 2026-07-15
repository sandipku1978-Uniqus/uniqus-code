import type { IncomingMessage, ServerResponse } from "node:http";
import { roleAtLeast, type Role } from "@gate15/api-types";
import { audit } from "./db/audit.js";
import * as members from "./db/members.js";
import * as comments from "./db/comments.js";
import * as tasks from "./db/agentTasks.js";
import * as flows from "./db/flows.js";
import { listOrgProjects } from "./db/projects.js";
import { orgMonthToDateSpendUsd, startOfMonthIso } from "./db/usage.js";
import type { FlowStep, OrgUsageSummary } from "@gate15/api-types";

const MAX_ORG_NAME = 60;
const MAX_EMAIL = 320;
const MAX_COMMENT_BODY = 20_000;
const MAX_COMMENT_TARGET = 2_000;
const MAX_TASK_TITLE = 200;
const MAX_TASK_PROMPT = 100_000;
const MAX_TASK_BRANCH = 255;
const MAX_TASK_ACCEPTANCE = 20_000;
const MAX_FLOW_NAME = 120;
const MAX_FLOW_DESCRIPTION = 2_000;
const MAX_FLOW_START_PATH = 2_000;
const MAX_FLOW_STEPS = 100;
const MAX_FLOW_STEPS_JSON = 100_000;

/**
 * Collaboration, org/RBAC, comments, and durable-task routes (P3.1/P3.2/P3.4/
 * P3.5/P8.1). Kept out of server.ts so its giant router only gains a single
 * dispatch line; `json`/`readJsonBody` are passed in to reuse server.ts's exact
 * response + body helpers.
 *
 * Access is membership-aware (`members.getProjectRole`). Personal-project
 * owners retain implicit ownership; organization projects derive authority
 * only from current org/project membership. A handler returns `true` once it
 * has written a response; `false` means "not my route, keep going".
 */

export interface CollabDeps {
  json: (res: ServerResponse, status: number, body: unknown) => void;
  readJsonBody: <T>(req: IncomingMessage) => Promise<T>;
  onProjectAuthorizationChanged?: (projectId: string, userId: string) => void | Promise<void>;
  /** Explicitly false when this instance cannot drain newly queued tasks. */
  taskWorkerEnabled?: boolean;
  onTaskCanceled?: (taskId: string) => void | Promise<void>;
}

interface SessionUser {
  id: string;
  account_type?: string | null;
}

const VALID_ROLES: Role[] = ["owner", "admin", "editor", "viewer"];
const asRole = (v: unknown): Role | null => (typeof v === "string" && (VALID_ROLES as string[]).includes(v) ? (v as Role) : null);

export async function handleCollabRoute(
  req: IncomingMessage,
  res: ServerResponse,
  user: SessionUser,
  deps: CollabDeps,
): Promise<boolean> {
  const url = (req.url ?? "").split("?")[0];
  const method = req.method ?? "GET";
  const { json, readJsonBody } = deps;
  const notifyProjectAuthorizationChanged = async (projectId: string, userId: string): Promise<void> => {
    await deps.onProjectAuthorizationChanged?.(projectId, userId);
  };
  const notifyOrgAuthorizationChanged = async (orgId: string, userId: string): Promise<void> => {
    const projects = await listOrgProjects(orgId);
    await Promise.all(projects.map((project) => notifyProjectAuthorizationChanged(project.id, userId)));
  };

  // Resolve the caller's project role once; 403 if they need at least `min`.
  const requireProjectRole = async (projectId: string, min: Role): Promise<Role | null> => {
    const role = await members.getProjectRole(projectId, user.id);
    if (!roleAtLeast(role, min)) {
      json(res, role ? 403 : 404, { error: role ? "insufficient role" : "project not found" });
      return null;
    }
    return role;
  };

  // ── Project members (P3.2) ───────────────────────────────────────────────
  const pm = url.match(/^\/api\/projects\/([0-9a-fA-F-]{8,})\/members(?:\/([0-9a-fA-F-]{8,}))?$/);
  if (pm) {
    const projectId = pm[1];
    const targetUserId = pm[2];
    if (method === "GET" && !targetUserId) {
      if (!(await requireProjectRole(projectId, "viewer"))) return true;
      json(res, 200, { members: await members.listProjectMembers(projectId) });
      return true;
    }
    if (method === "POST" && !targetUserId) {
      const callerRole = await requireProjectRole(projectId, "admin");
      if (!callerRole) return true;
      const body = await readJsonBody<{ email?: string; role?: string }>(req);
      const role = asRole(body.role) ?? "editor";
      // Prevent privilege escalation: you can never grant a role above your own
      // (so an admin can't mint an owner). Only an owner can create an owner.
      if (!roleAtLeast(callerRole, role)) {
        return (json(res, 403, { error: `cannot grant a role higher than your own (${callerRole})` }), true);
      }
      const email = (body.email ?? "").trim();
      if (!email) return (json(res, 400, { error: "email is required" }), true);
      if (email.length > MAX_EMAIL) {
        return (json(res, 400, { error: `email must be ${MAX_EMAIL} chars or fewer` }), true);
      }
      const r = await members.addProjectMemberByEmail(projectId, email, role);
      if (!r.ok) {
        return (
          json(res, r.reason === "no_user" ? 404 : r.reason === "exists" ? 409 : 500, {
            error:
              r.reason === "no_user"
                ? "no Gate 15 account with that email"
                : r.reason === "exists"
                  ? "that account is already a project member; change its role instead"
                  : r.message ?? "failed",
          }),
          true
        );
      }
      void audit({ project_id: projectId, user_id: user.id, kind: "member_invite", target: email, metadata: { role } });
      json(res, 200, { member: r.member });
      return true;
    }
    if (method === "PATCH" && targetUserId) {
      const callerRole = await requireProjectRole(projectId, "admin");
      if (!callerRole) return true;
      const body = await readJsonBody<{ role?: string }>(req);
      const role = asRole(body.role);
      if (!role) return (json(res, 400, { error: "valid role required" }), true);
      if (!roleAtLeast(callerRole, role)) {
        return (json(res, 403, { error: `cannot grant a role higher than your own (${callerRole})` }), true);
      }
      const targetRole = await members.getDirectProjectMemberRole(projectId, targetUserId);
      if (!targetRole) return (json(res, 404, { error: "project member not found" }), true);
      if (targetRole === "owner" && callerRole !== "owner") {
        return (json(res, 403, { error: "only an owner can change an owner's role" }), true);
      }
      if (
        targetRole === "owner" &&
        role !== "owner" &&
        (await members.countDirectProjectOwners(projectId)) <= 1
      ) {
        return (json(res, 409, { error: "cannot demote the project's last owner" }), true);
      }
      await members.setProjectMemberRole(projectId, targetUserId, role);
      await notifyProjectAuthorizationChanged(projectId, targetUserId);
      void audit({ project_id: projectId, user_id: user.id, kind: "role_change", target: targetUserId, metadata: { role } });
      json(res, 200, { ok: true });
      return true;
    }
    if (method === "DELETE" && targetUserId) {
      const callerRole = await requireProjectRole(projectId, "admin");
      if (!callerRole) return true;
      const targetRole = await members.getDirectProjectMemberRole(projectId, targetUserId);
      if (!targetRole) return (json(res, 404, { error: "project member not found" }), true);
      if (targetRole === "owner" && callerRole !== "owner") {
        return (json(res, 403, { error: "only an owner can remove an owner" }), true);
      }
      if (targetRole === "owner" && (await members.countDirectProjectOwners(projectId)) <= 1) {
        return (json(res, 409, { error: "cannot remove the project's last owner" }), true);
      }
      await members.removeProjectMember(projectId, targetUserId);
      await notifyProjectAuthorizationChanged(projectId, targetUserId);
      void audit({ project_id: projectId, user_id: user.id, kind: "member_remove", target: targetUserId, metadata: null });
      json(res, 200, { ok: true });
      return true;
    }
  }

  // ── Comments (P3.4) ──────────────────────────────────────────────────────
  const cm = url.match(/^\/api\/projects\/([0-9a-fA-F-]{8,})\/comments(?:\/([0-9a-fA-F-]{8,}))?$/);
  if (cm) {
    const projectId = cm[1];
    const commentId = cm[2];
    if (method === "GET" && !commentId) {
      if (!(await requireProjectRole(projectId, "viewer"))) return true;
      json(res, 200, { comments: await comments.listComments(projectId) });
      return true;
    }
    if (method === "POST" && !commentId) {
      if (!(await requireProjectRole(projectId, "editor"))) return true;
      const body = await readJsonBody<{ target_kind?: string; target_ref?: string; body?: string }>(req);
      const kinds = ["element", "file", "checkpoint", "pr", "general"];
      const targetKind = kinds.includes(body.target_kind ?? "") ? (body.target_kind as never) : "general";
      const text = (body.body ?? "").trim();
      if (!text) return (json(res, 400, { error: "body is required" }), true);
      if (text.length > MAX_COMMENT_BODY) {
        return (json(res, 400, { error: `body must be ${MAX_COMMENT_BODY} chars or fewer` }), true);
      }
      if (typeof body.target_ref === "string" && body.target_ref.length > MAX_COMMENT_TARGET) {
        return (json(res, 400, { error: `target_ref must be ${MAX_COMMENT_TARGET} chars or fewer` }), true);
      }
      const comment = await comments.createComment({
        projectId,
        userId: user.id,
        targetKind,
        targetRef: body.target_ref ?? null,
        body: text,
      });
      json(res, 200, { comment });
      return true;
    }
    if (method === "PATCH" && commentId) {
      if (!(await requireProjectRole(projectId, "editor"))) return true;
      const body = await readJsonBody<{ resolved?: boolean }>(req);
      await comments.setCommentResolved(commentId, projectId, body.resolved !== false);
      json(res, 200, { ok: true });
      return true;
    }
  }

  // ── Durable agent tasks (P8.1) ───────────────────────────────────────────
  const tm = url.match(/^\/api\/projects\/([0-9a-fA-F-]{8,})\/tasks(?:\/([0-9a-fA-F-]{8,}))?$/);
  if (tm) {
    const projectId = tm[1];
    const taskId = tm[2];
    if (method === "GET" && !taskId) {
      if (!(await requireProjectRole(projectId, "viewer"))) return true;
      json(res, 200, {
        tasks: await tasks.listAgentTasks(projectId),
        task_worker_enabled: deps.taskWorkerEnabled !== false,
      });
      return true;
    }
    if (method === "POST" && !taskId) {
      if (!(await requireProjectRole(projectId, "editor"))) return true;
      if (deps.taskWorkerEnabled === false) {
        return (
          json(res, 503, {
            error: "agent tasks are unavailable until the task worker is enabled",
          }),
          true
        );
      }
      const body = await readJsonBody<{ title?: string; prompt?: string; branch?: string; acceptance_criteria?: string }>(req);
      const title = (body.title ?? "").trim();
      const prompt = (body.prompt ?? "").trim();
      if (!title || !prompt) return (json(res, 400, { error: "title and prompt are required" }), true);
      if (title.length > MAX_TASK_TITLE) {
        return (json(res, 400, { error: `title must be ${MAX_TASK_TITLE} chars or fewer` }), true);
      }
      if (prompt.length > MAX_TASK_PROMPT) {
        return (json(res, 400, { error: `prompt must be ${MAX_TASK_PROMPT} chars or fewer` }), true);
      }
      if (typeof body.branch === "string" && body.branch.length > MAX_TASK_BRANCH) {
        return (json(res, 400, { error: `branch must be ${MAX_TASK_BRANCH} chars or fewer` }), true);
      }
      if (
        typeof body.acceptance_criteria === "string" &&
        body.acceptance_criteria.length > MAX_TASK_ACCEPTANCE
      ) {
        return (
          json(res, 400, { error: `acceptance_criteria must be ${MAX_TASK_ACCEPTANCE} chars or fewer` }),
          true
        );
      }
      const task = await tasks.createAgentTask({
        projectId,
        createdBy: user.id,
        title,
        prompt,
        branch: body.branch ?? null,
        acceptanceCriteria: body.acceptance_criteria ?? null,
      });
      json(res, 200, { task });
      return true;
    }
    if (method === "PATCH" && taskId) {
      if (!(await requireProjectRole(projectId, "editor"))) return true;
      const body = await readJsonBody<{ status?: string }>(req);
      if (body.status === "canceled") {
        // Scope the cancel to this project: updateAgentTask filters by task id
        // only, so without this an editor on project A could cancel project B's
        // task by id. Mirrors setCommentResolved's project scoping above.
        const task = await tasks.getAgentTask(taskId);
        if (!task || task.project_id !== projectId) {
          return (json(res, 404, { error: "task not found" }), true);
        }
        const canceled = await tasks.cancelAgentTask(taskId, projectId);
        if (!canceled) {
          return (json(res, 409, { error: "task has already finished" }), true);
        }
        await deps.onTaskCanceled?.(taskId);
        return (json(res, 200, { ok: true }), true);
      }
      return (json(res, 400, { error: "only status:canceled is accepted here" }), true);
    }
  }

  // ── Saved smoke-flows (P2.4) ─────────────────────────────────────────────
  // CRUD only; the live-streaming `/flows/:id/run` replay is handled in
  // server.ts (it needs the sandbox + broadcast plumbing). The regex's trailing
  // `$` means `/flows/<id>/run` falls through to there rather than matching here.
  const fm = url.match(/^\/api\/projects\/([0-9a-fA-F-]{8,})\/flows(?:\/([0-9a-fA-F-]{8,}))?$/);
  if (fm) {
    const projectId = fm[1];
    const flowId = fm[2];
    if (method === "GET" && !flowId) {
      if (!(await requireProjectRole(projectId, "viewer"))) return true;
      json(res, 200, { flows: await flows.listFlows(projectId) });
      return true;
    }
    if (method === "POST" && !flowId) {
      if (!(await requireProjectRole(projectId, "editor"))) return true;
      const body = await readJsonBody<{
        name?: string;
        description?: string;
        steps?: FlowStep[];
        start_path?: string;
      }>(req);
      const name = (body.name ?? "").trim();
      if (!name) return (json(res, 400, { error: "name is required" }), true);
      if (name.length > MAX_FLOW_NAME) {
        return (json(res, 400, { error: `name must be ${MAX_FLOW_NAME} chars or fewer` }), true);
      }
      if (!Array.isArray(body.steps) || body.steps.length === 0) {
        return (json(res, 400, { error: "steps must be a non-empty array" }), true);
      }
      if (body.steps.length > MAX_FLOW_STEPS || JSON.stringify(body.steps).length > MAX_FLOW_STEPS_JSON) {
        return (
          json(res, 400, {
            error: `steps must contain at most ${MAX_FLOW_STEPS} entries and ${MAX_FLOW_STEPS_JSON} serialized chars`,
          }),
          true
        );
      }
      if (typeof body.description === "string" && body.description.length > MAX_FLOW_DESCRIPTION) {
        return (json(res, 400, { error: `description must be ${MAX_FLOW_DESCRIPTION} chars or fewer` }), true);
      }
      if (typeof body.start_path === "string" && body.start_path.length > MAX_FLOW_START_PATH) {
        return (json(res, 400, { error: `start_path must be ${MAX_FLOW_START_PATH} chars or fewer` }), true);
      }
      const flow = await flows.upsertFlow({
        projectId,
        createdBy: user.id,
        name,
        description: body.description ?? null,
        steps: body.steps,
        startPath: body.start_path ?? null,
      });
      json(res, 200, { flow });
      return true;
    }
    if (method === "DELETE" && flowId) {
      if (!(await requireProjectRole(projectId, "editor"))) return true;
      await flows.deleteFlow(projectId, flowId);
      json(res, 200, { ok: true });
      return true;
    }
  }

  // ── Organizations (P3.1 / P3.5) ──────────────────────────────────────────
  if (url === "/api/orgs") {
    if (method === "GET") {
      json(res, 200, { orgs: await members.listOrganizationsForUser(user.id) });
      return true;
    }
    if (method === "POST") {
      const body = await readJsonBody<{ name?: string }>(req);
      const name = (body.name ?? "").trim();
      if (!name) return (json(res, 400, { error: "name is required" }), true);
      if (name.length > MAX_ORG_NAME) {
        return (json(res, 400, { error: `name must be ${MAX_ORG_NAME} chars or fewer` }), true);
      }
      const org = await members.createOrganization(name, user.id);
      void audit({ project_id: null, user_id: user.id, kind: "org_create", target: org.id, metadata: { name } });
      json(res, 200, { org });
      return true;
    }
  }

  // ── Single org: detail / rename / delete (P3.1) ──────────────────────────
  const orgIdM = url.match(/^\/api\/orgs\/([0-9a-fA-F-]{8,})$/);
  if (orgIdM) {
    const orgId = orgIdM[1];
    const role = await members.getOrgRole(orgId, user.id);
    if (method === "GET") {
      if (!role) return (json(res, 404, { error: "org not found" }), true);
      const org = await members.getOrganization(orgId);
      if (!org) return (json(res, 404, { error: "org not found" }), true);
      json(res, 200, { org, role });
      return true;
    }
    if (method === "PATCH") {
      if (!roleAtLeast(role, "admin")) {
        return (json(res, role ? 403 : 404, { error: role ? "insufficient role" : "org not found" }), true);
      }
      const body = await readJsonBody<{ name?: string }>(req);
      const name = (body.name ?? "").trim();
      if (!name) return (json(res, 400, { error: "name is required" }), true);
      if (name.length > MAX_ORG_NAME) {
        return (json(res, 400, { error: `name must be ${MAX_ORG_NAME} chars or fewer` }), true);
      }
      await members.renameOrganization(orgId, name);
      void audit({ project_id: null, user_id: user.id, kind: "org_update", target: orgId, metadata: { name } });
      json(res, 200, { ok: true });
      return true;
    }
    if (method === "DELETE") {
      // Only an owner can dissolve the org. The transactional DB function
      // reassigns its projects to that owner before removing the org.
      if (role !== "owner") {
        return (json(res, role ? 403 : 404, { error: role ? "only an owner can delete the org" : "org not found" }), true);
      }
      const [orgProjects, orgMembers] = await Promise.all([
        listOrgProjects(orgId),
        members.listOrgMembers(orgId),
      ]);
      await members.deleteOrganization(orgId, user.id);
      await Promise.all(
        orgMembers.flatMap((member) =>
          orgProjects.map((project) => notifyProjectAuthorizationChanged(project.id, member.user_id)),
        ),
      );
      void audit({ project_id: null, user_id: user.id, kind: "org_update", target: orgId, metadata: { deleted: true } });
      json(res, 200, { ok: true });
      return true;
    }
  }

  // ── Leave an org (any member removes themselves) ─────────────────────────
  const orgLeaveM = url.match(/^\/api\/orgs\/([0-9a-fA-F-]{8,})\/leave$/);
  if (orgLeaveM && method === "POST") {
    const orgId = orgLeaveM[1];
    const role = await members.getOrgRole(orgId, user.id);
    if (!role) return (json(res, 404, { error: "org not found" }), true);
    // The last owner can't abandon the org — they'd orphan it. Make someone
    // else an owner, or delete the org instead.
    if (role === "owner" && (await members.countOrgOwners(orgId)) <= 1) {
      return (json(res, 409, { error: "you're the only owner — promote another owner or delete the org first" }), true);
    }
    await members.removeOrgMember(orgId, user.id);
    await notifyOrgAuthorizationChanged(orgId, user.id);
    void audit({ project_id: null, user_id: user.id, kind: "member_remove", target: user.id, metadata: { org: orgId, left: true } });
    json(res, 200, { ok: true });
    return true;
  }

  // ── Org usage: month-to-date spend vs. cap (P3.5) ────────────────────────
  const orgUsageM = url.match(/^\/api\/orgs\/([0-9a-fA-F-]{8,})\/usage$/);
  if (orgUsageM && method === "GET") {
    const orgId = orgUsageM[1];
    const role = await members.getOrgRole(orgId, user.id);
    if (!role) return (json(res, 404, { error: "org not found" }), true);
    const org = await members.getOrganization(orgId);
    const [spend, projectCount] = await Promise.all([
      orgMonthToDateSpendUsd(orgId).catch(() => 0),
      members.countOrgProjects(orgId).catch(() => 0),
    ]);
    const usage: OrgUsageSummary = {
      spend_usd: spend,
      budget_usd: org?.monthly_budget_usd ?? null,
      project_count: projectCount,
      month_start: startOfMonthIso(),
    };
    json(res, 200, { usage });
    return true;
  }

  const orgM = url.match(/^\/api\/orgs\/([0-9a-fA-F-]{8,})\/(members|budget)(?:\/([0-9a-fA-F-]{8,}))?$/);
  if (orgM) {
    const orgId = orgM[1];
    const sub = orgM[2];
    const targetUserId = orgM[3];
    const requireOrgRole = async (min: Role): Promise<Role | null> => {
      const role = await members.getOrgRole(orgId, user.id);
      if (!roleAtLeast(role, min)) {
        json(res, role ? 403 : 404, { error: role ? "insufficient role" : "org not found" });
        return null;
      }
      return role;
    };
    if (sub === "members" && method === "GET") {
      if (!(await requireOrgRole("viewer"))) return true;
      json(res, 200, { members: await members.listOrgMembers(orgId) });
      return true;
    }
    if (sub === "members" && method === "POST") {
      const callerRole = await requireOrgRole("admin");
      if (!callerRole) return true;
      const body = await readJsonBody<{ email?: string; role?: string }>(req);
      const role = asRole(body.role) ?? "editor";
      if (!roleAtLeast(callerRole, role)) {
        return (json(res, 403, { error: `cannot grant a role higher than your own (${callerRole})` }), true);
      }
      const email = (body.email ?? "").trim();
      if (!email) return (json(res, 400, { error: "email is required" }), true);
      if (email.length > MAX_EMAIL) {
        return (json(res, 400, { error: `email must be ${MAX_EMAIL} chars or fewer` }), true);
      }
      const r = await members.addOrgMemberByEmail(orgId, email, role);
      if (!r.ok) {
        return (
          json(res, r.reason === "no_user" ? 404 : r.reason === "exists" ? 409 : 500, {
            error:
              r.reason === "no_user"
                ? "no Gate 15 account with that email"
                : r.reason === "exists"
                  ? "that account is already an organization member; change its role instead"
                  : r.message ?? "failed",
          }),
          true
        );
      }
      void audit({ project_id: null, user_id: user.id, kind: "member_invite", target: orgId, metadata: { email: body.email, role } });
      json(res, 200, { ok: true });
      return true;
    }
    if (sub === "members" && method === "PATCH" && targetUserId) {
      const callerRole = await requireOrgRole("admin");
      if (!callerRole) return true;
      const body = await readJsonBody<{ role?: string }>(req);
      const role = asRole(body.role);
      if (!role) return (json(res, 400, { error: "valid role required" }), true);
      if (!roleAtLeast(callerRole, role)) {
        return (json(res, 403, { error: `cannot grant a role higher than your own (${callerRole})` }), true);
      }
      // Only an owner can modify another owner (e.g. demote them).
      if (callerRole !== "owner" && (await members.getOrgRole(orgId, targetUserId)) === "owner") {
        return (json(res, 403, { error: "only an owner can change an owner's role" }), true);
      }
      const targetWasOwner = (await members.getOrgRole(orgId, targetUserId)) === "owner";
      if (targetWasOwner && role !== "owner" && (await members.countOrgOwners(orgId)) <= 1) {
        return (json(res, 409, { error: "cannot demote the organization's last owner" }), true);
      }
      await members.setOrgMemberRole(orgId, targetUserId, role);
      await notifyOrgAuthorizationChanged(orgId, targetUserId);
      void audit({ project_id: null, user_id: user.id, kind: "role_change", target: targetUserId, metadata: { org: orgId, role } });
      json(res, 200, { ok: true });
      return true;
    }
    if (sub === "members" && method === "DELETE" && targetUserId) {
      const callerRole = await requireOrgRole("admin");
      if (!callerRole) return true;
      // Only an owner can remove another owner.
      if (callerRole !== "owner" && (await members.getOrgRole(orgId, targetUserId)) === "owner") {
        return (json(res, 403, { error: "only an owner can remove an owner" }), true);
      }
      if ((await members.getOrgRole(orgId, targetUserId)) === "owner" && (await members.countOrgOwners(orgId)) <= 1) {
        return (json(res, 409, { error: "cannot remove the organization's last owner" }), true);
      }
      await members.removeOrgMember(orgId, targetUserId);
      await notifyOrgAuthorizationChanged(orgId, targetUserId);
      void audit({ project_id: null, user_id: user.id, kind: "member_remove", target: targetUserId, metadata: { org: orgId } });
      json(res, 200, { ok: true });
      return true;
    }
    if (sub === "budget" && method === "PATCH") {
      if (!(await requireOrgRole("admin"))) return true;
      const body = await readJsonBody<{ monthly_budget_usd?: number | null }>(req);
      const v = body.monthly_budget_usd;
      const budget = v === null || v === undefined ? null : Number(v);
      if (budget !== null && (!Number.isFinite(budget) || budget < 0)) {
        return (json(res, 400, { error: "monthly_budget_usd must be a non-negative number or null" }), true);
      }
      await members.setOrgBudget(orgId, budget);
      json(res, 200, { ok: true });
      return true;
    }
  }

  return false;
}

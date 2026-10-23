import { expect, test } from "vitest";
import type { RunRecord, TaskRecord } from "@luuna/api-client";
import { repositoryIdFromPath } from "../projects/RegisterForm";
import { derivationChoices } from "./TaskGraphEditor";
import { advisoryTasksForTicket } from "./model";

test("a repository id comes from the checkout's folder name (ADR 0040)", () => {
  expect(repositoryIdFromPath("/srv/walkthrough")).toBe("walkthrough");
  expect(repositoryIdFromPath("C:\\src\\My API\\")).toBe("my-api");
  expect(repositoryIdFromPath("/home/dev/2048-game")).toBe("repo-2048-game");
  expect(repositoryIdFromPath("/")).toBe("");
  expect(repositoryIdFromPath("")).toBe("");
});

test("a task row derives from a known advisory task picked from a list, not a typed id", () => {
  const task = (task_id: string, role: string): TaskRecord => ({ run_id: "r", task_id, repository_id: "app", role, state: "completed", depends_on: [], updated_at: "" });
  const advisory = [task("orchestrate", "project_orchestrator"), task("orchestrate", "project_orchestrator"), task("lead", "repository_lead")];
  expect(derivationChoices("", advisory).map((choice) => choice.value)).toEqual(["", "orchestrate", "lead"]);
  expect(derivationChoices("", advisory)[1].label).toBe("orchestrate (app, project orchestrator, completed)");
  expect(derivationChoices("earlier", advisory).at(-1)).toEqual({ value: "earlier", label: "earlier" });
});

test("only the selected ticket's own runs offer advisory tasks to derive from", () => {
  const task = (run_id: string, task_id: string, role: string): TaskRecord => ({ run_id, task_id, repository_id: "app", role, state: "completed", depends_on: [], updated_at: "" });
  const run = (id: string, plan_id: string) => ({ id, metadata: { plan_id } }) as unknown as RunRecord;
  const inspected = { "run-a": [task("run-a", "lead-a", "repository_lead"), task("run-a", "impl", "implementer")], "run-b": [task("run-b", "lead-b", "repository_lead")] };
  const runs = [run("run-a", "plan-ticket-a"), run("run-b", "plan-ticket-b")];
  expect(advisoryTasksForTicket(["plan-ticket-a"], runs, inspected).map((t) => t.task_id)).toEqual(["lead-a"]);
  expect(advisoryTasksForTicket([], runs, inspected)).toEqual([]);
});

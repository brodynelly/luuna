import { expect, test } from "vitest";
import type { RunRecord, TaskRecord } from "@luuna/api-client";
import { repositoryIdFromPath, rowForPath } from "../projects/RegisterForm";
import { derivationChoices } from "./TaskGraphEditor";
import { advisoryTasksForTicket } from "./model";

test("a repository id comes from the checkout's folder name (ADR 0042)", () => {
  expect(repositoryIdFromPath("/srv/walkthrough")).toBe("walkthrough");
  expect(repositoryIdFromPath("C:\\src\\My API\\")).toBe("my-api");
  expect(repositoryIdFromPath("/home/dev/2048-game")).toBe("repo-2048-game");
  expect(repositoryIdFromPath("/")).toBe("");
  expect(repositoryIdFromPath("")).toBe("");
});

test("a path's folder name sets the id until the developer types one, never a parent's name", () => {
  let row = { id: "app", path: "" };
  for (const path of ["/home/dev", "/home/dev/", "/home/dev/项目"]) row = rowForPath(row, path, false);
  expect(row).toEqual({ id: "", path: "/home/dev/项目" });
  expect(rowForPath({ id: "app", path: "" }, "/srv/walkthrough", false).id).toBe("walkthrough");
  expect(rowForPath({ id: "mine", path: "" }, "/srv/walkthrough", true)).toEqual({ id: "mine", path: "/srv/walkthrough" });
});

test("a task row derives from a known advisory task picked from a list, not a typed id", () => {
  const task = (task_id: string, role: string): TaskRecord => ({ run_id: "r", task_id, repository_id: "app", role, state: "completed", depends_on: [], updated_at: "" });
  const advisory = [task("orchestrate", "project_orchestrator"), task("orchestrate", "project_orchestrator"), task("lead", "repository_lead")];
  expect(derivationChoices("", advisory).map((choice) => choice.value)).toEqual(["", "orchestrate", "lead"]);
  expect(derivationChoices("", advisory)[1].label).toBe("orchestrate (app, project orchestrator, completed)");
  expect(derivationChoices("earlier", advisory).at(-1)).toEqual({ value: "earlier", label: "earlier" });
  // A task named like a task of the plan being built (its repository, or `implement`) is never offered.
  expect(derivationChoices("", [task("app", "repository_lead"), task("lead", "repository_lead")], ["app", "lib"]).map((choice) => choice.value)).toEqual(["", "lead"]);
  expect(derivationChoices("", [task("implement", "repository_lead")], ["implement"]).map((choice) => choice.value)).toEqual([""]);
});

test("only the selected ticket's own runs offer advisory tasks to derive from", () => {
  const task = (run_id: string, task_id: string, role: string): TaskRecord => ({ run_id, task_id, repository_id: "app", role, state: "completed", depends_on: [], updated_at: "" });
  const run = (id: string, plan_id: string) => ({ id, metadata: { plan_id } }) as unknown as RunRecord;
  const inspected = { "run-a": [task("run-a", "lead-a", "repository_lead"), task("run-a", "impl", "implementer")], "run-b": [task("run-b", "lead-b", "repository_lead")] };
  const runs = [run("run-a", "plan-ticket-a"), run("run-b", "plan-ticket-b")];
  expect(advisoryTasksForTicket(["plan-ticket-a"], runs, inspected).map((t) => t.task_id)).toEqual(["lead-a"]);
  expect(advisoryTasksForTicket([], runs, inspected)).toEqual([]);
});

import { expect, test } from "vitest";
import type { TaskRecord } from "@luuna/api-client";
import { repositoryIdFromPath } from "../projects/RegisterForm";
import { derivationChoices } from "./TaskGraphEditor";

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

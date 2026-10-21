import { beforeEach, expect, it, vi } from "vitest";

const core = vi.hoisted(() => ({ invoke: vi.fn(), isTauri: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => core);
import { ensureLocalRuntime } from "./native-runtime";

beforeEach(() => { core.invoke.mockReset(); core.isTauri.mockReturnValue(true); });

it("never invokes host startup in a browser", async () => {
  core.isTauri.mockReturnValue(false);
  await expect(ensureLocalRuntime()).rejects.toThrow("native desktop");
  expect(core.invoke).not.toHaveBeenCalled();
});

it("shares concurrent startup requests without retaining the connection for future reloads", async () => {
  const connection = { url: "http://127.0.0.1:4242", token: "fixture" };
  core.invoke.mockResolvedValue(connection);
  const first = ensureLocalRuntime();
  expect(ensureLocalRuntime()).toBe(first);
  await expect(first).resolves.toEqual(connection);
  await ensureLocalRuntime();
  expect(core.invoke).toHaveBeenCalledTimes(2);
  expect(core.invoke).toHaveBeenCalledWith("ensure_local_runtime");
});

it("allows retry after a failed startup", async () => {
  core.invoke.mockRejectedValueOnce("Port occupied");
  await expect(ensureLocalRuntime()).rejects.toThrow("Port occupied");
  core.invoke.mockResolvedValue({ url: "http://127.0.0.1:4242", token: "fixture" });
  await ensureLocalRuntime();
  expect(core.invoke).toHaveBeenCalledTimes(2);
});

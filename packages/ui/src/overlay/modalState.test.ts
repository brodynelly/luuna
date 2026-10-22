import { describe, expect, test } from "vitest";
import { cancelOutcome, focusInitial, restoreOpener, syncDialog } from "./modalState";

function fakeDialog(options: { modal?: boolean } = {}) {
  const calls: string[] = [];
  const dialog = {
    open: false,
    setAttribute(name: string) { calls.push(`set ${name}`); dialog.open = true; },
    removeAttribute(name: string) { calls.push(`remove ${name}`); dialog.open = false; },
    ...(options.modal === false ? {} : {
      showModal() { calls.push("showModal"); dialog.open = true; },
      close() { calls.push("close"); dialog.open = false; },
    }),
  };
  return { dialog, calls };
}

describe("syncDialog", () => {
  test("opens as a modal and closes through the native methods", () => {
    const { dialog, calls } = fakeDialog();
    expect(syncDialog(dialog, true)).toBe(true);
    expect(syncDialog(dialog, false)).toBe(true);
    expect(calls).toEqual(["showModal", "close"]);
  });

  test("does nothing when the element is already in the wanted state", () => {
    const { dialog, calls } = fakeDialog();
    expect(syncDialog(dialog, false)).toBe(false);
    dialog.open = true;
    expect(syncDialog(dialog, true)).toBe(false);
    expect(calls).toEqual([]);
  });

  test("falls back to the open attribute where showModal is not implemented", () => {
    const { dialog, calls } = fakeDialog({ modal: false });
    syncDialog(dialog, true);
    syncDialog(dialog, false);
    expect(calls).toEqual(["set open", "remove open"]);
  });
});

describe("focus", () => {
  test("initial focus goes to the requested control only", () => {
    const focused: string[] = [];
    expect(focusInitial({ focus: () => focused.push("cancel") })).toBe(true);
    expect(focusInitial(null)).toBe(false);
    expect(focusInitial(undefined)).toBe(false);
    expect(focused).toEqual(["cancel"]);
  });

  test("closing returns focus to the opener when it can take it", () => {
    const focused: string[] = [];
    expect(restoreOpener({ focus: () => focused.push("opener") })).toBe(true);
    expect(restoreOpener(null)).toBe(false);
    expect(restoreOpener({})).toBe(false);
    expect(restoreOpener("body")).toBe(false);
    expect(focused).toEqual(["opener"]);
  });
});

test("Escape (the cancel event) asks the owner to close while the dialog is open, and is ignored otherwise", () => {
  expect(cancelOutcome(true)).toBe("request-close");
  expect(cancelOutcome(false)).toBe("ignore");
});

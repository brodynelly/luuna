# Historical reference material

The numbered chapters under `docs/`, root proposal/reference reading copies, diagrams, examples, and original documentation validation report are retained for rationale and full-v1 requirements. They are historical material; use [the current architecture](../CURRENT-ARCHITECTURE.md) and [accepted decisions](../decisions/) for new implementation work.

`ORIGINAL-REFERENCE-MANIFEST.sha256` preserves the original reference pack's `MANIFEST.sha256` bytes from baseline commit `532048d`. Its paths are relative to that original repository root and its hashes describe that historical snapshot, including the old README and AI handoff. It is not a manifest of the current working tree, a release signature, or current product validation. To verify the historical pack, check the hashes against that baseline revision without overwriting the development checkout.

The original `VALIDATION-REPORT.md` concerns documentation artifacts. New build, test, provider, and platform evidence must identify the commands and revision exercised rather than treating the historical report as proof of implemented software.

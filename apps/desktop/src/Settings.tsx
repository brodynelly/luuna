import { useEffect, useState } from "react";
import type { DoctorItem, DoctorReport, DoctorStatus, LuunaClient } from "@luuna/api-client";
import { describeFailure } from "./failures";
import { StatusBadge } from "./design/StatusBadge";
import type { Tone } from "./design/tone";

/**
 * The doctor statuses on the six tones: `ok` is passed evidence of the environment, `warning`
 * waits on the developer (an advisory item), `missing` fails a required item.
 */
export const doctorTone: Record<DoctorStatus, Tone> = { ok: "success", warning: "attention", missing: "danger" };

/** One read of the runtime's own doctor report (`GET /api/v1/doctor`), the same `luuna-runtime doctor --json` prints. */
export function readDoctor(client: Pick<LuunaClient, "doctor">, signal: AbortSignal): Promise<DoctorReport> {
  return client.doctor(signal);
}

/** The report as a list: status badge, item name, the required marker and the runtime's one-line detail, then the verdict. */
export function DoctorReportView({ report }: { report: DoctorReport }) {
  return <div className="settings-report">
    <ul className="settings-items" aria-label="Runtime environment and credential presence">{report.items.map((item: DoctorItem) => <li key={item.name} className="settings-item">
      <StatusBadge tone={doctorTone[item.status]}>{item.status}</StatusBadge>
      <code>{item.name}</code>
      {item.required && <span className="tag">required</span>}
      <span className="settings-detail">{item.detail}</span>
    </li>)}</ul>
    <p className="callout settings-verdict" data-tone={report.ok ? "success" : "danger"} role="status">{report.ok ? "doctor: ok. Every required item is present and the database is usable." : "doctor: FAILED. A required item is missing or the database is unusable; the items above say which."}</p>
  </div>;
}

/**
 * The Settings panel of docs/09-experience.md (ADR 0027 point 4): the runtime's environment and
 * credential presence as `luuna-runtime doctor` reports it for the running runtime. Nothing is
 * edited here: credentials live in the runtime's environment and only their presence is shown.
 */
export function Settings({ client, connectionEpoch = 0, refreshEpoch = 0 }: { client: LuunaClient | null; connectionEpoch?: number; refreshEpoch?: number }) {
  const [report, setReport] = useState<DoctorReport | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    setReport(null);
    setError("");
    if (!client) return;
    const controller = new AbortController();
    setBusy(true);
    readDoctor(client, controller.signal).then((next) => {
      if (controller.signal.aborted) return;
      setReport(next);
      setError("");
    }).catch((failure) => {
      if (!controller.signal.aborted) setError(describeFailure(failure));
    }).finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [client, connectionEpoch, refreshEpoch, tick]);

  return <section className="panel settings-panel" aria-labelledby="settings-heading" data-surface="settings">
    <div className="panel-heading"><h2 id="settings-heading">Settings</h2><span className="tag">Runtime environment · credential presence</span><button type="button" className="text-button" disabled={!client || busy} data-capability="doctor" onClick={() => setTick((value) => value + 1)}>Refresh</button></div>
    <p className="scope">What <code>luuna-runtime doctor</code> reports for the connected runtime: Git, Python, Node, the Pi launcher, the data directory and database, the service token, the GitHub token, provider credentials, the port, the component layout and Bun. Values are never shown, only whether each is present. Credentials are configured in the runtime's environment (<code>LUUNA_API_TOKEN</code>, <code>LUUNA_GITHUB_TOKEN</code>, the provider variables), not here.</p>
    {error && <div className="error" role="alert">{error}<button className="text-button" type="button" onClick={() => setError("")}>Dismiss</button></div>}
    {client ? report ? <DoctorReportView report={report} /> : !error && <p className="empty">Reading the runtime's doctor report…</p> : <p className="empty empty-box">Connect to the runtime to see its environment and which credentials are configured.</p>}
  </section>;
}

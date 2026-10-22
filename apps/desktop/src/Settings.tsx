import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { DoctorItem, DoctorReport, DoctorStatus, LuunaClient } from "@luuna/api-client";
import { describeFailure } from "./failures";
import type { Tone } from "./design/tone";
import { viewInfo } from "./content/views";
import { Box, Button, Callout, CheckDraw, EmptyState, ErrorBanner, Id, Item, List, Loading, Page, Section, StatusBadge, Tag } from "./ui";

/**
 * The doctor statuses on the six tones: `ok` is passed evidence of the environment, `warning`
 * waits on the developer (an advisory item), `missing` fails a required item.
 */
export const doctorTone: Record<DoctorStatus, Tone> = { ok: "success", warning: "attention", missing: "danger" };

/** One read of the runtime's own doctor report (`GET /api/v1/doctor`), the same `luuna-runtime doctor --json` prints. */
export function readDoctor(client: Pick<LuunaClient, "doctor">, signal: AbortSignal): Promise<DoctorReport> {
  return client.doctor(signal);
}

/** The sections the doctor items read under, in order; an item the runtime adds later lands under "Other". */
export const DOCTOR_GROUPS: readonly { label: string; names: readonly string[] }[] = [
  { label: "Required tools", names: ["git", "pi", "data_dir"] },
  { label: "Optional tools", names: ["python", "node", "bun", "components"] },
  { label: "Runtime", names: ["database", "port"] },
  { label: "Credentials", names: ["api_token", "github_token", "provider_credentials"] },
];

/** The items split into the labelled sections, each in the runtime's own order; empty sections are dropped. */
export function groupDoctorItems(items: readonly DoctorItem[]): { label: string; items: DoctorItem[] }[] {
  const known = new Set(DOCTOR_GROUPS.flatMap((group) => group.names));
  const groups = DOCTOR_GROUPS.map((group) => ({ label: group.label, items: items.filter((item) => group.names.includes(item.name)) }));
  groups.push({ label: "Other", items: items.filter((item) => !known.has(item.name)) });
  return groups.filter((group) => group.items.length > 0);
}

/** The report as a list: status badge, item name, the required marker and the runtime's one-line detail under section labels, then the verdict. */
export function DoctorReportView({ report, tick = 0 }: { report: DoctorReport; tick?: number }) {
  return <Box className="settings-report">
    <List className="settings-items" label="Runtime environment and credential presence">{groupDoctorItems(report.items).flatMap((group) => [
      <Item key={`group-${group.label}`} className="settings-group">{group.label}</Item>,
      ...group.items.map((item: DoctorItem) => <Item key={item.name} className="settings-item">
        <StatusBadge tone={doctorTone[item.status]}>{item.status}</StatusBadge>
        <Id>{item.name}</Id>
        {item.required && <Tag>required</Tag>}
        <span className="settings-detail">{item.detail}</span>
      </Item>),
    ])}</List>
    <Box className="settings-verdict-row">
      {report.ok && <CheckDraw key={tick} />}
      <Callout className="settings-verdict" tone={report.ok ? "success" : "danger"} status>{report.ok ? "doctor: ok. Every required item is present and the database is usable." : "doctor: FAILED. A required item is missing or the database is unusable; the items above say which."}</Callout>
    </Box>
  </Box>;
}

/**
 * The Settings panel of docs/09-experience.md (ADR 0027 point 4): the runtime's environment and
 * credential presence as `luuna-runtime doctor` reports it for the running runtime. Nothing is
 * edited here: credentials live in the runtime's environment and only their presence is shown.
 */
export function Settings({ client, connectionEpoch = 0, refreshEpoch = 0, children }: { client: LuunaClient | null; connectionEpoch?: number; refreshEpoch?: number; children?: ReactNode }) {
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

  const info = viewInfo("settings");
  const refresh = <Button variant="text" disabled={!client || busy} data-capability="doctor" onClick={() => setTick((value) => value + 1)}>Refresh</Button>;
  const description = <>{info.description} Credentials such as <Id>LUUNA_API_TOKEN</Id> are configured in the runtime's environment, not here; Luuna shows whether each is present, never its value.</>;
  return <Page id="settings" title={info.label} description={description} className="settings-panel" data-surface="settings">
    {children}
    <Section id="environment-heading" title="Environment" className="settings-environment" accessory={refresh}>
      {error && <ErrorBanner message={error} onDismiss={() => setError("")} />}
      {client ? report ? <DoctorReportView report={report} tick={tick} /> : !error && <Loading label="Reading the runtime's doctor report…" rows={6} />
        : <EmptyState boxed wash>Connect to the runtime to see its environment and which credentials are configured.</EmptyState>}
    </Section>
  </Page>;
}

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { DoctorItem, DoctorReport, DoctorStatus, LuunaClient } from "@luuna/api-client";
import { describeFailure } from "./failures";
import { type Tone, Box, Button, Callout, EmptyState, ErrorBanner, Id, Loading, Page, Section, SettingsRow, StatusBadge, Surface, Tag } from "@luuna/ui";
import { viewInfo } from "./content/views";

/**
 * The doctor statuses on the six tones: `ok` is passed evidence of the environment, `warning`
 * waits on the developer (an advisory item), `missing` fails a required item.
 */
export const doctorTone: Record<DoctorStatus, Tone> = { ok: "success", warning: "attention", missing: "danger" };

/** One read of the runtime's own doctor report (`GET /api/v1/doctor`), the same `luuna-runtime doctor --json` prints. */
export function readDoctor(client: Pick<LuunaClient, "doctor">, signal: AbortSignal): Promise<DoctorReport> {
  return client.doctor(signal);
}

export interface DoctorGroup { label: string; items: DoctorItem[] }

const RUNTIME_ITEMS: readonly string[] = ["data_dir", "database", "port", "components"];
const isCredential = (name: string) => name === "provider_credentials" || name.endsWith("_token") || name.endsWith("_credentials");

/**
 * The items split into Required tools, Runtime, Credentials and Optional tools, each in the runtime's own
 * order, empty groups dropped, every item exactly once. Presentation only: an item the runtime adds later
 * lands under Optional tools, and the runtime stays the authority on each status.
 */
export function doctorGroups(items: readonly DoctorItem[]): DoctorGroup[] {
  const credentials = items.filter((item) => isCredential(item.name));
  const runtime = items.filter((item) => !isCredential(item.name) && RUNTIME_ITEMS.includes(item.name));
  const rest = items.filter((item) => !isCredential(item.name) && !RUNTIME_ITEMS.includes(item.name));
  return [
    { label: "Required tools", items: rest.filter((item) => item.required) },
    { label: "Runtime", items: runtime },
    { label: "Credentials", items: credentials },
    { label: "Optional tools", items: rest.filter((item) => !item.required) },
  ].filter((group) => group.items.length > 0);
}

/** The report as titled groups of settings rows (name, required marker, the runtime's detail, status badge), then the verdict. */
export function DoctorReportView({ report }: { report: DoctorReport }) {
  return <Box className="settings-report">
    <Box className="settings-groups" role="group" aria-label="Runtime environment and credential presence">{doctorGroups(report.items).map((group) => <Surface key={group.label} pad={4} className="settings-group">
      <Section id={`settings-group-${group.label.toLowerCase().replace(/\s+/g, "-")}`} level={4} variant="plain" title={group.label}>
        <Box className="settings-rows">{group.items.map((item: DoctorItem) => <SettingsRow key={item.name} className="settings-item" title={<><Id>{item.name}</Id>{item.required && <Tag>required</Tag>}</>} description={item.detail} control={<StatusBadge tone={doctorTone[item.status]}>{item.status}</StatusBadge>} />)}</Box>
      </Section>
    </Surface>)}</Box>
    <Callout className="settings-verdict" tone={report.ok ? "success" : "danger"} status>{report.ok ? "doctor: ok. Every required item is present and the database is usable." : "doctor: FAILED. A required item is missing or the database is unusable; the items above say which."}</Callout>
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
      {client ? report ? <DoctorReportView report={report} /> : !error && <Loading label="Reading the runtime's doctor report…" rows={6} />
        : <EmptyState boxed>Connect to the runtime to see its environment and which credentials are configured.</EmptyState>}
    </Section>
  </Page>;
}

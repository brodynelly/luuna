import type { Runtime } from "./useRuntime";
import { Actions, Button, Form, Id, Mark, Meta, Page, Section, TextField, submitted } from "../ui";

/** Shown in place of every view but Help until a runtime answers: one task, centred. */
export function ConnectPage({ runtime }: { runtime: Runtime }) {
  const { url, setUrl, token, setToken, busy, native, connect, startNative } = runtime;
  const intro = native
    ? "Luuna starts your local runtime and connects automatically. Closing the app leaves the runtime running."
    : "Start the Luuna runtime, then enter its local address and service token.";
  return <Page id="connect" title="Connect to your runtime" className="connection-panel connect-page" description={intro}>
    <Mark className="connect-mark" />
    <Form onSubmit={submitted(connect)} className="connection-form">
      <TextField label="Service URL" type="url" mono value={url} onChange={(event) => setUrl(event.target.value)} required />
      <TextField label="Service token" type="password" value={token} onChange={(event) => setToken(event.target.value)} autoComplete="off" required placeholder="LUUNA_API_TOKEN" />
      <Button variant="primary" submit disabled={busy} data-capability="health">{busy ? "Connecting…" : "Connect"}</Button>
      <Meta>The token stays in memory and is cleared when you disconnect or reload.</Meta>
      {native && <Button disabled={busy} onClick={startNative}>{busy ? "Starting local runtime…" : "Connect automatically"}</Button>}
    </Form>
  </Page>;
}

/** Settings › Runtime: the connected address and Pi version, Disconnect, and the orderly stop. */
export function RuntimeCard({ runtime }: { runtime: Runtime }) {
  const { client, health, busy, disconnect, stopRuntime } = runtime;
  if (!client) return null;
  const actions = <Actions>
    <Button onClick={disconnect}>Disconnect</Button>
    <Button variant="danger" disabled={busy} data-capability="shutdown" onClick={stopRuntime}>Stop runtime</Button>
  </Actions>;
  return <Section id="runtime-heading" title="Runtime" className="connection-panel" accessory={actions}>
    <Meta block><Id>{client.baseUrl}</Id> · Pi {health?.pi_version ?? "version unknown"}</Meta>
  </Section>;
}

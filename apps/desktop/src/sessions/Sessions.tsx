import type { Runtime } from "../shell/useRuntime";
import { describeFailure } from "../failures";
import { viewInfo } from "../content/views";
import { Box, Page } from "../ui";
import { EventPanel, History, StartSession } from "./SessionParts";
import { useSessionReplay } from "./useSessionReplay";

/** The Sessions view: run history beside the start form and the selected session's events. */
export function Sessions({ runtime }: { runtime: Runtime }) {
  const { client, runs, selected, setSelected, setRuns, busy, live, setLive, refresh, reload, perform, history } = runtime;
  const { events, output, candidateActive } = useSessionReplay(client, selected, runs, refresh, setLive);
  const active = runs.find((run) => run.id === selected);
  const info = viewInfo("sessions");

  function start(request: { prompt: string; provider?: string; model?: string }, done: () => void) {
    if (!client) return;
    void perform(async (signal) => {
      const run = await client.startRun(request, signal);
      if (signal.aborted) return;
      history.reset();
      reload();
      setRuns((previous) => [run, ...previous.filter((item) => item.id !== run.id)].slice(0, 200));
      setSelected(run.id);
      done();
    }, describeFailure);
  }

  function cancel() {
    if (!client || !active) return;
    void perform(async (signal) => {
      const run = await client.cancelRun(active.id, signal);
      if (!signal.aborted) setRuns((previous) => previous.map((item) => item.id === run.id ? run : item));
    }, describeFailure);
  }

  return <Page id="sessions" title={info.label} description={info.description} className="sessions-panel">
    <Box className="workspace">
      <History runs={runs} selected={selected} connected={client !== null} newer={history.newer} onSelect={setSelected} onRefresh={reload}
        onNewer={history.showNewer} onOlder={() => history.showOlder(runs[runs.length - 1].id)} />
      <Box className="main-column">
        <StartSession disabled={!client || busy} onStart={start} />
        <EventPanel client={client} active={active} events={events} output={output} live={live} candidateActive={candidateActive} busy={busy} onCancel={cancel} />
      </Box>
    </Box>
  </Page>;
}

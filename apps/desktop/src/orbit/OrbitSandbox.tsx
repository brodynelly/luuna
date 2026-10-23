import type { SandboxNetwork, SandboxPlan } from "@luuna/api-client";
import { sandboxCommand } from "@luuna/api-client";
import { presenceTone } from "@luuna/ui";
import { Box, Button, Facts, Id, Item, List, Loading, Meta, RadioGroup, ReasonNote, StatusBadge, Text } from "@luuna/ui";

const NETWORKS = [
  { value: "open", label: "Open: the sandbox may reach the network" },
  { value: "none", label: "None: no network inside the sandbox" },
] as const;

/** The plan as facts: backend, availability, where it starts, each read-write repository, the private home and the notes. */
export function SandboxPlanView({ plan }: { plan: SandboxPlan }) {
  const facts = [
    { term: "Backend", value: <Id>{plan.backend}</Id> },
    { term: "Available", value: <><StatusBadge tone={presenceTone(plan.available)}>{plan.available ? "available" : "unavailable"}</StatusBadge>{plan.reason && <> <ReasonNote tone={plan.available ? undefined : "attention"} reason={plan.reason} /></>}</> },
    { term: "Starts in", value: <Id>{plan.workdir}</Id> },
    { term: "Home", value: <Id>{plan.home}</Id> },
    { term: "Network", value: plan.network },
    ...(plan.container_name ? [{ term: "Container", value: <Id>{plan.container_name}</Id> }] : []),
  ];
  return <Box className="orbit-plan">
    <Facts items={facts} />
    <List label="Read-write repositories" className="orbit-plan-repositories">{plan.repositories.map((repository) => <Item key={repository.repository_id}>
      <Id>{repository.repository_id}</Id>: <Id>{repository.host_path}</Id>{repository.sandbox_path !== repository.host_path && <> appears at <Id>{repository.sandbox_path}</Id></>} (read-write)
    </Item>)}</List>
    {plan.repositories.length === 0 && <Meta block>No present checkout: the sandbox would reach no repository.</Meta>}
    {plan.notes.length > 0 && <List label="Sandbox notes" className="orbit-plan-notes">{plan.notes.map((note) => <Item key={note}>{note}</Item>)}</List>}
  </Box>;
}

/**
 * The project sandbox (`lu sbx`): the plan the runtime decided and the exact command that opens
 * it. A browser view cannot host an interactive terminal, so the sandbox opens from one.
 */
export function SandboxPanel({ projectId, network, plan, busy, onNetwork, onCopy }: {
  projectId: string; network: SandboxNetwork; plan: SandboxPlan | null; busy: boolean;
  onNetwork: (network: SandboxNetwork) => void; onCopy: (command: string) => void;
}) {
  const command = sandboxCommand(projectId, network);
  return <Box className="orbit-sandbox">
    <Text>The sandbox reaches only this project's present checkouts and a private home, enforced by the operating system rather than by prompts. A browser view cannot host the interactive terminal, so open it from a terminal with the command below.</Text>
    <RadioGroup legend="Sandbox network" name="orbit-sandbox-network" className="orbit-network" value={network} options={NETWORKS.map((choice) => ({ ...choice, disabled: busy }))} onChange={(value) => onNetwork(value as SandboxNetwork)} />
    {plan ? <SandboxPlanView plan={plan} /> : <Loading label="Reading the sandbox plan…" rows={4} />}
    <Box className="orbit-command" role="group" aria-label="Command that opens the sandbox">
      <Id className="orbit-command-text">{command}</Id>
      <Button variant="text" title={command} data-copy={command} onClick={() => onCopy(command)}>Copy command</Button>
    </Box>
  </Box>;
}

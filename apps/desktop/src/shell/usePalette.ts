import { useEffect, useMemo, useState } from "react";
import type { LuunaClient, ProjectRecord, Ticket } from "@luuna/api-client";
import { boundedMap } from "../Workflows";
import { VIEWS } from "../content/views";
import type { View } from "../content/views";
import type { OpenRequest } from "../Home";
import type { PaletteCommand } from "@luuna/ui";

interface Index { projects: ProjectRecord[]; tickets: Ticket[] }

/**
 * What the command palette offers: every view and window command, and, read from the runtime
 * each time the palette opens, every project and ticket. Opening a project or ticket goes
 * through the same request Home and the Board use.
 */
export function usePalette({ client, open, onView, onOpen, onToggleSidebar, onDisconnect }: {
  client: LuunaClient | null; open: boolean; onView: (view: View) => void; onOpen: (request: OpenRequest) => void; onToggleSidebar: () => void; onDisconnect: () => void;
}) {
  const [index, setIndex] = useState<Index>({ projects: [], tickets: [] });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !client) return;
    const controller = new AbortController();
    setLoading(true);
    void (async () => {
      try {
        const projects = await client.listProjects(controller.signal);
        const tickets = (await boundedMap(projects, (project) => client.listTickets(project.id, controller.signal))).flat();
        if (!controller.signal.aborted) setIndex({ projects, tickets });
      } catch {
        // The palette still offers views and window commands; the view the developer opens reports the failure.
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [open, client]);

  const commands = useMemo<PaletteCommand[]>(() => {
    const views = VIEWS.map((item, position) => ({ id: `view:${item.id}`, label: `Go to ${item.label}`, group: "View", shortcut: item.id === "settings" ? "Ctrl+," : `Ctrl+${position + 1}`, run: () => onView(item.id) }));
    const window: PaletteCommand[] = [
      { id: "window:sidebar", label: "Toggle sidebar", group: "Window", shortcut: "Ctrl+\\", run: onToggleSidebar },
      ...(client ? [{ id: "window:disconnect", label: "Disconnect from the runtime", group: "Window", run: onDisconnect }] : []),
    ];
    if (!client) return [...views, ...window];
    const names = new Map(index.projects.map((project) => [project.id, project.name]));
    const projects = index.projects.flatMap((project) => [
      { id: `project:${project.id}`, label: `Open ${project.name}`, group: "Project", keywords: project.id, run: () => onOpen({ projectId: project.id }) },
      ...(project.revision > 0 ? [{ id: `project:${project.id}:ticket`, label: `New ticket in ${project.name}`, group: "Project", keywords: project.id, run: () => onOpen({ projectId: project.id, ticketForm: true }) }] : []),
    ]);
    const tickets = index.tickets.map((ticket) => ({
      id: `ticket:${ticket.id}`, label: ticket.title, group: `Ticket in ${names.get(ticket.project_id) ?? ticket.project_id}`, keywords: ticket.id,
      run: () => onOpen({ projectId: ticket.project_id, ticketId: ticket.id }),
    }));
    return [...views, ...projects, ...tickets, ...window];
  }, [client, index, onView, onOpen, onToggleSidebar, onDisconnect]);

  return { commands, loading };
}

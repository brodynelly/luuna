import { useEffect, useMemo, useState } from "react";
import type { WindowControlsProps } from "@luuna/ui";
import { usesCustomTitleBar, watchMaximized, windowCommands } from "./windowChrome";

/**
 * The props for `WindowControls` in the Windows desktop app (ADR 0036), or null everywhere else, so the
 * browser build, macOS and Linux render and reserve nothing.
 */
export function useWindowChrome(): WindowControlsProps | null {
  const [enabled] = useState(() => usesCustomTitleBar());
  const [maximized, setMaximized] = useState(false);
  const commands = useMemo(() => (enabled ? windowCommands() : null), [enabled]);
  useEffect(() => (commands ? watchMaximized(commands, setMaximized) : undefined), [commands]);
  if (!commands) return null;
  return { maximized, onMinimize: commands.minimize, onToggleMaximize: commands.toggleMaximize, onClose: commands.close };
}

import { Icon } from "../Icon";

export interface WindowControlsProps {
  /** Whether the window fills the screen; the middle button then restores it. */
  maximized: boolean;
  onMinimize: () => void;
  onToggleMaximize: () => void;
  onClose: () => void;
}

/**
 * The caption buttons of an app that draws its own title bar (ADR 0036): minimize, maximize or restore, and
 * close. Presentational only; the host app decides when to show them and what each command does.
 */
export function WindowControls({ maximized, onMinimize, onToggleMaximize, onClose }: WindowControlsProps) {
  const toggle = maximized ? "Restore" : "Maximize";
  return <div className="window-controls" role="group" aria-label="Window controls">
    <button type="button" className="caption-button" aria-label="Minimize" title="Minimize" onClick={onMinimize}><Icon name="minimize" /></button>
    <button type="button" className="caption-button" aria-label={toggle} title={toggle} onClick={onToggleMaximize}><Icon name={maximized ? "restore" : "maximize"} /></button>
    <button type="button" className="caption-button caption-close" aria-label="Close" title="Close" onClick={onClose}><Icon name="close" /></button>
  </div>;
}

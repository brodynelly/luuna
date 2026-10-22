import { createElement } from "react";
import type { LiHTMLAttributes, ReactNode } from "react";
import { useContextMenu } from "../menus";
import type { ContextMenuBinding, MenuCommand } from "../menus";
import { cx } from "./cx";

export interface ListRowProps extends Omit<LiHTMLAttributes<HTMLLIElement>, "title"> {
  leading?: ReactNode;
  title: ReactNode;
  meta?: ReactNode;
  /** Display-only content (badges, counts). With `onOpen` it sits inside the row button, so no controls here. */
  trailing?: ReactNode;
  /** Nested content below the title row (a repository list, an action row). It sits outside the row button, so it may hold controls. */
  detail?: ReactNode;
  /** Makes the row one button that fills it. */
  onOpen?: () => void;
  /** Selection state of an interactive row, exposed as `aria-pressed`. */
  selected?: boolean;
  /** Disables the row button (only with `onOpen`). */
  disabled?: boolean;
  /** The accessible name of the row button (only with `onOpen`). The `li` keeps its own aria props. */
  buttonLabel?: string;
  /** Context-menu commands, shortcuts to actions that exist elsewhere. Needs `menuLabel`. */
  commands?: () => readonly MenuCommand[];
  /** The name of the context menu, for example "Actions for Run 12". */
  menuLabel?: string;
  /** Extra class on the inner row button (only with `onOpen`), for hooks that must sit on the control itself. */
  buttonClassName?: string;
  /** Controls beside the title row, inside the li and outside the row button (so they are valid next to an `onOpen` row). */
  actions?: ReactNode;
  /** The element of the title. `div` and `p` allow block or pre-wrapped text; they apply only to a row without `onOpen`, because a button may hold phrasing content only. */
  titleAs?: "span" | "div" | "p";
}

/** A generic list row: leading, title with meta, trailing, then optional detail. An interactive row is a single native button. */
export function ListRow(props: ListRowProps) {
  return props.commands ? <MenuRow {...props} /> : <Row {...props} />;
}

/** The only hook user: a row with commands owns its menu state, so a plain row stays a pure function. */
function MenuRow({ commands, menuLabel, ...rest }: ListRowProps) {
  const { handlers, menu } = useContextMenu(menuLabel ?? "Actions", commands);
  return <Row {...rest} handlers={handlers} menu={menu} />;
}

type RowProps = Omit<ListRowProps, "commands" | "menuLabel"> & { handlers?: ContextMenuBinding["handlers"]; menu?: ReactNode };

function Row({ leading, title, meta, trailing, detail, onOpen, selected, disabled, buttonLabel, buttonClassName, actions, titleAs = "span", handlers, menu, className, children, ...rest }: RowProps) {
  const block = onOpen ? "span" : titleAs;
  const body = <>
    {leading !== undefined && <span className="list-row-leading">{leading}</span>}
    {createElement(block === "span" ? "span" : "div", { className: "list-row-main" }, createElement(block, { className: "list-row-title" }, title), meta !== undefined && <span className="list-row-meta">{meta}</span>)}
    {trailing !== undefined && <span className="list-row-trailing">{trailing}</span>}
  </>;
  const below = detail ?? children;
  const main = onOpen
    ? <button type="button" className={cx("list-row-body", buttonClassName)} aria-label={buttonLabel} aria-pressed={selected === undefined ? undefined : selected} disabled={disabled} onClick={onOpen}>{body}</button>
    : <div className="list-row-body">{body}</div>;
  return <li className={cx("list-row", className)} data-selected={selected ? "" : undefined} {...rest} {...handlers}>
    {actions !== undefined && actions !== null ? <div className="list-row-head">{main}<div className="list-row-actions">{actions}</div></div> : main}
    {below !== undefined && below !== null && <div className="list-row-detail">{below}</div>}
    {menu}
  </li>;
}

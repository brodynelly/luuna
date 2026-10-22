import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "./cx";

export interface PageHeaderProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  /** The view id: the heading is `<id>-heading`, the sentence `<id>-description`. */
  id: string;
  title: ReactNode;
  /** One sentence on what the view is for. */
  description?: ReactNode;
  /** Toolbar actions on the trailing side of the title. */
  actions?: ReactNode;
  /** Where a nested page sits; rendered above the title, only where a real hierarchy exists. */
  breadcrumbs?: ReactNode;
  /** Descriptor chips or facts under the sentence. */
  meta?: ReactNode;
}

/**
 * The opening of a view: the one `h2`, one sentence, actions. It renders a fragment of the markup the Page
 * template uses today (`.panel-heading` row, then `p.scope`), so the same sibling rules and smokes apply
 * when it sits inside a `.panel.page` section. Rest props land on the heading row.
 */
export function PageHeader({ id, title, description, actions, breadcrumbs, meta, className, ...rest }: PageHeaderProps) {
  const descriptionId = description ? `${id}-description` : undefined;
  return <>
    {breadcrumbs}
    <div className={cx("panel-heading", "page-header", className)} {...rest}>
      <h2 id={`${id}-heading`} aria-describedby={descriptionId}>{title}</h2>
      {actions}
    </div>
    {description && <p className="scope" id={descriptionId}>{description}</p>}
    {meta && <div className="page-meta">{meta}</div>}
  </>;
}

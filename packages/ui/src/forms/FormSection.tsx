import { useId } from "react";
import type { FieldsetHTMLAttributes, HTMLAttributes, ReactNode } from "react";
import { describedBy, hasContent, joinClass } from "./identity";

export interface FormSectionProps extends Omit<FieldsetHTMLAttributes<HTMLFieldSetElement>, "title"> {
  title: ReactNode;
  /** One sentence under the title; linked with aria-describedby. */
  description?: ReactNode;
}

/** A titled group of related fields: a fieldset with a legend, so assistive technology announces the group. */
export function FormSection({ title, description, className, children, ...rest }: FormSectionProps) {
  const descriptionId = `${useId()}-description`;
  const described = hasContent(description);
  return (
    <fieldset {...rest} className={joinClass("form-section", className)} aria-describedby={describedBy(rest["aria-describedby"], described && descriptionId)}>
      <legend>{title}</legend>
      {described && <small id={descriptionId} className="form-section-description">{description}</small>}
      {children}
    </fieldset>
  );
}

export interface InlineFieldsProps extends HTMLAttributes<HTMLDivElement> {
  /** Columns when there is room: 2, 3 or 4. Fields stack on a narrow window. Default 2. */
  columns?: 2 | 3 | 4;
  /** Names the row as a group when the fields belong together. */
  label?: string;
  /** Always one column, at every width (a narrow rail). `columns` is ignored while it is set. */
  stack?: boolean;
}

/** Fields side by side in equal columns that collapse to one column on a narrow window. */
export function InlineFields({ columns = 2, label, stack, className, children, ...rest }: InlineFieldsProps) {
  return <div {...rest} role={label ? "group" : undefined} aria-label={label} className={joinClass("inline-fields", className)} data-columns={columns} data-stack={stack ? "" : undefined}>{children}</div>;
}

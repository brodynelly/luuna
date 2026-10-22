import type { ReactNode, MouseEventHandler } from 'react';

export type IconName = 'home' | 'balance' | 'card' | 'receipt' | 'chart' | 'grid' | 'more' | 'plus' | 'chevron' | 'search' | 'info' | 'close' | 'bulb' | 'gear' | 'bell' | 'user' | 'mail' | 'terminal' | 'lock' | 'bank' | 'globe' | 'doc' | 'arrow' | 'check' | 'alert' | 'pencil' | 'check-circle' | 'x-circle' | 'arrow-up' | 'arrow-down' | 'chevron-left' | 'chevron-right' | 'copy' | 'external' | 'refresh' | 'clipboard' | 'sparkle' | 'insert' | 'stop' | 'send' | 'mic' | 'download' | 'upload' | 'folder' | 'file' | 'server' | 'wifi-off' | 'link' | 'key' | 'keyboard' | 'filter' | 'trash' | 'clock' | 'shield' | 'monitor' | 'logout' | 'sun' | 'moon' | 'zoom-in' | 'zoom-out' | 'image' | 'video' | 'music' | 'archive' | 'help';

export interface ButtonProps { variant?: 'primary' | 'secondary' | 'ghost' | 'link' | 'danger'; type?: 'button' | 'submit'; size?: 'sm' | 'md'; icon?: IconName; iconRight?: IconName; disabled?: boolean; onClick?: MouseEventHandler; children?: ReactNode; }
export interface BadgeProps { tone?: 'neutral' | 'accent' | 'success' | 'danger' | 'warning' | 'info'; icon?: IconName; children?: ReactNode; }
export interface IconProps { name: IconName; size?: number; strokeWidth?: number; label?: string; className?: string; }
export interface BannerProps { label?: string; action?: string; onAction?: MouseEventHandler; children?: ReactNode; }
export interface CalloutProps { icon?: IconName; action?: string; href?: string; onDismiss?: MouseEventHandler | false; children?: ReactNode; }
export interface NavItemProps { label: string; icon?: IconName; href?: string; active?: boolean; trailing?: 'plus' | 'chevron'; onClick?: MouseEventHandler; }
export interface TabsProps { items: { value: string; label: string }[]; value?: string; defaultValue?: string; onChange?: (value: string) => void; }
export interface SearchFieldProps { placeholder?: string; width?: number | string; shortcut?: string; defaultValue?: string; }
export interface MetricCardProps { title: string; value?: string; comparison?: string; delta?: string; data?: number[]; until?: number; start?: string; end?: string; chartHeight?: number; updated?: string; href?: string; linkLabel?: string; emptyLabel?: string; }
export interface SettingsLinkProps { title: string; description?: string; icon?: IconName; href?: string; }
export interface LegendListProps { rows: { label: string; value: string; amount?: number; color?: string }[]; labelHeader?: string; valueHeader?: string; label?: string; }

export declare function Button(p: ButtonProps): JSX.Element;
export declare function Badge(p: BadgeProps): JSX.Element;
export declare function Icon(p: IconProps): JSX.Element;
export declare function Banner(p: BannerProps): JSX.Element;
export declare function Callout(p: CalloutProps): JSX.Element;
export declare function NavItem(p: NavItemProps): JSX.Element;
export declare function Tabs(p: TabsProps): JSX.Element;
export declare function SearchField(p: SearchFieldProps): JSX.Element;
export declare function MetricCard(p: MetricCardProps): JSX.Element;
export declare function SettingsLink(p: SettingsLinkProps): JSX.Element;
export declare function LegendList(p: LegendListProps): JSX.Element;

/* ---- Inputs, feedback, overlays, data, navigation, workspace ---- */
export interface IconButtonProps { icon: IconName; label: string; variant?: 'ghost' | 'filled'; active?: boolean; dot?: boolean; size?: number; disabled?: boolean; onClick?: MouseEventHandler; }
export interface TextFieldProps { label?: string; hint?: string; error?: string; placeholder?: string; icon?: IconName; prefix?: ReactNode; suffix?: ReactNode; mono?: boolean; type?: string; optional?: boolean; required?: boolean; disabled?: boolean; value?: string; defaultValue?: string; onChange?: (e: any) => void; id?: string; autoComplete?: string; }
export interface TextAreaProps { label?: string; hint?: string; error?: string; placeholder?: string; rows?: number; maxLength?: number; disabled?: boolean; value?: string; defaultValue?: string; onChange?: (e: any) => void; id?: string; }
export interface SelectProps { label?: string; hint?: string; error?: string; options: (string | { value: string; label: string; disabled?: boolean })[]; value?: string; defaultValue?: string; disabled?: boolean; onChange?: (e: any) => void; id?: string; }
export interface CheckboxProps { label?: string; description?: string; checked?: boolean; defaultChecked?: boolean; indeterminate?: boolean; disabled?: boolean; onChange?: (e: any) => void; }
export interface RadioGroupProps { label?: string; name?: string; options: { value: string; label: string; description?: string; disabled?: boolean }[]; defaultValue?: string; onChange?: (value: string) => void; }
export interface SwitchProps { label?: string; ariaLabel?: string; description?: string; checked?: boolean; defaultChecked?: boolean; disabled?: boolean; onChange?: (e: any) => void; }
export interface SegmentedControlProps { label: string; items: { value: string; label: string; icon?: IconName }[]; value?: string; defaultValue?: string; onChange?: (value: string) => void; }
export interface AlertProps { tone?: 'info' | 'success' | 'warning' | 'danger'; title?: string; icon?: IconName; actions?: ReactNode; onDismiss?: MouseEventHandler; children?: ReactNode; }
export interface ToastProps { tone?: 'neutral' | 'success' | 'danger' | 'warning' | 'info'; action?: string; onAction?: MouseEventHandler; onDismiss?: MouseEventHandler; inline?: boolean; children?: ReactNode; }
export interface SpinnerProps { size?: number; label?: string; }
export interface ProgressBarProps { value?: number; max?: number; indeterminate?: boolean; label?: string; detail?: ReactNode; tone?: 'success' | 'danger'; }
export interface SkeletonProps { lines?: number; width?: number | string; height?: number; circle?: boolean; size?: number; }
export interface TooltipProps { content: ReactNode; side?: 'top' | 'bottom'; open?: boolean; children: ReactNode; }
export interface EmptyStateProps { title: string; description?: ReactNode; icon?: IconName; action?: ReactNode; bordered?: boolean; }
export interface StatusIndicatorProps { status: 'connected' | 'connecting' | 'offline' | 'error' | 'idle'; label: string; detail?: string; }
export interface DialogProps { title: string; description?: ReactNode; actions?: ReactNode; tone?: 'danger'; wide?: boolean; open?: boolean; inline?: boolean; onClose?: () => void; children?: ReactNode; }
export interface MenuItem { label?: string; icon?: IconName; shortcut?: string[] | string; tone?: 'danger'; disabled?: boolean; onSelect?: () => void; divider?: boolean; heading?: string; }
export interface MenuProps { label?: string; items: MenuItem[]; triggerIcon?: IconName; triggerVariant?: ButtonProps['variant']; open?: boolean; trigger?: boolean; }
export interface DrawerProps { title: string; icon?: IconName; headerActions?: ReactNode; footer?: ReactNode; open?: boolean; inline?: boolean; onClose?: () => void; children?: ReactNode; }
export interface DataTableColumn<R = any> { key: string; label: string; align?: 'left' | 'right' | 'center'; width?: number | string; sortable?: boolean; mono?: boolean; muted?: boolean; render?: (row: R) => ReactNode; }
export interface DataTableProps<R = any> { columns: DataTableColumn<R>[]; rows: (R & { id: string | number })[]; sort?: { key: string; dir: 'asc' | 'desc' }; selectable?: boolean; onRowClick?: (row: R) => void; empty?: ReactNode; }
export interface PaginationProps { total: number; pageSize?: number; page?: number; noun?: string; onChange?: (page: number) => void; }
export interface PropertyListProps { items: { label: string; value: ReactNode; mono?: boolean }[]; horizontal?: boolean; }
export interface CodeBlockProps { title?: string; language?: string; copyable?: boolean; children: string; }
export interface KbdProps { keys: string[] | string; }
export interface ShortcutHintProps { label: string; keys: string[] | string; }
export interface AvatarProps { name: string; src?: string; size?: number; square?: boolean; }
export interface ChipProps { label?: string; icon?: IconName; selected?: boolean; onClick?: MouseEventHandler; onRemove?: MouseEventHandler; children?: ReactNode; }
export interface AccordionProps { items: { title: ReactNode; content: ReactNode }[]; defaultOpen?: number; }
export interface StepperProps { steps: { label: string; description?: string; status?: 'done' | 'current' | 'upcoming' | 'error' }[]; horizontal?: boolean; }
export interface BreadcrumbsProps { items: { label: string; href?: string }[]; }
export interface LinkProps { href?: string; external?: boolean; subtle?: boolean; onClick?: MouseEventHandler; children?: ReactNode; }
export interface SettingsRowProps { title: ReactNode; description?: ReactNode; badge?: ReactNode; control?: ReactNode; stacked?: boolean; children?: ReactNode; }
export interface PairingCodeProps { code: string; expiresIn?: number; status?: 'pending' | 'approved' | 'declined'; url?: string; onOpen?: () => void; onCancel?: () => void; onRestart?: () => void; }
export interface SelectionCardProps { text: string; sourceApp?: string; expiresIn?: number; canPaste?: boolean; onClear?: () => void; }
export interface AIResponseProps { title?: string; meta?: string; streaming?: boolean; error?: string; errorTitle?: string; sourceApp?: string; canInsert?: boolean; onInsert?: () => void; onCopy?: () => void; onRegenerate?: () => void; onStop?: () => void; onRetry?: () => void; children?: ReactNode; }
export interface PromptComposerProps { onSubmit?: (text: string) => void; placeholder?: string; rows?: number; maxLength?: number; defaultValue?: string; onDictate?: () => void; dictating?: boolean; dictationDisabled?: boolean; dictationLabel?: string; busy?: boolean; onStop?: () => void; submitLabel?: string; tools?: ReactNode; }

export declare function IconButton(p: IconButtonProps): JSX.Element;
export declare function TextField(p: TextFieldProps): JSX.Element;
export declare function TextArea(p: TextAreaProps): JSX.Element;
export declare function Select(p: SelectProps): JSX.Element;
export declare function Checkbox(p: CheckboxProps): JSX.Element;
export declare function RadioGroup(p: RadioGroupProps): JSX.Element;
export declare function Switch(p: SwitchProps): JSX.Element;
export declare function SegmentedControl(p: SegmentedControlProps): JSX.Element;
export declare function Alert(p: AlertProps): JSX.Element;
export declare function Toast(p: ToastProps): JSX.Element;
export declare function Spinner(p: SpinnerProps): JSX.Element;
export declare function ProgressBar(p: ProgressBarProps): JSX.Element;
export declare function Skeleton(p: SkeletonProps): JSX.Element;
export declare function Tooltip(p: TooltipProps): JSX.Element;
export declare function EmptyState(p: EmptyStateProps): JSX.Element;
export declare function StatusIndicator(p: StatusIndicatorProps): JSX.Element;
export declare function Dialog(p: DialogProps): JSX.Element | null;
export declare function Menu(p: MenuProps): JSX.Element;
export declare function Drawer(p: DrawerProps): JSX.Element | null;
export declare function DataTable<R>(p: DataTableProps<R>): JSX.Element;
export declare function Pagination(p: PaginationProps): JSX.Element;
export declare function PropertyList(p: PropertyListProps): JSX.Element;
export declare function CodeBlock(p: CodeBlockProps): JSX.Element;
export declare function Code(p: { children: ReactNode }): JSX.Element;
export declare function Kbd(p: KbdProps): JSX.Element;
export declare function ShortcutHint(p: ShortcutHintProps): JSX.Element;
export declare function Avatar(p: AvatarProps): JSX.Element;
export declare function Chip(p: ChipProps): JSX.Element;
export declare function Accordion(p: AccordionProps): JSX.Element;
export declare function Stepper(p: StepperProps): JSX.Element;
export declare function Breadcrumbs(p: BreadcrumbsProps): JSX.Element;
export declare function Link(p: LinkProps): JSX.Element;
export declare function SettingsRow(p: SettingsRowProps): JSX.Element;
export declare function PairingCode(p: PairingCodeProps): JSX.Element;
export declare function SelectionCard(p: SelectionCardProps): JSX.Element;
export declare function AIResponse(p: AIResponseProps): JSX.Element;
export declare function PromptComposer(p: PromptComposerProps): JSX.Element;

/* ---- Layout ---- */
export interface AppShellProps { banner?: ReactNode; brand?: { name: string; subtitle?: string; logo?: string }; nav?: ReactNode; sidebarFooter?: ReactNode; search?: ReactNode; actions?: ReactNode; rail?: ReactNode; wide?: boolean; children?: ReactNode; }
export interface PageHeaderProps { title: ReactNode; description?: ReactNode; badge?: ReactNode; breadcrumbs?: ReactNode; actions?: ReactNode; }
export declare function AppShell(p: AppShellProps): JSX.Element;
export declare function PageHeader(p: PageHeaderProps): JSX.Element;

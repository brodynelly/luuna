/** Ledger Tailwind preset: maps utilities to the CSS variables in tokens.css (import tokens.css once). */
module.exports = {
  darkMode: ['selector', '[data-theme="dark"]'],
  theme: { extend: {
    "colors": {
      "surface": "var(--surface)",
      "surface-raised": "var(--surface-raised)",
      "surface-muted": "var(--surface-muted)",
      "fill": "var(--fill)",
      "fill-strong": "var(--fill-strong)",
      "control-selected": "var(--control-selected)",
      "surface-overlay": "var(--surface-overlay)",
      "field": "var(--field)",
      "scrim": "var(--scrim)",
      "banner": "var(--banner)",
      "separator": "var(--separator)",
      "border": "var(--border)",
      "border-strong": "var(--border-strong)",
      "ink": "var(--ink)",
      "ink-body": "var(--ink-body)",
      "ink-muted": "var(--ink-muted)",
      "ink-subdued": "var(--ink-subdued)",
      "ink-disabled": "var(--ink-disabled)",
      "ink-on-banner": "var(--ink-on-banner)",
      "accent": "var(--accent)",
      "accent-hover": "var(--accent-hover)",
      "ink-on-accent": "var(--ink-on-accent)",
      "accent-text": "var(--accent-text)",
      "accent-soft": "var(--accent-soft)",
      "focus-ring": "var(--focus-ring)",
      "toast": "var(--toast)",
      "ink-on-toast": "var(--ink-on-toast)",
      "toast-action": "var(--toast-action)",
      "chart-1": "var(--chart-1)",
      "chart-2": "var(--chart-2)",
      "chart-3": "var(--chart-3)",
      "chart-4": "var(--chart-4)",
      "chart-5": "var(--chart-5)",
      "ai": "var(--ai)",
      "chart-muted": "var(--chart-muted)",
      "chart-grid": "var(--chart-grid)",
      "success": "var(--success)",
      "success-soft": "var(--success-soft)",
      "danger": "var(--danger)",
      "ink-on-danger": "var(--ink-on-danger)",
      "danger-soft": "var(--danger-soft)",
      "warning": "var(--warning)",
      "warning-soft": "var(--warning-soft)",
      "info": "var(--info)",
      "info-soft": "var(--info-soft)"
    },
    "spacing": {
      "1": "var(--space-1)",
      "2": "var(--space-2)",
      "3": "var(--space-3)",
      "4": "var(--space-4)",
      "5": "var(--space-5)",
      "6": "var(--space-6)",
      "8": "var(--space-8)",
      "12": "var(--space-12)"
    },
    "borderRadius": {
      "sm": "var(--radius-sm)",
      "md": "var(--radius-md)",
      "lg": "var(--radius-lg)",
      "xl": "var(--radius-xl)",
      "full": "var(--radius-full)"
    },
    "boxShadow": {
      "button": "var(--shadow-button)",
      "card": "var(--shadow-card)",
      "popover": "var(--shadow-popover)"
    },
    "fontFamily": {
      "sans": [
        "var(--font-sans)"
      ],
      "mono": [
        "var(--font-mono)"
      ]
    }
  } }
};

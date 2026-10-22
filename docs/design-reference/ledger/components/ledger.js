/* @ds-bundle: {"format":4,"namespace":"Ledger","components":[{"name":"Button"},{"name":"Badge"},{"name":"Icon"},{"name":"Banner"},{"name":"Callout"},{"name":"NavItem"},{"name":"Tabs"},{"name":"SearchField"},{"name":"MetricCard"},{"name":"SettingsLink"},{"name":"LegendList"},{"name":"IconButton"},{"name":"TextField"},{"name":"TextArea"},{"name":"Select"},{"name":"Checkbox"},{"name":"RadioGroup"},{"name":"Switch"},{"name":"SegmentedControl"},{"name":"Alert"},{"name":"Toast"},{"name":"Spinner"},{"name":"ProgressBar"},{"name":"Skeleton"},{"name":"Tooltip"},{"name":"EmptyState"},{"name":"StatusIndicator"},{"name":"Dialog"},{"name":"Menu"},{"name":"Drawer"},{"name":"DataTable"},{"name":"Pagination"},{"name":"PropertyList"},{"name":"CodeBlock"},{"name":"Code"},{"name":"Kbd"},{"name":"Avatar"},{"name":"Chip"},{"name":"Accordion"},{"name":"Stepper"},{"name":"Breadcrumbs"},{"name":"Link"},{"name":"SettingsRow"},{"name":"PairingCode"},{"name":"SelectionCard"},{"name":"AIResponse"},{"name":"PromptComposer"},{"name":"ShortcutHint"},{"name":"AppShell"},{"name":"PageHeader"}]} */
(function () {
  var R = window.React, h = R.createElement;
  function cx() { return Array.prototype.filter.call(arguments, Boolean).join(' '); }

  var P = {
    home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z',
    balance: 'M4 6h10M4 12h7M4 18h7M17 15a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
    card: 'M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM3 10h18',
    receipt: 'M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6',
    chart: 'M4 4v16h16M8 16v-4M12 16V8M16 16v-6',
    grid: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
    more: 'M6 12h.01M12 12h.01M18 12h.01',
    plus: 'M12 5v14M5 12h14',
    chevron: 'm6 9 6 6 6-6',
    search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4',
    info: 'M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zM12 11v5M12 8h.01',
    close: 'M6 6l12 12M18 6 6 18',
    bulb: 'M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z',
    gear: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1',
    bell: 'M6 16V11a6 6 0 1 1 12 0v5l2 2H4zM10 21h4',
    user: 'M12 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM4 21a8 8 0 0 1 16 0',
    mail: 'M3 6h18v12H3zM3 7l9 6 9-6',
    terminal: 'M4 5h16v14H4zM8 10l3 2-3 2M13 15h3',
    lock: 'M6 11h12v9H6zM9 11V8a3 3 0 0 1 6 0v3',
    bank: 'M3 10h18L12 4zM5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 20h18',
    globe: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18',
    doc: 'M6 3h9l3 3v15H6zM9 11h6M9 15h6',
    arrow: 'M5 12h14M13 6l6 6-6 6',
    check: 'm5 12 5 5 9-10',
    alert: 'M12 4 2.5 20h19zM12 10v4M12 17h.01',
    pencil: 'M4 20h4L19 9l-4-4L4 16zM14 6l4 4',
    'check-circle': 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM8 12l3 3 5-6',
    'x-circle': 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM9 9l6 6M15 9l-6 6',
    'arrow-up': 'M12 19V5M6 11l6-6 6 6',
    'arrow-down': 'M12 5v14M6 13l6 6 6-6',
    'chevron-left': 'm15 6-6 6 6 6',
    'chevron-right': 'm9 6 6 6-6 6',
    copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
    external: 'M14 4h6v6M20 4l-9 9M18 14v6H4V6h6',
    refresh: 'M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5',
    clipboard: 'M9 4h6v3H9zM9 5H6v16h12V5h-3',
    sparkle: 'M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z',
    insert: 'M4 12h11M11 8l4 4-4 4M20 5v14',
    stop: 'M7 7h10v10H7z',
    send: 'M4 12 20 4l-5 16-3-7zM12 13l8-9',
    mic: 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v3',
    download: 'M12 4v11M7 10l5 5 5-5M4 20h16',
    upload: 'M12 20V9M7 14l5-5 5 5M4 4h16',
    folder: 'M3 6h6l2 2h10v11H3z',
    file: 'M6 3h8l4 4v14H6zM14 3v4h4',
    server: 'M4 4h16v6H4zM4 14h16v6H4zM8 7h.01M8 17h.01',
    'wifi-off': 'M3 3l18 18M8.5 16.5a5 5 0 0 1 7 0M5 13a10 10 0 0 1 5-2.7M19 13a10 10 0 0 0-3-2M2 9.5a15 15 0 0 1 4.5-3M12 20h.01',
    link: 'M10 14a4 4 0 0 0 6 0l3-3a4 4 0 0 0-6-6l-1 1M14 10a4 4 0 0 0-6 0l-3 3a4 4 0 0 0 6 6l1-1',
    key: 'M8 11a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM11 13l9-9M17 7l3 3',
    keyboard: 'M3 6h18v12H3zM7 10h.01M11 10h.01M15 10h.01M8 14h8',
    filter: 'M4 5h16l-6 8v6l-4-2v-4z',
    trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
    clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2',
    shield: 'M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z',
    monitor: 'M3 4h18v12H3zM8 20h8M12 16v4',
    logout: 'M10 4H4v16h6M15 8l4 4-4 4M19 12H9',
    sun: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M5 19l1.5-1.5M17.5 6.5 19 5',
    moon: 'M20 14A8 8 0 1 1 10 4a6 6 0 0 0 10 10z',
    'zoom-in': 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4M8 11h6M11 8v6',
    'zoom-out': 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4M8 11h6',
    image: 'M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15 9h.01',
    video: 'M3 6h13v12H3zM16 10l5-3v10l-5-3',
    music: 'M9 18V5l11-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM20 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z',
    archive: 'M3 4h18v4H3zM5 8v12h14V8M10 12h4',
    help: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.5v.7M12 17h.01'
  };

  function Icon(p) {
    var s = p.size || 16;
    return h('svg', { className: cx('lg-icon', p.className), width: s, height: s, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: p.strokeWidth || 1.75, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': p.label ? undefined : 'true', role: p.label ? 'img' : undefined, 'aria-label': p.label },
      h('path', { d: P[p.name] || P.info }));
  }
  Icon.names = Object.keys(P);

  function Button(p) {
    var v = p.variant || 'secondary';
    var rest = Object.assign({}, p); delete rest.variant; delete rest.size; delete rest.icon; delete rest.iconRight; delete rest.children; delete rest.className;
    return h('button', Object.assign({ type: 'button' }, rest, { className: cx('lg-btn', 'lg-btn-' + v, p.size === 'md' && 'lg-btn-md', p.className) }),
      p.icon && h(Icon, { name: p.icon, size: 14 }), p.children, p.iconRight && h(Icon, { name: p.iconRight, size: 14 }));
  }

  function Badge(p) {
    return h('span', { className: cx('lg-badge', 'lg-badge-' + (p.tone || 'neutral')) }, p.icon && h(Icon, { name: p.icon, size: 12, strokeWidth: 2.25 }), p.children);
  }

  function Banner(p) {
    return h('div', { className: 'lg-banner', role: 'status' },
      h('span', { className: 'lg-banner-label' }, p.label || 'Sandbox', h(Icon, { name: 'info', size: 14 })),
      h('span', { className: 'lg-banner-msg' }, p.children),
      p.action && h(Button, { variant: 'primary', onClick: p.onAction }, p.action));
  }

  function Callout(p) {
    return h('div', { className: 'lg-callout' },
      h(Icon, { name: p.icon || 'bulb', size: 18 }),
      h('div', { className: 'lg-callout-body' }, p.children),
      p.action && h('a', { className: 'lg-link', href: p.href || '#' }, p.action),
      p.onDismiss !== false && h('button', { className: 'lg-callout-x', 'aria-label': 'Dismiss', onClick: p.onDismiss }, h(Icon, { name: 'close', size: 16 })));
  }

  function NavItem(p) {
    return h('a', { className: cx('lg-nav', p.active && 'lg-nav-active'), href: p.href || '#', 'aria-current': p.active ? 'page' : undefined, onClick: p.onClick },
      p.icon && h(Icon, { name: p.icon, size: 18 }),
      h('span', { className: 'lg-nav-label' }, p.label),
      p.trailing && h('span', { className: 'lg-nav-trail' }, h(Icon, { name: p.trailing === 'plus' ? 'plus' : 'chevron', size: 14 })));
  }
  function NavGroup(p) {
    return h('nav', { className: 'lg-navgroup', 'aria-label': p.label || undefined }, p.label && h('div', { className: 'lg-navlabel' }, p.label), p.children);
  }
  NavItem.Group = NavGroup;

  function Tabs(p) {
    var st = R.useState(p.defaultValue || (p.items[0] && p.items[0].value)), cur = p.value != null ? p.value : st[0];
    return h('div', { className: 'lg-tabs', role: 'tablist' }, p.items.map(function (it) {
      var on = it.value === cur;
      return h('button', { key: it.value, role: 'tab', 'aria-selected': on, className: cx('lg-tab', on && 'lg-tab-on'), onClick: function () { st[1](it.value); p.onChange && p.onChange(it.value); } }, it.label);
    }));
  }

  function SearchField(p) {
    return h('label', { className: 'lg-search', style: p.width ? { width: p.width } : undefined },
      h(Icon, { name: 'search', size: 16 }),
      h('input', { type: 'search', placeholder: p.placeholder || 'Search', 'aria-label': p.placeholder || 'Search', defaultValue: p.defaultValue }),
      p.shortcut && h('span', { className: 'lg-kbd' }, p.shortcut));
  }

  function Spark(p) {
    var d = p.data, w = 300, ht = p.height || 96, n = d.length;
    var max = Math.max.apply(null, d.concat([1])), min = Math.min.apply(null, d.concat([0]));
    var pt = function (v, i) { return [(i / Math.max(n - 1, 1)) * w, ht - ((v - min) / ((max - min) || 1)) * (ht - 4) - 2]; };
    var cut = p.until != null ? p.until : n - 1;
    var a = d.slice(0, cut + 1).map(pt).map(function (q) { return q.join(','); }).join(' ');
    var last = pt(d[cut], cut);
    return h('svg', { viewBox: '0 0 ' + w + ' ' + ht, height: ht, preserveAspectRatio: 'none', role: 'img', 'aria-label': p.label },
      h('line', { x1: 0, y1: ht - 0.5, x2: w, y2: ht - 0.5, stroke: 'var(--chart-grid)', strokeWidth: 1, vectorEffect: 'non-scaling-stroke' }),
      cut < n - 1 && h('line', { x1: last[0], y1: ht - 1, x2: w, y2: ht - 1, stroke: 'var(--chart-muted)', strokeWidth: 2, strokeDasharray: '3 3', vectorEffect: 'non-scaling-stroke' }),
      h('polyline', { points: a, fill: 'none', stroke: 'var(--chart-1)', strokeWidth: 2, strokeLinejoin: 'round', strokeLinecap: 'round', vectorEffect: 'non-scaling-stroke' }));
  }

  function MetricCard(p) {
    var empty = !p.data || !p.data.length;
    return h('section', { className: 'lg-card' },
      h('div', { className: 'lg-card-title' }, p.title, h(Icon, { name: 'info', size: 13 })),
      p.value != null && h('div', { className: 'lg-card-value' }, p.value),
      (p.comparison || p.delta) && h('div', { className: 'lg-card-cmp' }, p.delta && h('span', { className: p.delta.charAt(0) === '-' ? 'lg-delta-down' : 'lg-delta-up' }, p.delta + ' '), p.comparison),
      empty ? h('div', { className: 'lg-empty' }, h('span', { className: 'lg-empty-pill' }, p.emptyLabel || 'No data'))
        : h('div', { className: 'lg-card-chart' }, h(Spark, { data: p.data, until: p.until, height: p.chartHeight, label: p.title + ' trend' }),
            (p.start || p.end) && h('div', { className: 'lg-axis' }, h('span', null, p.start), h('span', null, p.end))),
      (p.updated || p.href) && h('div', { className: 'lg-card-foot' }, h('span', null, p.updated), p.href && h('a', { className: 'lg-link', href: p.href }, p.linkLabel || 'More details')));
  }

  function SettingsLink(p) {
    return h('a', { className: 'lg-set', href: p.href || '#' },
      h('span', { className: 'lg-set-well' }, h(Icon, { name: p.icon || 'gear', size: 16 })),
      h('span', null, h('div', { className: 'lg-set-title' }, p.title), p.description && h('div', { className: 'lg-set-desc' }, p.description)));
  }

  function LegendList(p) {
    var total = p.rows.reduce(function (s, r) { return s + (r.amount || 0); }, 0);
    return h('div', null,
      h('div', { className: 'lg-bar', role: 'img', 'aria-label': p.label || 'Breakdown' }, total > 0 && p.rows.map(function (r) {
        return h('span', { key: r.label, style: { width: (100 * (r.amount || 0) / total) + '%', background: 'var(--' + (r.color || 'chart-1') + ')' } });
      })),
      h('table', { className: 'lg-legend' },
        h('thead', null, h('tr', null, h('th', null, p.labelHeader || 'Type'), h('th', null, p.valueHeader || 'Amount'))),
        h('tbody', null, p.rows.map(function (r) {
          return h('tr', { key: r.label }, h('td', null, h('span', { className: 'lg-dot', style: { background: 'var(--' + (r.color || 'chart-1') + ')' } }), r.label), h('td', null, r.value));
        }))));
  }

  /* ---------- shared form bits ---------- */
  var uid = 0; function useId(p) { var r = R.useRef(null); if (!r.current) r.current = p || ('lg-f' + (++uid)); return r.current; }
  function Field(p) {
    return h('div', { className: cx('lg-field', p.error && 'lg-field-err', p.disabled && 'lg-field-dis') },
      p.label && h('label', { className: 'lg-label', htmlFor: p.id }, p.label, p.optional && h('span', { className: 'lg-opt' }, ' Optional')),
      p.children,
      (p.error || p.hint || p.counter) && h('div', { className: 'lg-help' },
        p.error ? h('span', { className: 'lg-err', id: p.id + '-msg' }, h(Icon, { name: 'alert', size: 12, strokeWidth: 2.25 }), p.error) : h('span', { id: p.id + '-msg' }, p.hint),
        p.counter && h('span', { className: cx('lg-count', p.over && 'lg-count-over') }, p.counter)));
  }

  function IconButton(p) {
    return h('button', { type: 'button', className: cx('lg-ibtn', p.variant === 'filled' && 'lg-ibtn-filled', p.active && 'lg-ibtn-on'), 'aria-label': p.label, title: p.label, onClick: p.onClick, disabled: p.disabled },
      h(Icon, { name: p.icon, size: p.size || 18 }), p.dot && h('span', { className: 'lg-ibtn-dot' }));
  }

  function TextField(p) {
    var id = useId(p.id);
    return h(Field, { id: id, label: p.label, hint: p.hint, error: p.error, optional: p.optional, disabled: p.disabled },
      h('div', { className: cx('lg-input', p.mono && 'lg-mono') },
        p.icon && h(Icon, { name: p.icon, size: 16 }),
        p.prefix && h('span', { className: 'lg-affix' }, p.prefix),
        h('input', { id: id, type: p.type || 'text', placeholder: p.placeholder, defaultValue: p.defaultValue, value: p.value, onChange: p.onChange, disabled: p.disabled, required: p.required, 'aria-invalid': !!p.error, 'aria-describedby': (p.error || p.hint) ? id + '-msg' : undefined, spellCheck: p.mono ? false : undefined, autoComplete: p.autoComplete }),
        p.suffix && h('span', { className: 'lg-affix' }, p.suffix)));
  }

  function TextArea(p) {
    var id = useId(p.id), st = R.useState(p.defaultValue || ''), v = p.value != null ? p.value : st[0];
    var n = v.length, over = p.maxLength && n > p.maxLength; /* String.length counts UTF-16 units */
    return h(Field, { id: id, label: p.label, hint: p.hint, error: p.error || (over ? 'Shorten this to ' + p.maxLength.toLocaleString() + ' characters or fewer. Nothing was cut off.' : null), counter: p.maxLength ? n.toLocaleString() + ' / ' + p.maxLength.toLocaleString() : null, over: over },
      h('textarea', { id: id, className: 'lg-textarea', rows: p.rows || 4, placeholder: p.placeholder, value: v, disabled: p.disabled, 'aria-invalid': !!(p.error || over), onChange: function (e) { st[1](e.target.value); p.onChange && p.onChange(e); } }));
  }

  function Select(p) {
    var id = useId(p.id);
    return h(Field, { id: id, label: p.label, hint: p.hint, error: p.error, disabled: p.disabled },
      h('div', { className: 'lg-select' },
        h('select', { id: id, defaultValue: p.defaultValue, value: p.value, onChange: p.onChange, disabled: p.disabled, 'aria-invalid': !!p.error },
          (p.options || []).map(function (o) { o = typeof o === 'string' ? { value: o, label: o } : o; return h('option', { key: o.value, value: o.value, disabled: o.disabled }, o.label); })),
        h(Icon, { name: 'chevron', size: 14 })));
  }

  function Checkbox(p) {
    var ref = R.useRef(null);
    R.useEffect(function () { if (ref.current) ref.current.indeterminate = !!p.indeterminate; });
    return h('label', { className: cx('lg-check', p.disabled && 'lg-check-dis') },
      h('input', { ref: ref, type: 'checkbox', checked: p.checked, defaultChecked: p.defaultChecked, disabled: p.disabled, onChange: p.onChange }),
      h('span', { className: 'lg-check-box', 'aria-hidden': 'true' }, h(Icon, { name: 'check', size: 12, strokeWidth: 3 }), h('span', { className: 'lg-check-dash' })),
      (p.label || p.description) && h('span', { className: 'lg-check-text' }, h('span', { className: 'lg-check-label' }, p.label), p.description && h('span', { className: 'lg-check-desc' }, p.description)));
  }

  function RadioGroup(p) {
    var name = useId(p.name);
    return h('fieldset', { className: 'lg-fieldset' },
      p.label && h('legend', { className: 'lg-label' }, p.label),
      (p.options || []).map(function (o) {
        return h('label', { key: o.value, className: cx('lg-check', 'lg-radio', o.disabled && 'lg-check-dis') },
          h('input', { type: 'radio', name: name, value: o.value, defaultChecked: p.defaultValue === o.value, disabled: o.disabled, onChange: function () { p.onChange && p.onChange(o.value); } }),
          h('span', { className: 'lg-check-box', 'aria-hidden': 'true' }),
          h('span', { className: 'lg-check-text' }, h('span', { className: 'lg-check-label' }, o.label), o.description && h('span', { className: 'lg-check-desc' }, o.description)));
      }));
  }

  function Switch(p) {
    return h('label', { className: cx('lg-switch', p.disabled && 'lg-check-dis') },
      (p.label || p.description) && h('span', { className: 'lg-check-text' }, h('span', { className: 'lg-check-label' }, p.label), p.description && h('span', { className: 'lg-check-desc' }, p.description)),
      h('input', { type: 'checkbox', role: 'switch', checked: p.checked, defaultChecked: p.defaultChecked, disabled: p.disabled, onChange: p.onChange, 'aria-label': p.label ? undefined : p.ariaLabel }),
      h('span', { className: 'lg-switch-track', 'aria-hidden': 'true' }, h('span', { className: 'lg-switch-knob' })));
  }

  function SegmentedControl(p) {
    var st = R.useState(p.defaultValue || (p.items[0] && p.items[0].value)), cur = p.value != null ? p.value : st[0];
    return h('div', { className: 'lg-seg', role: 'radiogroup', 'aria-label': p.label }, p.items.map(function (it) {
      var on = it.value === cur;
      return h('button', { key: it.value, type: 'button', role: 'radio', 'aria-checked': on, className: cx('lg-seg-btn', on && 'lg-seg-on'), onClick: function () { st[1](it.value); p.onChange && p.onChange(it.value); } }, it.icon && h(Icon, { name: it.icon, size: 14 }), it.label);
    }));
  }

  /* ---------- feedback ---------- */
  var TONE_ICON = { info: 'info', success: 'check-circle', warning: 'alert', danger: 'x-circle', neutral: 'info' };
  function Alert(p) {
    var tone = p.tone || 'info';
    return h('div', { className: cx('lg-alert', 'lg-alert-' + tone), role: tone === 'danger' ? 'alert' : 'status' },
      h('span', { className: 'lg-alert-icon' }, h(Icon, { name: p.icon || TONE_ICON[tone], size: 18 })),
      h('div', { className: 'lg-alert-body' }, p.title && h('div', { className: 'lg-alert-title' }, p.title), p.children && h('div', { className: 'lg-alert-text' }, p.children),
        p.actions && h('div', { className: 'lg-alert-actions' }, p.actions)),
      p.onDismiss && h('button', { className: 'lg-callout-x', 'aria-label': 'Dismiss', onClick: p.onDismiss }, h(Icon, { name: 'close', size: 16 })));
  }

  function Toast(p) {
    var tone = p.tone || 'neutral';
    return h('div', { className: cx('lg-toast', p.inline && 'lg-toast-inline'), role: 'status', 'aria-live': 'polite' },
      tone !== 'neutral' && h('span', { className: 'lg-toast-icon lg-toast-' + tone }, h(Icon, { name: TONE_ICON[tone], size: 16 })),
      h('span', { className: 'lg-toast-msg' }, p.children),
      p.action && h('button', { className: 'lg-toast-action', onClick: p.onAction }, p.action),
      p.onDismiss && h('button', { className: 'lg-toast-x', 'aria-label': 'Dismiss', onClick: p.onDismiss }, h(Icon, { name: 'close', size: 14 })));
  }

  function Spinner(p) {
    var s = p.size || 16;
    return h('span', { className: 'lg-spinner-wrap', role: 'status' },
      h('svg', { className: 'lg-spinner', width: s, height: s, viewBox: '0 0 24 24', 'aria-hidden': 'true' },
        h('circle', { cx: 12, cy: 12, r: 9, fill: 'none', stroke: 'var(--fill-strong)', strokeWidth: 3 }),
        h('path', { d: 'M21 12a9 9 0 0 0-9-9', fill: 'none', stroke: 'var(--accent)', strokeWidth: 3, strokeLinecap: 'round' })),
      p.label ? h('span', { className: 'lg-spinner-label' }, p.label) : h('span', { className: 'lg-sr' }, 'Loading'));
  }

  function ProgressBar(p) {
    var pct = p.indeterminate ? null : Math.max(0, Math.min(100, 100 * (p.value || 0) / (p.max || 100)));
    return h('div', { className: 'lg-progress' },
      (p.label || p.detail) && h('div', { className: 'lg-progress-top' }, h('span', { className: 'lg-progress-label' }, p.label), h('span', { className: 'lg-progress-detail' }, p.detail != null ? p.detail : (pct != null ? Math.round(pct) + '%' : ''))),
      h('div', { className: cx('lg-progress-track', p.indeterminate && 'lg-progress-ind', p.tone && 'lg-progress-' + p.tone), role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': pct != null ? Math.round(pct) : undefined, 'aria-label': p.label },
        h('span', { style: pct != null ? { width: pct + '%' } : undefined })));
  }

  function Skeleton(p) {
    if (p.circle) return h('span', { className: 'lg-skel', style: { width: p.size || 32, height: p.size || 32, borderRadius: '50%' } });
    var n = p.lines || 1, out = [];
    for (var i = 0; i < n; i++) out.push(h('span', { key: i, className: 'lg-skel', style: { width: i === n - 1 && n > 1 ? '60%' : (p.width || '100%'), height: p.height || 12 } }));
    return h('span', { className: 'lg-skel-stack', 'aria-hidden': 'true' }, out);
  }

  function Tooltip(p) {
    var st = R.useState(false), open = p.open || st[0];
    return h('span', { className: 'lg-tip-wrap', onMouseEnter: function () { st[1](true); }, onMouseLeave: function () { st[1](false); }, onFocus: function () { st[1](true); }, onBlur: function () { st[1](false); } },
      p.children, open && h('span', { className: cx('lg-tip', 'lg-tip-' + (p.side || 'top')), role: 'tooltip' }, p.content));
  }

  function EmptyState(p) {
    return h('div', { className: cx('lg-emptystate', p.bordered !== false && 'lg-emptystate-b') },
      p.icon && h('span', { className: 'lg-set-well lg-emptystate-icon' }, h(Icon, { name: p.icon, size: 20 })),
      h('div', { className: 'lg-emptystate-title' }, p.title),
      p.description && h('div', { className: 'lg-emptystate-desc' }, p.description),
      p.action && h('div', { className: 'lg-emptystate-act' }, p.action));
  }

  function StatusIndicator(p) {
    var s = p.status || 'idle';
    return h('span', { className: cx('lg-status', 'lg-status-' + s), role: 'status' },
      s === 'connecting' ? h(Spinner, { size: 12 }) : h('span', { className: 'lg-status-dot', 'aria-hidden': 'true' }),
      h('span', { className: 'lg-status-label' }, p.label), p.detail && h('span', { className: 'lg-status-detail' }, p.detail));
  }

  /* ---------- overlays ---------- */
  function Dialog(p) {
    if (p.open === false) return null;
    var body = h('div', { className: cx('lg-dialog', p.wide && 'lg-dialog-wide'), role: p.tone === 'danger' ? 'alertdialog' : 'dialog', 'aria-modal': 'true', 'aria-label': p.title },
      h('div', { className: 'lg-dialog-head' }, h('h2', { className: 'lg-dialog-title' }, p.title), p.onClose && h(IconButton, { icon: 'close', label: 'Close', onClick: p.onClose })),
      p.description && h('p', { className: 'lg-dialog-desc' }, p.description),
      p.children && h('div', { className: 'lg-dialog-body' }, p.children),
      p.actions && h('div', { className: 'lg-dialog-foot' }, p.actions));
    return h('div', { className: cx('lg-scrim', p.inline && 'lg-scrim-inline') }, body);
  }

  function Menu(p) {
    var st = R.useState(!!p.open), open = st[0];
    return h('div', { className: 'lg-menu-wrap' },
      p.trigger !== false && h(Button, { variant: p.triggerVariant || 'secondary', iconRight: 'chevron', icon: p.triggerIcon, onClick: function () { st[1](!open); }, 'aria-expanded': open, 'aria-haspopup': 'menu' }, p.label || 'Actions'),
      open && h('div', { className: cx('lg-menu', p.trigger === false && 'lg-menu-static'), role: 'menu' }, p.items.map(function (it, i) {
        if (it.divider) return h('div', { key: 'd' + i, className: 'lg-menu-sep', role: 'separator' });
        if (it.heading) return h('div', { key: 'h' + i, className: 'lg-menu-head' }, it.heading);
        return h('button', { key: it.label, role: 'menuitem', className: cx('lg-menu-item', it.tone === 'danger' && 'lg-menu-danger'), disabled: it.disabled, onClick: function () { it.onSelect && it.onSelect(); st[1](false); } },
          it.icon && h(Icon, { name: it.icon, size: 16 }), h('span', { className: 'lg-menu-label' }, it.label), it.shortcut && h(Kbd, { keys: it.shortcut }));
      })));
  }

  function Drawer(p) {
    if (p.open === false) return null;
    var panel = h('aside', { className: 'lg-drawer', role: 'dialog', 'aria-label': p.title },
      h('div', { className: 'lg-drawer-head' }, p.icon && h(Icon, { name: p.icon, size: 18, className: p.icon === 'sparkle' ? 'lg-ai-ic' : '' }), h('h2', { className: 'lg-dialog-title' }, p.title), h('span', { style: { flex: 1 } }), p.headerActions, p.onClose && h(IconButton, { icon: 'close', label: 'Close', onClick: p.onClose })),
      h('div', { className: 'lg-drawer-body' }, p.children),
      p.footer && h('div', { className: 'lg-drawer-foot' }, p.footer));
    return p.inline ? h('div', { className: 'lg-drawer-inline' }, panel) : h('div', { className: 'lg-scrim lg-scrim-right' }, panel);
  }

  /* ---------- data ---------- */
  function DataTable(p) {
    var st = R.useState(p.sort || null), sort = st[0], sel = R.useState({}), picked = sel[0];
    var rows = (p.rows || []).slice();
    if (sort) rows.sort(function (a, b) { var x = a[sort.key], y = b[sort.key]; return (x > y ? 1 : x < y ? -1 : 0) * (sort.dir === 'desc' ? -1 : 1); });
    var all = rows.length && rows.every(function (r) { return picked[r.id]; });
    return h('div', { className: 'lg-table-wrap' },
      h('table', { className: 'lg-table' },
        h('thead', null, h('tr', null,
          p.selectable && h('th', { className: 'lg-td-check' }, h(Checkbox, { checked: !!all, indeterminate: !all && Object.keys(picked).some(function (k) { return picked[k]; }), onChange: function () { var n = {}; if (!all) rows.forEach(function (r) { n[r.id] = true; }); sel[1](n); } })),
          p.columns.map(function (c) {
            var on = sort && sort.key === c.key;
            return h('th', { key: c.key, style: { width: c.width, textAlign: c.align }, 'aria-sort': on ? (sort.dir === 'desc' ? 'descending' : 'ascending') : undefined },
              c.sortable ? h('button', { className: cx('lg-th-sort', on && 'lg-th-on'), onClick: function () { st[1]({ key: c.key, dir: on && sort.dir === 'asc' ? 'desc' : 'asc' }); } }, c.label, h(Icon, { name: on && sort.dir === 'desc' ? 'arrow-down' : 'arrow-up', size: 12 })) : c.label);
          }))),
        h('tbody', null, rows.length ? rows.map(function (r) {
          return h('tr', { key: r.id, className: picked[r.id] ? 'lg-tr-on' : undefined, onClick: p.onRowClick ? function () { p.onRowClick(r); } : undefined, style: p.onRowClick ? { cursor: 'pointer' } : undefined },
            p.selectable && h('td', { className: 'lg-td-check', onClick: function (e) { e.stopPropagation(); } }, h(Checkbox, { checked: !!picked[r.id], onChange: function () { var n = Object.assign({}, picked); n[r.id] = !n[r.id]; sel[1](n); } })),
            p.columns.map(function (c) { return h('td', { key: c.key, style: { textAlign: c.align }, className: cx(c.mono && 'lg-mono', c.muted && 'lg-td-muted', c.align === 'right' && 'lg-num') }, c.render ? c.render(r) : r[c.key]); }));
        }) : h('tr', null, h('td', { colSpan: p.columns.length + (p.selectable ? 1 : 0), className: 'lg-td-empty' }, p.empty || 'No results')))));
  }

  function Pagination(p) {
    var pages = Math.max(1, Math.ceil((p.total || 0) / (p.pageSize || 25))), st = R.useState(p.page || 1), cur = st[0];
    var from = p.total ? (cur - 1) * (p.pageSize || 25) + 1 : 0, to = Math.min(p.total || 0, cur * (p.pageSize || 25));
    var go = function (n) { st[1](n); p.onChange && p.onChange(n); };
    return h('nav', { className: 'lg-pager', 'aria-label': 'Pagination' },
      h('span', { className: 'lg-pager-count' }, from.toLocaleString() + '–' + to.toLocaleString() + ' of ' + (p.total || 0).toLocaleString() + ' ' + (p.noun || 'results')),
      h('span', { className: 'lg-pager-btns' },
        h(Button, { onClick: function () { go(cur - 1); }, disabled: cur <= 1, icon: 'chevron-left' }, 'Previous'),
        h(Button, { onClick: function () { go(cur + 1); }, disabled: cur >= pages, iconRight: 'chevron-right' }, 'Next')));
  }

  function PropertyList(p) {
    return h('dl', { className: cx('lg-props', p.horizontal && 'lg-props-h') }, (p.items || []).map(function (it) {
      return h('div', { key: it.label, className: 'lg-props-row' }, h('dt', null, it.label), h('dd', { className: it.mono ? 'lg-mono' : undefined }, it.value));
    }));
  }

  function useCopy() {
    var st = R.useState(false);
    return [st[0], function (text) { try { navigator.clipboard && navigator.clipboard.writeText(text); } catch (e) {} st[1](true); setTimeout(function () { st[1](false); }, 1600); }];
  }

  function CodeBlock(p) {
    var c = useCopy(), text = String(p.children || '');
    return h('div', { className: 'lg-code' },
      (p.title || p.copyable !== false) && h('div', { className: 'lg-code-head' }, h('span', null, p.title || p.language || ''),
        p.copyable !== false && h('button', { className: 'lg-code-copy', onClick: function () { c[1](text); } }, h(Icon, { name: c[0] ? 'check' : 'copy', size: 14 }), c[0] ? 'Copied' : 'Copy')),
      h('pre', null, h('code', null, text)));
  }
  function Code(p) { return h('code', { className: 'lg-inline-code' }, p.children); }

  function Kbd(p) {
    var keys = Array.isArray(p.keys) ? p.keys : String(p.keys || p.children || '').split('+');
    return h('span', { className: 'lg-kbds', 'aria-label': keys.join(' plus ') }, keys.map(function (k, i) { return h('kbd', { key: i, className: 'lg-kbd' }, k); }));
  }

  function Avatar(p) {
    var ini = (p.name || '?').split(/\s+/).map(function (w) { return w.charAt(0); }).slice(0, 2).join('').toUpperCase();
    var s = p.size || 28;
    return h('span', { className: cx('lg-avatar', p.square && 'lg-avatar-sq'), style: { width: s, height: s, fontSize: Math.round(s * 0.4) }, title: p.name },
      p.src ? h('img', { src: p.src, alt: p.name || '' }) : ini);
  }

  function Chip(p) {
    return h('span', { className: cx('lg-chip', p.selected && 'lg-chip-on') },
      h('button', { className: 'lg-chip-main', onClick: p.onClick, 'aria-pressed': p.onClick ? !!p.selected : undefined }, p.icon && h(Icon, { name: p.icon, size: 14 }), p.label && h('span', { className: 'lg-chip-key' }, p.label), p.children),
      p.onRemove && h('button', { className: 'lg-chip-x', 'aria-label': 'Remove filter', onClick: p.onRemove }, h(Icon, { name: 'close', size: 12, strokeWidth: 2.25 })));
  }

  function Accordion(p) {
    return h('div', { className: 'lg-acc' }, (p.items || []).map(function (it, i) {
      return h('details', { key: i, className: 'lg-acc-item', open: p.defaultOpen === i || undefined },
        h('summary', null, h('span', null, it.title), h(Icon, { name: 'chevron', size: 16 })),
        h('div', { className: 'lg-acc-body' }, it.content));
    }));
  }

  function Stepper(p) {
    return h('ol', { className: cx('lg-steps', p.horizontal && 'lg-steps-h') }, (p.steps || []).map(function (s, i) {
      var st = s.status || 'upcoming';
      return h('li', { key: i, className: 'lg-step lg-step-' + st, 'aria-current': st === 'current' ? 'step' : undefined },
        h('span', { className: 'lg-step-mark' }, st === 'done' ? h(Icon, { name: 'check', size: 12, strokeWidth: 3 }) : st === 'error' ? h(Icon, { name: 'close', size: 12, strokeWidth: 3 }) : i + 1),
        h('span', { className: 'lg-step-text' }, h('span', { className: 'lg-step-label' }, s.label), s.description && h('span', { className: 'lg-step-desc' }, s.description)));
    }));
  }

  function Breadcrumbs(p) {
    var items = p.items || [];
    return h('nav', { 'aria-label': 'Breadcrumb' }, h('ol', { className: 'lg-crumbs' }, items.map(function (it, i) {
      var last = i === items.length - 1;
      return h('li', { key: i }, last ? h('span', { 'aria-current': 'page' }, it.label) : h('a', { className: 'lg-link', href: it.href || '#' }, it.label), !last && h(Icon, { name: 'chevron-right', size: 12 }));
    })));
  }

  function Link(p) {
    return h('a', { className: cx('lg-link', p.subtle && 'lg-link-subtle'), href: p.href || '#', target: p.external ? '_blank' : undefined, rel: p.external ? 'noreferrer' : undefined, onClick: p.onClick },
      p.children, p.external && h(Icon, { name: 'external', size: 12 }));
  }

  function SettingsRow(p) {
    return h('div', { className: cx('lg-srow', p.stacked && 'lg-srow-stack') },
      h('div', { className: 'lg-srow-text' }, h('div', { className: 'lg-srow-title' }, p.title, p.badge), p.description && h('div', { className: 'lg-srow-desc' }, p.description), p.children),
      p.control && h('div', { className: 'lg-srow-ctl' }, p.control));
  }

  /* ---------- NAS Workspace specific ---------- */
  function fmtClock(s) { s = Math.max(0, s | 0); return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2); }
  function useCountdown(sec) {
    var st = R.useState(sec || 0);
    R.useEffect(function () { if (!sec) return; var t = setInterval(function () { st[1](function (v) { return v > 0 ? v - 1 : 0; }); }, 1000); return function () { clearInterval(t); }; }, [sec]);
    return st[0];
  }

  function PairingCode(p) {
    var left = useCountdown(p.expiresIn), c = useCopy(), code = p.code || '';
    var status = left === 0 && p.expiresIn ? 'expired' : (p.status || 'pending');
    var mid = Math.ceil(code.length / 2);
    return h('div', { className: 'lg-pair' },
      h('div', { className: 'lg-pair-label' }, 'Verification code'),
      h('div', { className: cx('lg-pair-code', status === 'expired' && 'lg-pair-dead'), 'aria-label': code.split('').join(' ') }, code.slice(0, mid), h('span', { className: 'lg-pair-dash' }, '-'), code.slice(mid)),
      h('div', { className: 'lg-pair-status' },
        status === 'pending' && h(StatusIndicator, { status: 'connecting', label: 'Waiting for approval in your browser', detail: p.expiresIn ? 'Expires in ' + fmtClock(left) : null }),
        status === 'approved' && h(StatusIndicator, { status: 'connected', label: 'Approved. This device is paired.' }),
        status === 'declined' && h(StatusIndicator, { status: 'error', label: 'Device sign-in was declined in the browser.' }),
        status === 'expired' && h(StatusIndicator, { status: 'offline', label: 'The device sign-in expired. Start again.' })),
      h('div', { className: 'lg-pair-actions' },
        status === 'expired' || status === 'declined' ? h(Button, { variant: 'primary', size: 'md', icon: 'refresh', onClick: p.onRestart }, 'Start again') : h(Button, { variant: 'primary', size: 'md', icon: 'external', onClick: p.onOpen }, 'Open verification page'),
        h(Button, { size: 'md', icon: c[0] ? 'check' : 'copy', onClick: function () { c[1](code); } }, c[0] ? 'Copied' : 'Copy code'),
        status === 'pending' && h(Button, { variant: 'ghost', size: 'md', onClick: p.onCancel }, 'Cancel')),
      p.url && h('div', { className: 'lg-pair-url' }, 'Or go to ', h('span', { className: 'lg-mono' }, p.url)));
  }

  function SelectionCard(p) {
    var left = useCountdown(p.expiresIn), text = p.text || '';
    var expired = p.expiresIn && left === 0;
    return h('section', { className: cx('lg-selcard', expired && 'lg-selcard-dead') },
      h('div', { className: 'lg-selcard-head' },
        h(Icon, { name: 'clipboard', size: 16 }),
        h('span', { className: 'lg-selcard-src' }, 'From ', h('strong', null, p.sourceApp || 'Previous application')),
        h('span', { style: { flex: 1 } }),
        expired ? h(Badge, { tone: 'neutral' }, 'Expired') : p.canPaste === false ? h(Badge, { tone: 'warning' }, 'Copy only') : p.expiresIn ? h('span', { className: 'lg-selcard-exp' }, 'Insert available for ' + fmtClock(left)) : null,
        p.onClear && h(IconButton, { icon: 'close', label: 'Clear selection', size: 16, onClick: p.onClear })),
      h('blockquote', { className: 'lg-selcard-text' }, text),
      h('div', { className: 'lg-selcard-foot' }, text.length.toLocaleString() + ' / 6,000 characters', p.canPaste === false && ' · Nothing is selected in an editable field, so the response can only be copied.'));
  }

  function AIResponse(p) {
    var c = useCopy(), text = typeof p.children === 'string' ? p.children : (p.text || '');
    return h('article', { className: cx('lg-ai', p.error && 'lg-ai-err'), 'aria-busy': !!p.streaming },
      h('div', { className: 'lg-ai-head' }, h(Icon, { name: 'sparkle', size: 16, className: 'lg-ai-ic' }), h('span', { className: 'lg-ai-title' }, p.title || 'Response'),
        p.streaming && h(Spinner, { size: 12, label: 'Writing…' }), p.meta && h('span', { className: 'lg-ai-meta' }, p.meta)),
      p.error ? h(Alert, { tone: 'danger', title: p.errorTitle || 'The response stopped', actions: p.onRetry && h(Button, { onClick: p.onRetry, icon: 'refresh' }, 'Retry') }, p.error)
        : h('div', { className: 'lg-ai-body' }, p.children, p.streaming && h('span', { className: 'lg-caret', 'aria-hidden': 'true' })),
      !p.streaming && !p.error && h('div', { className: 'lg-ai-actions' },
        p.onInsert !== undefined && h(Tooltip, { content: p.canInsert === false ? 'Capture a selection in an editable field first' : 'Replaces the selected text in ' + (p.sourceApp || 'the previous app') },
          h(Button, { variant: 'primary', icon: 'insert', disabled: p.canInsert === false, onClick: p.onInsert }, 'Insert into ' + (p.sourceApp || 'app'))),
        h(Button, { icon: c[0] ? 'check' : 'copy', onClick: function () { c[1](text); p.onCopy && p.onCopy(); } }, c[0] ? 'Copied' : 'Copy'),
        p.onStop === undefined && p.onRegenerate && h(Button, { variant: 'ghost', icon: 'refresh', onClick: p.onRegenerate }, 'Regenerate')),
      p.streaming && p.onStop && h('div', { className: 'lg-ai-actions' }, h(Button, { icon: 'stop', onClick: p.onStop }, 'Stop')));
  }

  function PromptComposer(p) {
    var max = p.maxLength || 6000, st = R.useState(p.defaultValue || ''), v = st[0], over = v.length > max;
    return h('form', { className: cx('lg-composer', over && 'lg-composer-over'), onSubmit: function (e) { e.preventDefault(); if (!over && v.trim()) p.onSubmit && p.onSubmit(v); } },
      h('textarea', { className: 'lg-composer-input', rows: p.rows || 3, placeholder: p.placeholder || 'Ask anything, or describe the change you want', value: v, onChange: function (e) { st[1](e.target.value); }, 'aria-label': 'Prompt', 'aria-invalid': over }),
      h('div', { className: 'lg-composer-bar' },
        p.onDictate !== undefined && h(IconButton, { icon: 'mic', label: p.dictationLabel || 'Dictate (Windows voice typing)', active: p.dictating, onClick: p.onDictate, disabled: p.dictationDisabled }),
        p.tools,
        h('span', { style: { flex: 1 } }),
        h('span', { className: cx('lg-count', over && 'lg-count-over') }, v.length.toLocaleString() + ' / ' + max.toLocaleString()),
        p.busy ? h(Button, { variant: 'secondary', icon: 'stop', onClick: p.onStop }, 'Stop') : h(Button, { variant: 'primary', icon: 'send', type: 'submit', disabled: over || !v.trim() }, p.submitLabel || 'Ask')));
  }

  function ShortcutHint(p) {
    return h('span', { className: 'lg-shint' }, h('span', null, p.label), h(Kbd, { keys: p.keys }));
  }

  /* ---------- layout ---------- */
  function AppShell(p) {
    var st = R.useState(false), navOpen = st[0];
    return h('div', { className: cx('lg-shell', navOpen && 'lg-shell-navopen') },
      p.banner,
      h('div', { className: 'lg-shell-body' },
        h('aside', { className: 'lg-sidebar', 'aria-label': 'Primary' },
          p.brand && h('div', { className: 'lg-brand' }, h(Avatar, { name: p.brand.name, src: p.brand.logo, square: true, size: 28 }),
            h('div', { className: 'lg-brand-text' }, h('div', { className: 'lg-brand-name' }, p.brand.name), p.brand.subtitle && h('div', { className: 'lg-brand-sub' }, p.brand.subtitle))),
          h('div', { className: 'lg-sidebar-nav' }, p.nav),
          p.sidebarFooter && h('div', { className: 'lg-sidebar-foot' }, p.sidebarFooter)),
        h('div', { className: 'lg-main' },
          h('header', { className: 'lg-topbar' },
            h('span', { className: 'lg-menu-btn' }, h(IconButton, { icon: 'grid', label: 'Menu', onClick: function () { st[1](!navOpen); } })),
            p.search, h('span', { className: 'lg-spacer' }), p.actions),
          h('main', { className: 'lg-content', id: 'main' }, h('div', { className: cx('lg-content-inner', p.wide && 'lg-content-wide') }, p.children)),
          p.rail)));
  }

  function PageHeader(p) {
    return h('div', { className: 'lg-pagehead' },
      p.breadcrumbs && h('div', { className: 'lg-pagehead-crumbs' }, p.breadcrumbs),
      h('div', { className: 'lg-pagehead-row' },
        h('div', { className: 'lg-pagehead-text' }, h('h1', { className: 'lg-pagehead-title' }, p.title, p.badge), p.description && h('p', { className: 'lg-pagehead-desc' }, p.description)),
        p.actions && h('div', { className: 'lg-pagehead-actions' }, p.actions)));
  }

  var api = { Button: Button, Badge: Badge, Icon: Icon, Banner: Banner, Callout: Callout, NavItem: NavItem, Tabs: Tabs, SearchField: SearchField, MetricCard: MetricCard, SettingsLink: SettingsLink, LegendList: LegendList, IconButton: IconButton, TextField: TextField, TextArea: TextArea, Select: Select, Checkbox: Checkbox, RadioGroup: RadioGroup, Switch: Switch, SegmentedControl: SegmentedControl, Alert: Alert, Toast: Toast, Spinner: Spinner, ProgressBar: ProgressBar, Skeleton: Skeleton, Tooltip: Tooltip, EmptyState: EmptyState, StatusIndicator: StatusIndicator, Dialog: Dialog, Menu: Menu, Drawer: Drawer, DataTable: DataTable, Pagination: Pagination, PropertyList: PropertyList, CodeBlock: CodeBlock, Code: Code, Kbd: Kbd, Avatar: Avatar, Chip: Chip, Accordion: Accordion, Stepper: Stepper, Breadcrumbs: Breadcrumbs, Link: Link, SettingsRow: SettingsRow, PairingCode: PairingCode, SelectionCard: SelectionCard, AIResponse: AIResponse, PromptComposer: PromptComposer, ShortcutHint: ShortcutHint, AppShell: AppShell, PageHeader: PageHeader };
  window.Ledger = Object.assign(window.Ledger || {}, api);
})();

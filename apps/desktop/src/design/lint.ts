// Pure stylesheet lint helpers for design-system.test.ts (ADR 0032 motion rules, ADR 0033). Every function takes
// comment-stripped CSS and returns a list of problems, so a fixture string can prove that a rule
// both accepts and rejects. No file access here.

export function declarations(css: string): Array<[string, string]> {
  return [...css.matchAll(/([-\w]+)\s*:\s*([^;{}]+)(?=[;}])/g)].map((match) => [match[1], match[2].trim()]);
}
export function rules(css: string): Array<{ selector: string; body: string }> {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({ selector: match[1].trim(), body: match[2] }));
}

/** Splits balanced `@name … { … }` blocks (keyframes, media) out of a sheet. */
export function splitAtRules(css: string, name: string): { inside: string[]; preludes: string[]; outside: string } {
  const inside: string[] = [];
  const preludes: string[] = [];
  let outside = "";
  const start = new RegExp(`@(?:-webkit-)?${name}\\b`, "g");
  let cursor = 0;
  for (let match = start.exec(css); match; match = start.exec(css)) {
    const open = css.indexOf("{", match.index);
    if (open < 0) break;
    let depth = 0;
    let close = open;
    for (; close < css.length; close++) {
      if (css[close] === "{") depth++;
      else if (css[close] === "}" && --depth === 0) break;
    }
    outside += css.slice(cursor, match.index);
    preludes.push(css.slice(match.index + 1, open).replace(/^\S+\s*/, "").trim());
    inside.push(css.slice(open + 1, close));
    cursor = close + 1;
    start.lastIndex = cursor;
  }
  return { inside, preludes, outside: outside + css.slice(cursor) };
}

const PSEUDO = /::(?:before|after|backdrop|view-transition-(?:old|new)\([^)]*\))$/;
const ANY_PSEUDO = /::[\w-]+(?:\([^)]*\))?$/;
const parts = (selector: string) => selector.split(",").map((part) => part.trim());
const OPACITY_MESSAGE = "opacity only inside @keyframes or as 0/1 on a decorative pseudo-element (ADR 0032)";

export function opacityProblems(css: string): string[] {
  const problems: string[] = [];
  const { inside, outside } = splitAtRules(css, "keyframes");
  for (const body of inside) {
    for (const [property, value] of declarations(body)) {
      const amount = Number(value);
      const ok = /^var\(--[\w-]+\)$/.test(value) || (/^\d*\.?\d+$/.test(value) && amount >= 0 && amount <= 1);
      if (property === "opacity" && !ok) problems.push(`${OPACITY_MESSAGE}: keyframe value ${value}`);
    }
  }
  for (const { selector, body } of rules(outside)) {
    for (const [property, value] of declarations(`${body};`)) {
      if (property !== "opacity") continue;
      if (!parts(selector).every((part) => PSEUDO.test(part)) || !/^[01]$/.test(value)) problems.push(`${OPACITY_MESSAGE}: ${selector} { opacity: ${value} }`);
    }
  }
  return problems;
}

const TIMING = /^(?:transition|transition-duration|transition-delay|transition-timing-function|animation|animation-duration|animation-delay|animation-timing-function)$/;
const EASING_WORD = /\b(?:ease|ease-in|ease-out|ease-in-out|linear|step-start|step-end)\b(?!-)|(?:cubic-bezier|steps|linear)\(/;

function topLevelItems(value: string): string[] {
  const items: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of value) {
    if (char === "(") depth++;
    if (char === ")") depth--;
    if (char === "," && depth === 0) {
      items.push(current.trim());
      current = "";
    } else current += char;
  }
  return [...items, current.trim()].filter(Boolean);
}

export function timingProblems(css: string): string[] {
  const problems: string[] = [];
  for (const [property, value] of declarations(css)) {
    if (!TIMING.test(property)) continue;
    const where = `${property}: ${value}`;
    if (EASING_WORD.test(value.replace(/var\([^)]*\)/g, ""))) problems.push(`easing must be a --ease-* token: ${where}`);
    if (property === "transition" || property === "animation") {
      for (const item of topLevelItems(value)) {
        if (item === "none") continue;
        if (property === "transition" && /^all\b/.test(item)) problems.push(`transition: all is banned: ${where}`);
        if (!item.includes("var(--duration-") || !item.includes("var(--ease")) problems.push(`duration and easing must be tokens: ${where}`);
      }
    }
    if (property === "transition-property" && /\ball\b/.test(value)) problems.push(`transition: all is banned: ${where}`);
  }
  return problems;
}

export const KEYFRAME_PROPERTIES = ["transform", "translate", "scale", "rotate", "opacity", "background-position", "clip-path", "stroke-dashoffset"];

export function keyframeProblems(css: string): string[] {
  return splitAtRules(css, "keyframes").inside.flatMap((body) => declarations(body).filter(([property]) => !KEYFRAME_PROPERTIES.includes(property)).map(([property, value]) => `keyframes may animate only transform, opacity, background-position, clip-path and stroke-dashoffset: ${property}: ${value}`));
}

export function fillProblems(css: string): string[] {
  const problems: string[] = [];
  for (const { selector, body } of rules(css)) {
    for (const [property, value] of declarations(`${body};`)) {
      if ((property === "animation" || property === "animation-fill-mode") && /\b(?:forwards|both)\b/.test(value) && !parts(selector).every((part) => ANY_PSEUDO.test(part))) problems.push(`nothing is left animated at rest; use backwards fill: ${selector} { ${property}: ${value} }`);
    }
  }
  return problems;
}

export function filterProblems(css: string): string[] {
  return declarations(css).filter(([property, value]) => /^(?:-webkit-)?(?:backdrop-)?filter$/.test(property) && !/^(?:none|(?:[a-z-]+\(var\(--[\w-]+\)\)\s*)+)$/.test(value)).map(([property, value]) => `filter values must be tokens: ${property}: ${value}`);
}

export function willChangeProblems(css: string): string[] {
  return declarations(css).filter(([property]) => property === "will-change").map(([property, value]) => `will-change is banned: ${property}: ${value}`);
}

/** Every ADR 0032 motion rule at once, for sheets outside the token sheets. */
export function motionProblems(css: string): string[] {
  return [...opacityProblems(css), ...timingProblems(css), ...keyframeProblems(css), ...fillProblems(css), ...filterProblems(css), ...willChangeProblems(css)];
}

const GRADIENT = /\b(?:repeating-)?(?:linear|radial|conic)-gradient\(/i;

/** ADR 0033: no gradients anywhere, token sheets included. Separate from motionProblems. */
export function gradientProblems(css: string): string[] {
  return declarations(css).filter(([, value]) => GRADIENT.test(value)).map(([property, value]) => `gradients are banned (ADR 0033): ${property}: ${value}`);
}

const LEFT_EDGE = /^(?:border-left|border-left-color|border-inline-start|border-inline-start-color)$/;
// Any colour token: structural neutrals (--separator, --border*) stay allowed; status, brand, ink and legacy colours are not.
const LEFT_RULE_VALUE = /var\(--(?:tone-|color-|accent|danger|info|success|warning|ink|ai\b|banner|rule-width)/;

/** ADR 0033: no coloured left-border cards. Returns the offending selectors, one per rule, in source order. */
export function leftRuleSelectors(css: string): string[] {
  const found: string[] = [];
  for (const { selector, body } of rules(css)) {
    const bad = declarations(`${body};`).some(([property, value]) => (LEFT_EDGE.test(property) && LEFT_RULE_VALUE.test(value)) || (property === "box-shadow" && /inset var\(--rule-width\)/.test(value)));
    if (bad) found.push(selector.replace(/\s+/g, " "));
  }
  return found;
}

export function leftRuleProblems(css: string): string[] {
  return leftRuleSelectors(css).map((selector) => `coloured left rule is banned (ADR 0033): ${selector}`);
}

/** Quoted string literals in a TSX file, with comments and template holes removed. */
export function stringLiterals(tsx: string): string[] {
  const code = tsx.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  return [...code.matchAll(/"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'|`((?:[^`\\]|\\.)*)`/g)].flatMap((match) => {
    const text = match[1] ?? match[2] ?? match[3] ?? "";
    return [text.replace(/\$\{[^}]*\}/g, " "), ...[...text.matchAll(/\$\{([^}]*)\}/g)].flatMap((hole) => stringLiterals(hole[1] ?? ""))];
  });
}

const TW_BANNED = /^(?:opacity|animate|duration|ease|delay|will-change|blur|backdrop-blur|backdrop-opacity|shadow(?!-none$))-|^transition(?:-(?!none$)|$)/;
const TW_GRADIENT = /^(?:bg-(?:linear|radial|conic|gradient)-|from-|via-|to-(?!$))/;
const TW_LITERAL = /#[0-9a-f]{3,8}\b|\b(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color-mix)\(|-?\d*\.?\d+(?:px|ms|s|rem|em)\b/i;
const DECLARATION = /(?:^|[\s;"'])(?:opacity|transition(?:-[a-z]+)?|animation(?:-[a-z]+)?|will-change|filter|backdrop-filter)\s*:/;

/** ADR 0032 motion rules and ADR 0033 gradient ban for TSX: Tailwind utilities may not bypass the CSS lint (motion, effects, arbitrary literal values), and strings hold no CSS declarations. */
export function tsxStyleProblems(tsx: string): string[] {
  const problems: string[] = [];
  for (const text of stringLiterals(tsx)) {
    if (/gradient\(/i.test(text)) problems.push(`gradients are banned (ADR 0033): "${text.trim()}"`);
    if (DECLARATION.test(text)) problems.push(`inline CSS declaration belongs in a token-based stylesheet: "${text.trim()}"`);
    for (const word of text.split(/\s+/).filter(Boolean)) {
      const utility = word.replace(/^(?:\[[^\]]*\]:|[a-z0-9_*&>-]+:)*/i, "").replace(/^!/, "").replace(/^-/, "").replace(/!$/, "");
      if (TW_GRADIENT.test(utility)) problems.push(`gradient utilities are banned (ADR 0033): ${word}`);
      else if (TW_BANNED.test(utility) && !/^shadow-\[var\(--[\w-]+\)\]$/.test(utility)) problems.push(`utility bypasses the motion and effect tokens: ${word}`);
      else if (/\[[^\]]*\]/.test(utility) && TW_LITERAL.test(utility.slice(utility.indexOf("[")))) problems.push(`arbitrary value holds a literal colour, length or duration: ${word}`);
    }
  }
  return problems;
}

// Minimal YAML parser/emitter for seeds config.yaml.
//
// Supports the subset needed for `plan_templates:` (PLAN_SPEC.md:36-78):
//   - Block-style nested mappings (indent-driven, any indent step).
//   - Block-style sequences (`- item`, `- key: value` for object items).
//   - Inline flow mappings (`{ k: v, k2: v2 }`) and sequences (`[a, b, c]`).
//   - Single- and double-quoted scalars; bare scalars typed as bool / int /
//     float / null / string.
//   - `# comment` to end-of-line, ignored both whole-line and trailing.
//
// Not supported: anchors/aliases, block scalars (| / >), tags, multi-document
// streams, complex keys. None of those appear in seeds config files.
//
// Kept in-tree per CLAUDE.md "minimal runtime dependencies". If this file grows
// past ~250 LOC the js-yaml route is the right call.

export type YamlValue = string | number | boolean | null | YamlValue[] | { [k: string]: YamlValue };

export function parseYaml(content: string): Record<string, YamlValue> {
	const lines = tokenize(content);
	if (lines.length === 0) return {};
	const top = lines[0];
	if (!top) return {};
	if (top.text.startsWith("-")) {
		throw new Error("Top-level YAML sequences are not supported by this parser");
	}
	const { value } = parseMapping(lines, 0, top.indent);
	if (value === null || typeof value !== "object" || Array.isArray(value)) return {};
	return value as Record<string, YamlValue>;
}

export function stringifyYaml(data: Record<string, YamlValue>): string {
	return emitMap(data, 0);
}

interface TokLine {
	indent: number;
	text: string;
}

function tokenize(input: string): TokLine[] {
	const out: TokLine[] = [];
	for (const raw of input.split("\n")) {
		const stripped = stripComment(raw);
		const indent = leadingSpaces(stripped);
		const text = stripped.slice(indent).trimEnd();
		if (text === "") continue;
		out.push({ indent, text });
	}
	return out;
}

function leadingSpaces(s: string): number {
	let i = 0;
	while (i < s.length && s[i] === " ") i++;
	return i;
}

function stripComment(line: string): string {
	let inSingle = false;
	let inDouble = false;
	for (let i = 0; i < line.length; i++) {
		const c = line[i];
		if (!inDouble && c === "'") inSingle = !inSingle;
		else if (!inSingle && c === '"') inDouble = !inDouble;
		else if (!inSingle && !inDouble && c === "#") {
			// Treat `#` as a comment only if preceded by whitespace or at line start.
			if (i === 0 || line[i - 1] === " " || line[i - 1] === "\t") return line.slice(0, i);
		}
	}
	return line;
}

function parseBlock(
	lines: TokLine[],
	start: number,
	indent: number,
): { value: YamlValue; end: number } {
	const first = lines[start];
	if (!first || first.indent < indent) return { value: null, end: start };
	if (first.text.startsWith("- ") || first.text === "-") {
		return parseSequence(lines, start, first.indent);
	}
	return parseMapping(lines, start, first.indent);
}

function parseMapping(
	lines: TokLine[],
	start: number,
	indent: number,
): { value: Record<string, YamlValue>; end: number } {
	const obj: Record<string, YamlValue> = {};
	let i = start;
	while (i < lines.length) {
		const line = lines[i];
		if (!line || line.indent < indent) break;
		if (line.indent > indent) break;
		if (line.text.startsWith("-")) break;
		const entry = parseMapEntry(lines, i, indent);
		obj[entry.key] = entry.value;
		i = entry.end;
	}
	return { value: obj, end: i };
}

function parseMapEntry(
	lines: TokLine[],
	idx: number,
	indent: number,
): { key: string; value: YamlValue; end: number } {
	const line = lines[idx];
	if (!line) throw new Error(`parseMapEntry: no line at ${idx}`);
	const colonIdx = findKeyColon(line.text);
	if (colonIdx === -1) throw new Error(`Expected 'key: value' (got: ${line.text})`);
	const key = unquote(line.text.slice(0, colonIdx).trim());
	const valuePart = line.text.slice(colonIdx + 1).trim();

	if (valuePart === "") {
		const next = lines[idx + 1];
		if (!next || next.indent < indent) {
			return { key, value: null, end: idx + 1 };
		}
		// A sibling mapping key at the same indent is NOT this key's value; only
		// a same-indent sequence (`- ...`) is, since YAML allows sequences to
		// share their parent's indent.
		if (next.indent === indent && !next.text.startsWith("-")) {
			return { key, value: null, end: idx + 1 };
		}
		const sub = parseBlock(lines, idx + 1, next.indent);
		return { key, value: sub.value, end: sub.end };
	}
	return { key, value: parseScalarOrFlow(valuePart), end: idx + 1 };
}

function parseSequence(
	lines: TokLine[],
	start: number,
	indent: number,
): { value: YamlValue[]; end: number } {
	const arr: YamlValue[] = [];
	let i = start;
	while (i < lines.length) {
		const line = lines[i];
		if (!line || line.indent !== indent || !line.text.startsWith("-")) break;
		const rest = line.text === "-" ? "" : line.text.slice(2).trimStart();
		if (rest === "") {
			const next = lines[i + 1];
			if (next && next.indent > indent) {
				const sub = parseBlock(lines, i + 1, next.indent);
				arr.push(sub.value);
				i = sub.end;
			} else {
				arr.push(null);
				i++;
			}
			continue;
		}
		const inlineColon = findKeyColon(rest);
		const startsWithFlow = rest.startsWith("{") || rest.startsWith("[");
		const startsWithQuote = rest.startsWith('"') || rest.startsWith("'");
		if (inlineColon !== -1 && !startsWithFlow && !startsWithQuote) {
			// "- key: value" — start of a block-mapping item. The map's logical
			// indent is the column where `key` begins (line indent + 2 for "- ").
			const itemIndent = indent + 2;
			const k = unquote(rest.slice(0, inlineColon).trim());
			const v = rest.slice(inlineColon + 1).trim();
			const obj: Record<string, YamlValue> = {};
			if (v === "") {
				const next = lines[i + 1];
				if (next && next.indent > itemIndent) {
					const sub = parseBlock(lines, i + 1, next.indent);
					obj[k] = sub.value;
					i = sub.end;
				} else {
					obj[k] = null;
					i++;
				}
			} else {
				obj[k] = parseScalarOrFlow(v);
				i++;
			}
			while (i < lines.length) {
				const more = lines[i];
				if (!more || more.indent !== itemIndent || more.text.startsWith("-")) break;
				const entry = parseMapEntry(lines, i, itemIndent);
				obj[entry.key] = entry.value;
				i = entry.end;
			}
			arr.push(obj);
			continue;
		}
		arr.push(parseScalarOrFlow(rest));
		i++;
	}
	return { value: arr, end: i };
}

function findKeyColon(text: string): number {
	let inSingle = false;
	let inDouble = false;
	let depth = 0;
	for (let i = 0; i < text.length; i++) {
		const c = text[i];
		if (!inDouble && c === "'") inSingle = !inSingle;
		else if (!inSingle && c === '"') inDouble = !inDouble;
		else if (!inSingle && !inDouble && (c === "{" || c === "[")) depth++;
		else if (!inSingle && !inDouble && (c === "}" || c === "]")) depth--;
		else if (!inSingle && !inDouble && depth === 0 && c === ":") {
			const next = text[i + 1];
			if (next === undefined || next === " " || next === "\t") return i;
		}
	}
	return -1;
}

function unquote(s: string): string {
	if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
		try {
			return JSON.parse(s) as string;
		} catch {
			return s.slice(1, -1);
		}
	}
	if (s.length >= 2 && s.startsWith("'") && s.endsWith("'")) {
		return s.slice(1, -1).replace(/''/g, "'");
	}
	return s;
}

export function parseScalarOrFlow(s: string): YamlValue {
	if (s.startsWith("[")) return parseFlowSeq(s);
	if (s.startsWith("{")) return parseFlowMap(s);
	if (s.startsWith('"') || s.startsWith("'")) return unquote(s);
	if (s === "true") return true;
	if (s === "false") return false;
	if (s === "null" || s === "~" || s === "") return null;
	if (/^-?\d+$/.test(s)) return Number(s);
	if (/^-?\d+\.\d+$/.test(s)) return Number(s);
	return s;
}

function parseFlowSeq(s: string): YamlValue[] {
	if (!s.endsWith("]")) throw new Error(`Unclosed flow sequence: ${s}`);
	const inner = s.slice(1, -1).trim();
	if (inner === "") return [];
	return splitFlow(inner).map((p) => parseScalarOrFlow(p.trim()));
}

function parseFlowMap(s: string): Record<string, YamlValue> {
	if (!s.endsWith("}")) throw new Error(`Unclosed flow mapping: ${s}`);
	const inner = s.slice(1, -1).trim();
	const out: Record<string, YamlValue> = {};
	if (inner === "") return out;
	for (const part of splitFlow(inner)) {
		const t = part.trim();
		const colonIdx = findKeyColon(t);
		if (colonIdx === -1) throw new Error(`Flow map entry missing ':': ${t}`);
		const k = unquote(t.slice(0, colonIdx).trim());
		const v = t.slice(colonIdx + 1).trim();
		out[k] = parseScalarOrFlow(v);
	}
	return out;
}

function splitFlow(s: string): string[] {
	const parts: string[] = [];
	let depth = 0;
	let inSingle = false;
	let inDouble = false;
	let start = 0;
	for (let i = 0; i < s.length; i++) {
		const c = s[i];
		if (!inDouble && c === "'") inSingle = !inSingle;
		else if (!inSingle && c === '"') inDouble = !inDouble;
		else if (!inSingle && !inDouble && (c === "[" || c === "{")) depth++;
		else if (!inSingle && !inDouble && (c === "]" || c === "}")) depth--;
		else if (!inSingle && !inDouble && depth === 0 && c === ",") {
			parts.push(s.slice(start, i));
			start = i + 1;
		}
	}
	if (start <= s.length) parts.push(s.slice(start));
	return parts;
}

function emitMap(obj: Record<string, YamlValue>, indent: number): string {
	const lines: string[] = [];
	const pad = " ".repeat(indent);
	for (const [k, v] of Object.entries(obj)) {
		const key = needsQuotedKey(k) ? `"${k}"` : k;
		if (v === null || v === undefined) {
			lines.push(`${pad}${key}:`);
		} else if (typeof v === "string") {
			lines.push(`${pad}${key}: ${formatScalar(v)}`);
		} else if (typeof v === "number" || typeof v === "boolean") {
			lines.push(`${pad}${key}: ${v}`);
		} else if (Array.isArray(v)) {
			if (v.length === 0) {
				lines.push(`${pad}${key}: []`);
			} else {
				lines.push(`${pad}${key}:`);
				lines.push(emitSeq(v, indent));
			}
		} else if (typeof v === "object") {
			if (Object.keys(v).length === 0) {
				lines.push(`${pad}${key}: {}`);
			} else {
				lines.push(`${pad}${key}:`);
				lines.push(emitMap(v as Record<string, YamlValue>, indent + 2));
			}
		}
	}
	const out = lines.join("\n");
	return indent === 0 ? `${out}\n` : out;
}

function emitSeq(arr: YamlValue[], indent: number): string {
	const pad = " ".repeat(indent);
	const lines: string[] = [];
	for (const v of arr) {
		if (v === null || v === undefined) {
			lines.push(`${pad}-`);
		} else if (typeof v === "string") {
			lines.push(`${pad}- ${formatScalar(v)}`);
		} else if (typeof v === "number" || typeof v === "boolean") {
			lines.push(`${pad}- ${v}`);
		} else if (Array.isArray(v)) {
			if (v.length === 0) {
				lines.push(`${pad}- []`);
			} else {
				lines.push(`${pad}-`);
				lines.push(emitSeq(v, indent + 2));
			}
		} else if (typeof v === "object") {
			const entries = Object.entries(v);
			if (entries.length === 0) {
				lines.push(`${pad}- {}`);
				continue;
			}
			const first = entries[0];
			if (!first) continue;
			const [fk, fv] = first;
			const rest = entries.slice(1);
			const fkKey = needsQuotedKey(fk) ? `"${fk}"` : fk;
			if (
				fv !== null &&
				typeof fv !== "object" &&
				rest.every(([, rv]) => rv !== null && typeof rv !== "object")
			) {
				// Inline first key on the dash line, then the rest indented.
				lines.push(`${pad}- ${fkKey}: ${formatScalarValue(fv)}`);
				if (rest.length > 0) {
					const sub = emitMap(Object.fromEntries(rest), indent + 2);
					lines.push(sub);
				}
			} else {
				lines.push(`${pad}-`);
				lines.push(emitMap(v as Record<string, YamlValue>, indent + 2));
			}
		}
	}
	return lines.join("\n");
}

function formatScalar(s: string): string {
	if (needsQuotedScalar(s)) return JSON.stringify(s);
	return s;
}

function formatScalarValue(v: YamlValue): string {
	if (typeof v === "string") return formatScalar(v);
	if (v === null || v === undefined) return "null";
	return String(v);
}

function needsQuotedScalar(s: string): boolean {
	if (s === "") return true;
	if (s === "true" || s === "false" || s === "null" || s === "~") return true;
	if (/^-?\d+(\.\d+)?$/.test(s)) return true;
	if (/[:#"'[\]{}\n,&*!|>%@`]/.test(s)) return true;
	if (s !== s.trim()) return true;
	return false;
}

function needsQuotedKey(k: string): boolean {
	return /[\s:#"'[\]{},&*!|>%@`]/.test(k) || k === "";
}

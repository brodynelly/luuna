import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { StringDecoder } from "node:string_decoder";
import { fileURLToPath } from "node:url";

const blank = (sgr = "0") => ({ text: " ", sgr });
const width = (char) => /\p{Mark}/u.test(char) ? 0 : /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe10-\ufe6f\uff00-\uff60\u{1f300}-\u{1faff}]/u.test(char) ? 2 : 1;

// Consume extended colors as atomic groups: a zero RGB channel is not SGR reset.
function rendition(previous, parameters) {
  const state = new Map();
  const apply = (values) => {
    for (let i = 0; i < values.length; i++) {
      const value = values[i];
      if (value === 0) { state.clear(); continue; }
      if ([38, 48, 58].includes(value)) {
        const length = values[i + 1] === 2 ? 5 : values[i + 1] === 5 ? 3 : 1;
        state.set(value === 38 ? "fg" : value === 48 ? "bg" : "underline-color", values.slice(i, i + length)); i += length - 1; continue;
      }
      if (value >= 30 && value <= 37 || value >= 90 && value <= 97) state.set("fg", [value]);
      else if (value >= 40 && value <= 47 || value >= 100 && value <= 107) state.set("bg", [value]);
      else if (value === 39) state.delete("fg");
      else if (value === 49) state.delete("bg");
      else if (value === 59) state.delete("underline-color");
      else if (value === 22) { state.delete(1); state.delete(2); }
      else if ([23, 24, 25, 27, 28, 29].includes(value)) state.delete(value - 20);
      else state.set(value, [value]);
    }
  };
  apply(previous.split(";").map(Number)); apply(parameters);
  return [0, ...[...state.values()].flat()].join(";");
}

/** A bounded VT screen, not stripped output: cursor edits replace existing cells.
 * Captures text, SGR, cursor/alternate state, scrolling and common ECMA-48 edits.
 * Unknown controls are recorded so an audit can refuse unsupported rendering.
 */
export class TerminalScreen {
  constructor(columns = 80, rows = 24) {
    this.columns = columns; this.rows = rows; this.x = 0; this.y = 0; this.sgr = "0";
    this.cursorVisible = true; this.alternate = false; this.saved = [0, 0]; this.main = null;
    this.top = 0; this.bottom = rows - 1; this.pending = ""; this.decoder = new StringDecoder("utf8");
    this.unknown = new Set(); this.grid = this.empty(); this.events = [];
  }
  blank() { return blank(this.sgr); }
  empty() { return Array.from({ length: this.rows }, () => Array.from({ length: this.columns }, () => this.blank())); }
  resize(columns, rows) {
    const old = this.grid; this.columns = columns; this.rows = rows; this.grid = this.empty();
    for (let y = 0; y < Math.min(old.length, rows); y++) for (let x = 0; x < Math.min(old[y].length, columns); x++) this.grid[y][x] = old[y][x];
    this.x = Math.min(this.x, columns - 1); this.y = Math.min(this.y, rows - 1); this.top = 0; this.bottom = rows - 1;
  }
  scroll(count = 1) {
    for (let n = 0; n < count; n++) { this.grid.splice(this.top, 1); this.grid.splice(this.bottom, 0, Array.from({ length: this.columns }, () => this.blank())); }
  }
  newline() { if (this.y === this.bottom) this.scroll(); else this.y = Math.min(this.y + 1, this.rows - 1); }
  feed(bytes) {
    this.pending += typeof bytes === "string" ? bytes : this.decoder.write(bytes);
    let i = 0;
    while (i < this.pending.length) {
      const char = this.pending[i];
      if (char === "\x1b") {
        if (i + 1 === this.pending.length) break;
        const next = this.pending[i + 1];
        if (next === "[") {
          const match = /^\x1b\[([\x20-\x3f]*)([\x40-\x7e])/.exec(this.pending.slice(i));
          if (!match) break;
          this.csi(match[1], match[2]); i += match[0].length; continue;
        }
        if (next === "]" || next === "P") {
          const tail = this.pending.slice(i + 2); const end = /\x07|\x1b\\/.exec(tail);
          if (!end) break; i += 2 + end.index + end[0].length; continue;
        }
        if (next === "(" || next === ")") { if (i + 2 >= this.pending.length) break; i += 3; continue; }
        if (next === "7") this.saved = [this.x, this.y];
        else if (next === "8") [this.x, this.y] = this.saved;
        else if (next === "M") { if (this.y > this.top) this.y--; else { this.grid.splice(this.bottom, 1); this.grid.splice(this.top, 0, Array.from({ length: this.columns }, () => this.blank())); } }
        else if (next === "D") this.newline();
        else if (next === "E") { this.x = 0; this.newline(); }
        else if (next === "c") { this.sgr = "0"; this.grid = this.empty(); this.x = 0; this.y = 0; }
        else if (next !== "=" && next !== ">") this.unknown.add(`ESC ${next}`);
        i += 2; continue;
      }
      if (char === "\r") this.x = 0;
      else if (char === "\n") this.newline();
      else if (char === "\b") this.x = Math.max(0, this.x - 1);
      else if (char === "\t") this.x = Math.min(this.columns - 1, (Math.floor(this.x / 8) + 1) * 8);
      else if (char >= " ") {
        const point = String.fromCodePoint(this.pending.codePointAt(i)); const cells = width(point);
        if (!cells) { const previous = this.grid[this.y][Math.max(0, this.x - 1)]; previous.text += point; }
        else {
          if (this.x >= this.columns) { this.x = 0; this.newline(); }
          this.grid[this.y][this.x] = { text: point, sgr: this.sgr };
          if (cells === 2 && this.x + 1 < this.columns) this.grid[this.y][this.x + 1] = { text: "", sgr: this.sgr };
          this.x += cells;
        }
        i += point.length; continue;
      }
      i++;
    }
    this.pending = this.pending.slice(i);
    if (this.pending.length > 65536) throw new Error("Unterminated terminal control exceeds limit");
  }
  csi(raw, final) {
    const privateMode = raw.startsWith("?"); const args = raw.replace(/^[?>]/, "").split(";").map((value) => Number(value) || 0);
    const n = args[0] || 1; const clamp = () => { this.x = Math.max(0, Math.min(this.columns - 1, this.x)); this.y = Math.max(0, Math.min(this.rows - 1, this.y)); };
    if (final === "H" || final === "f") { this.y = n - 1; this.x = (args[1] || 1) - 1; clamp(); }
    else if (final === "A") { this.y -= n; clamp(); }
    else if (final === "B" || final === "e") { this.y += n; clamp(); }
    else if (final === "C" || final === "a") { this.x += n; clamp(); }
    else if (final === "D") { this.x -= n; clamp(); }
    else if (final === "E" || final === "F") { this.y += final === "E" ? n : -n; this.x = 0; clamp(); }
    else if (final === "G" || final === "`") { this.x = n - 1; clamp(); }
    else if (final === "d") { this.y = n - 1; clamp(); }
    else if (final === "s") this.saved = [this.x, this.y];
    else if (final === "u") { [this.x, this.y] = this.saved; clamp(); }
    else if (final === "m") this.sgr = rendition(this.sgr, args);
    else if (final === "J") {
      if (args[0] === 2 || args[0] === 3) this.grid = this.empty();
      else for (let y = 0; y < this.rows; y++) for (let x = 0; x < this.columns; x++) if (args[0] === 1 ? y < this.y || y === this.y && x <= this.x : y > this.y || y === this.y && x >= this.x) this.grid[y][x] = this.blank();
    } else if (final === "K") { for (let x = 0; x < this.columns; x++) if (args[0] === 2 || (args[0] === 1 ? x <= this.x : x >= this.x)) this.grid[this.y][x] = this.blank(); }
    else if (final === "X") { for (let x = this.x; x < Math.min(this.columns, this.x + n); x++) this.grid[this.y][x] = this.blank(); }
    else if (final === "P") { this.grid[this.y].splice(this.x, n); while (this.grid[this.y].length < this.columns) this.grid[this.y].push(this.blank()); }
    else if (final === "@") { this.grid[this.y].splice(this.x, 0, ...Array.from({ length: Math.min(n, this.columns) }, () => this.blank())); this.grid[this.y].length = this.columns; }
    else if (final === "L" || final === "M") { for (let i = 0; i < Math.min(n, this.rows); i++) { if (final === "L") { this.grid.splice(this.y, 0, Array.from({ length: this.columns }, () => this.blank())); this.grid.splice(this.bottom + 1, 1); } else { this.grid.splice(this.y, 1); this.grid.splice(this.bottom, 0, Array.from({ length: this.columns }, () => this.blank())); } } }
    else if (final === "S") this.scroll(Math.min(n, this.rows));
    else if (final === "r") { this.top = n - 1; this.bottom = (args[1] || this.rows) - 1; this.x = 0; this.y = 0; }
    else if ((final === "h" || final === "l") && privateMode) {
      for (const mode of args) {
        const enabled = final === "h";
        if (mode === 25) this.cursorVisible = enabled;
        if ([47, 1047, 1049].includes(mode) && this.alternate !== enabled) {
          if (enabled) { this.main = { grid: this.grid, x: this.x, y: this.y }; this.grid = this.empty(); this.x = 0; this.y = 0; }
          else if (this.main) { this.grid = this.main.grid; this.x = this.main.x; this.y = this.main.y; this.main = null; this.resize(this.columns, this.rows); }
          this.alternate = enabled; this.events.push(enabled ? "alternate-enter" : "alternate-leave");
        }
      }
    } else if (!["t", "n", "c", "q", "h", "l"].includes(final)) this.unknown.add(`CSI ${raw}${final}`);
  }
  snapshot() { return { columns: this.columns, rows: this.rows, lines: this.grid.map((row) => row.map((cell) => cell.text).join("")), colors: this.grid.map((row) => row.map((cell) => cell.sgr)), cursor: [this.x, this.y], cursorVisible: this.cursorVisible, alternate: this.alternate, unknown: [...this.unknown], events: [...this.events] }; }
}

/** Standalone HTML for a reconstructed terminal capture, suitable for a PNG export.
 * The source is the real terminal cell grid, not a product mockup or OS screenshot.
 */
export function terminalSnapshotHtml(snapshot, title = "Luuna reconstructed terminal capture") {
  const escape = (value) => String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  const palette = ["#000000", "#800000", "#008000", "#808000", "#000080", "#800080", "#008080", "#c0c0c0", "#808080", "#ff0000", "#00ff00", "#ffff00", "#0000ff", "#ff00ff", "#00ffff", "#ffffff"];
  const indexed = (index) => index < 16 ? palette[index] : index < 232 ? `rgb(${[Math.floor((index - 16) / 36), Math.floor((index - 16) / 6) % 6, (index - 16) % 6].map((value) => value ? 55 + 40 * value : 0).join(",")})` : `rgb(${Array(3).fill(8 + 10 * (index - 232)).join(",")})`;
  const css = (sgr) => {
    const values = sgr.split(";").map(Number); let fg = "#c0c0c0", bg = "#000000", bold = false, dim = false, inverse = false, underline = false;
    for (let i = 0; i < values.length; i++) {
      const code = values[i];
      if (code === 0) { fg = "#c0c0c0"; bg = "#000000"; bold = dim = inverse = underline = false; }
      else if (code === 1) bold = true;
      else if (code === 2) dim = true;
      else if (code === 4) underline = true;
      else if (code === 7) inverse = true;
      else if (code === 38 || code === 48) {
        let color;
        if (values[i + 1] === 2) { color = `rgb(${values.slice(i + 2, i + 5).join(",")})`; i += 4; }
        else if (values[i + 1] === 5) { color = indexed(values[i + 2]); i += 2; }
        if (color) { if (code === 38) fg = color; else bg = color; }
      } else if (code >= 30 && code <= 37) fg = palette[code - 30];
      else if (code >= 90 && code <= 97) fg = palette[code - 90 + 8];
      else if (code >= 40 && code <= 47) bg = palette[code - 40];
      else if (code >= 100 && code <= 107) bg = palette[code - 100 + 8];
    }
    if (inverse) [fg, bg] = [bg, fg];
    return `color:${fg};background:${bg};${bold ? "font-weight:bold;" : ""}${dim ? "opacity:.65;" : ""}${underline ? "text-decoration:underline;" : ""}`;
  };
  const rows = snapshot.lines.map((line, y) => {
    let column = 0;
    return `<div class="row">${[...line].map((char) => { const cells = width(char); const style = css(snapshot.colors[y]?.[column] ?? "0"); column += cells; return `<span style="${style}display:inline-block;width:${cells}ch">${escape(char)}</span>`; }).join("")}</div>`;
  }).join("");
  return `<!doctype html><meta charset="utf-8"><title>${escape(title)}</title><style>body{margin:0;background:#181818;color:#eee}header{font:12px system-ui;padding:8px}main{font:16px/20px Consolas,"Courier New",monospace;width:${snapshot.columns}ch;background:#000}.row{height:20px;white-space:pre}</style><header>${escape(title)} · ${snapshot.columns}×${snapshot.rows} · reconstructed from real terminal cells</header><main>${rows}</main>`;
}

export class ConptyTerminal {
  constructor({ env = process.env, python = "python" } = {}) {
    this.child = spawn(python, [fileURLToPath(new URL("./tui-conpty.py", import.meta.url))], { env, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    this.requests = new Map(); this.sequence = 0; this.screen = null; this.raw = Buffer.alloc(0); this.exit = null;
    this.diagnostics = ""; this.child.stderr.on("data", (chunk) => { this.diagnostics = (this.diagnostics + chunk).slice(-4096); });
    createInterface({ input: this.child.stdout }).on("line", (line) => {
      let message; try { message = JSON.parse(line); } catch { return; }
      const request = this.requests.get(message.id); if (!request) return;
      this.requests.delete(message.id); clearTimeout(request.timer);
      if (message.error) request.reject(new Error(message.error)); else request.resolve(message.result);
    });
    const fail = () => { for (const { reject, timer } of this.requests.values()) { clearTimeout(timer); reject(new Error("ConPTY helper exited unexpectedly")); } this.requests.clear(); };
    this.child.on("error", fail); this.child.on("exit", fail);
  }
  request(op, data = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.sequence;
      const timer = setTimeout(() => { this.requests.delete(id); reject(new Error(`ConPTY ${op} timed out`)); }, 15000);
      this.requests.set(id, { resolve, reject, timer });
      this.child.stdin.write(`${JSON.stringify({ id, op, ...data })}\n`);
    });
  }
  async open({ columns = 80, rows = 24, ...options }) { this.screen = new TerminalScreen(columns, rows); return this.request("open", { columns, rows, ...options }); }
  async send(text) { const bytes = Buffer.from(text); for (let offset = 0; offset < bytes.length; offset += 4096) await this.request("send", { data: bytes.subarray(offset, offset + 4096).toString("base64") }); }
  async resize(columns, rows) { this.screen.resize(columns, rows); return this.request("resize", { columns, rows }); }
  async processes() { return this.request("processes"); }
  async capture() {
    const result = await this.request("poll"); if (result.truncated) throw new Error("ConPTY output overflow; evidence is incomplete");
    const data = Buffer.from(result.data, "base64"); this.raw = Buffer.concat([this.raw, data]).subarray(-8 * 1024 * 1024); this.screen.feed(data); this.exit = result.exit;
    return { ...this.screen.snapshot(), exit: result.exit, pid: result.pid };
  }
  async close() { try { await this.request("close"); } finally { this.child.stdin.end(); } }
}

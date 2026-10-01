/**
 * Python `str.format` subset for output-name templates (spec 10): `{name}`, `{{`/`}}`
 * escapes, `!r`/`!s` conversions and the format mini-language for strings and ints
 * (`{number:02d}`, `{track:>10}`, `{track:.3}`). Errors carry the Python exception kind
 * so behaviour can be checked against the desktop golden cases.
 */

export type TemplateErrorKind = "KeyError" | "ValueError" | "IndexError";

export class TemplateError extends Error {
  constructor(
    readonly kind: TemplateErrorKind,
    message: string,
  ) {
    super(message);
    this.name = "TemplateError";
  }
}

export type TemplateFields = Record<string, string | number>;

const SPEC = /^(?:(.)?([<>=^]))?([+\- ])?(#)?(0)?(\d+)?([,_])?(?:\.(\d+))?([a-zA-Z%])?$/;

function pyRepr(value: string | number): string {
  if (typeof value === "number") return String(value);
  const quote = value.includes("'") && !value.includes('"') ? '"' : "'";
  const escaped = value.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/\t/g, "\\t");
  return quote + (quote === "'" ? escaped.replace(/'/g, "\\'") : escaped) + quote;
}

function applySpec(value: string | number, spec: string): string {
  if (spec === "") return String(value);
  const match = SPEC.exec(spec);
  if (!match) throw new TemplateError("ValueError", "Invalid format specifier");
  const [, fillChar, alignChar, sign, , zero, widthText, grouping, precisionText, type] = match;
  const isNumber = typeof value === "number";
  let fill = fillChar ?? " ";
  let align = alignChar ?? (isNumber ? ">" : "<");
  if (zero && !alignChar) {
    fill = "0";
    align = isNumber ? "=" : "<";
  }
  let body: string;
  let prefix = "";
  if (isNumber) {
    if (!Number.isInteger(value)) throw new TemplateError("ValueError", "Only integer fields are supported");
    if (precisionText !== undefined) throw new TemplateError("ValueError", "Precision not allowed in integer format specifier");
    const base = { d: 10, x: 16, X: 16, o: 8, b: 2, "": 10 }[type ?? ""];
    if (base === undefined) throw new TemplateError("ValueError", `Unknown format code '${type}' for object of type 'int'`);
    body = Math.abs(value).toString(base);
    if (type === "X") body = body.toUpperCase();
    if (grouping) body = body.replace(/\B(?=(\d{3})+(?!\d))/g, grouping);
    prefix = value < 0 ? "-" : sign === "+" ? "+" : sign === " " ? " " : "";
  } else {
    if (type !== undefined && type !== "s") {
      throw new TemplateError("ValueError", `Unknown format code '${type}' for object of type 'str'`);
    }
    if (sign) throw new TemplateError("ValueError", "Sign not allowed in string format specifier");
    if (align === "=") throw new TemplateError("ValueError", "'=' alignment not allowed in string format specifier");
    body = precisionText !== undefined ? [...value].slice(0, Number(precisionText)).join("") : value;
  }
  const width = widthText ? Number(widthText) : 0;
  const padding = Math.max(0, width - [...prefix, ...body].length);
  if (align === "=") return prefix + fill.repeat(padding) + body;
  const text = prefix + body;
  if (align === "<") return text + fill.repeat(padding);
  if (align === ">") return fill.repeat(padding) + text;
  const left = Math.floor(padding / 2);
  return fill.repeat(left) + text + fill.repeat(padding - left);
}

/** Format `template` with keyword `fields` only (as the desktop calls `str.format(**fields)`). */
export function formatTemplate(template: string, fields: TemplateFields): string {
  let out = "";
  let i = 0;
  while (i < template.length) {
    const ch = template[i]!;
    if (ch === "}") {
      if (template[i + 1] === "}") {
        out += "}";
        i += 2;
        continue;
      }
      throw new TemplateError("ValueError", "Single '}' encountered in format string");
    }
    if (ch !== "{") {
      out += ch;
      i++;
      continue;
    }
    if (template[i + 1] === "{") {
      out += "{";
      i += 2;
      continue;
    }
    const close = template.indexOf("}", i + 1);
    if (close === -1) throw new TemplateError("ValueError", "expected '}' before end of string");
    const field = template.slice(i + 1, close);
    i = close + 1;
    const colon = field.indexOf(":");
    const head = colon === -1 ? field : field.slice(0, colon);
    const spec = colon === -1 ? "" : field.slice(colon + 1);
    const bang = head.indexOf("!");
    const name = bang === -1 ? head : head.slice(0, bang);
    const conversion = bang === -1 ? undefined : head.slice(bang + 1);
    if (name === "" || /^\d+$/.test(name)) {
      throw new TemplateError("IndexError", "Replacement index out of range for positional args tuple");
    }
    if (/[.[]/.test(name)) throw new TemplateError("ValueError", `Unsupported field expression: ${name}`);
    if (!(name in fields)) throw new TemplateError("KeyError", `'${name}'`);
    let value: string | number = fields[name]!;
    if (conversion !== undefined) {
      if (conversion === "r" || conversion === "a") value = pyRepr(value);
      else if (conversion === "s") value = String(value);
      else throw new TemplateError("ValueError", `Unknown conversion specifier ${conversion}`);
    }
    out += applySpec(value, spec);
  }
  return out;
}

/** Desktop error messages for invalid templates (core.generate_videos / cut_media_clips). */
export const PROMO_TEMPLATE_ERROR = "Invalid promo naming template. Use {track} and optionally {number}.";
export const CLIP_TEMPLATE_ERROR = "Invalid clip naming template. Use {source}, {title}, and {number}.";

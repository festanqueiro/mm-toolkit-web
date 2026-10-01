import { describe, expect, it } from "vitest";
import { formatTemplate, TemplateError } from "../src/engine/template";
import { golden } from "./golden";

describe("formatTemplate (golden, Python str.format)", () => {
  it.each(golden.pure.templates)("$template", ({ template, fields, output, error }) => {
    if (error) {
      let thrown: unknown;
      try {
        formatTemplate(template, fields);
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toBeInstanceOf(TemplateError);
      expect((thrown as TemplateError).kind).toBe(error);
    } else {
      expect(formatTemplate(template, fields)).toBe(output);
    }
  });
});

describe("format spec details", () => {
  const f = (t: string) => formatTemplate(t, { s: "ab", n: 42, neg: -5 });
  it.each([
    ["{s:*^6}", "**ab**"],
    ["{n:05}", "00042"],
    ["{neg:04d}", "-005"],
    ["{n:+d}", "+42"],
    ["{n:x}", "2a"],
    ["{n:<4}|", "42  |"],
    ["{s:5}|", "ab   |"],
    ["{s!r}", "'ab'"],
  ])("%s → %s", (template, expected) => expect(f(template)).toBe(expected));
  it.each(["{s:d}", "{n:.2}", "{s:=5}", "{s!x}"])("%s is a ValueError", (template) => {
    expect(() => f(template)).toThrow(TemplateError);
  });
});

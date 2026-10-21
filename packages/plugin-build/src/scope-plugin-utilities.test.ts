import { describe, expect, it } from "vitest";
import {
  pluginScopeRoots,
  scopePluginUtilities,
} from "./scope-plugin-utilities.js";

const ROOTS = pluginScopeRoots("demo");
const ANCESTORS = [
  ':where([data-bb-plugin="demo"])',
  ":where([data-bb-plugin-root]:not([data-bb-plugin]))",
];
const SELF = `:where(${ROOTS.join(",")})`;

function descendantArms(selector: string): string {
  return ANCESTORS.map((ancestor) => `${ancestor} ${selector}`).join(",");
}

function arms(selector: string): string {
  return `${descendantArms(selector)},${SELF}${selector}`;
}

function rules(selector: string, body: string, includeSelf = true): string {
  const selectors = ANCESTORS.map((ancestor) => `${ancestor} ${selector}`);
  if (includeSelf) selectors.push(`${SELF}${selector}`);
  return selectors.map((scoped) => `${scoped}{${body}}`).join("");
}

function scopeUtilities(utilities: string): string {
  return scopePluginUtilities(`@layer utilities{${utilities}}`, ROOTS);
}

describe("scopePluginUtilities", () => {
  it("emits one descendant arm per scope root and a self arm per selector", () => {
    expect(scopeUtilities(".flex-col{flex-direction:column}")).toBe(
      `@layer utilities{${rules(".flex-col", "flex-direction:column")}}`,
    );
  });

  it("gives each descendant arm a single-root :where() so the ancestor filter can reject it", () => {
    const scoped = scopeUtilities(".flex-col{flex-direction:column}");
    const descendant = [
      ...scoped.matchAll(/([^{}]+)\{flex-direction:column\}/g),
    ]
      .map((match) => match[1])
      .filter((selector) => selector.includes(") ."));
    expect(descendant).toEqual([
      ':where([data-bb-plugin="demo"]) .flex-col',
      ":where([data-bb-plugin-root]:not([data-bb-plugin])) .flex-col",
    ]);
  });

  it("scopes each selector in a list", () => {
    expect(scopeUtilities(".a,.b{color:red}")).toBe(
      `@layer utilities{${arms(".a")},${arms(".b")}{color:red}}`,
    );
  });

  it("preserves nesting specificity when the original selector list has different specificities", () => {
    expect(scopeUtilities(".a,#b{&:hover{color:red}}")).toBe(
      `@layer utilities{${arms(".a")},${arms("#b")}{&:hover{color:red}}}`,
    );
  });

  it("keeps commas inside :is()/:not() out of the selector split", () => {
    const scoped = scopeUtilities(":is(.a,.b) > .c{color:red}");
    expect(scoped).toBe(
      `@layer utilities{${rules(":is(.a,.b) > .c", "color:red")}}`,
    );
  });

  it("scopes a :where()-wrapped child combinator from outside, where every root has an ancestor hash", () => {
    const spaceY = ":where(.space-y-2>:not(:last-child))";
    expect(scopeUtilities(`${spaceY}{margin-top:1rem}`)).toBe(
      `@layer utilities{${rules(spaceY, "margin-top:1rem", false)}}`,
    );
  });

  it("scopes inside a :where()-wrapped descendant combinator so a host ancestor cannot satisfy it", () => {
    expect(scopeUtilities(":where(.a .b){color:red}")).toBe(
      "@layer utilities{" +
        ANCESTORS.map(
          (ancestor) => `:where(${ancestor} .a .b){color:red}`,
        ).join("") +
        `:where(${SELF}.a .b){color:red}}`,
    );
  });

  it("drops the self arm for sibling combinators so a portal root cannot reach host siblings", () => {
    const hidden = String.raw`.\[\&\~\*\]\:hidden`;
    expect(scopeUtilities(`${hidden}{&~*{display:none}}`)).toBe(
      `@layer utilities{${rules(hidden, "&~*{display:none}", false)}}`,
    );
    expect(scopeUtilities(`${hidden} ~ *{display:none}`)).toBe(
      `@layer utilities{${rules(`${hidden} ~ *`, "display:none", false)}}`,
    );
    expect(scopeUtilities(".a{+ .b{color:red}}")).toBe(
      `@layer utilities{${rules(".a", "+ .b{color:red}", false)}}`,
    );
    expect(
      scopeUtilities(".a{@media (hover:hover){&:hover + .b{color:red}}}"),
    ).toBe(
      `@layer utilities{${rules(".a", "@media (hover:hover){&:hover + .b{color:red}}", false)}}`,
    );
  });

  it("keeps both arms when a sibling combinator precedes & so the subject stays on the element", () => {
    expect(scopeUtilities(".x{.a ~ &{color:red}}")).toBe(
      `@layer utilities{${rules(".x", ".a ~ &{color:red}")}}`,
    );
    expect(scopeUtilities(".x{&:hover{color:red}}")).toBe(
      `@layer utilities{${rules(".x", "&:hover{color:red}")}}`,
    );
  });

  it("keeps both arms when + or ~ only appear escaped, in attributes, or inside :is()", () => {
    const peer = String.raw`.peer-checked\:hidden:is(:where(.peer):checked ~ *)`;
    expect(scopeUtilities(`${peer}{display:none}`)).toContain(`${SELF}${peer}`);
    const attr = String.raw`[data-x~="a"].mt-\[calc\(1px\+2px\)\]`;
    expect(scopeUtilities(`${attr}{margin:0}`)).toContain(`${SELF}${attr}`);
  });

  it("keeps the scope in front of a pseudo-element so the selector stays valid", () => {
    expect(scopeUtilities(".content-x::before{content:'x'}")).toContain(
      `${SELF}.content-x::before`,
    );
  });

  it("survives escaped class names and braces inside strings", () => {
    const scoped = scopeUtilities(String.raw`.w-\[50\%\]{content:"}"}`);
    expect(scoped).toBe(
      `@layer utilities{${rules(String.raw`.w-\[50\%\]`, 'content:"}"')}}`,
    );
  });

  it("scopes rules nested in conditional at-rules", () => {
    const scoped = scopeUtilities(
      "@media (min-width:40rem){.md-flex{display:flex}}",
    );
    expect(scoped).toBe(
      `@layer utilities{@media (min-width:40rem){${rules(".md-flex", "display:flex")}}}`,
    );
  });

  it("leaves keyframe selectors alone", () => {
    const scoped = scopeUtilities(
      "@keyframes spin{from{rotate:0deg}to{rotate:360deg}}",
    );
    expect(scoped).toBe(
      "@layer utilities{@keyframes spin{from{rotate:0deg}to{rotate:360deg}}}",
    );
  });

  it("leaves theme variables and @property registrations unscoped", () => {
    const css = [
      "@layer theme{:root{--color-red:red}}",
      '@property --tw-scale-x{syntax:"*";inherits:false}',
      "@layer utilities{.scale-x-50{--tw-scale-x:50%}}",
    ].join("");
    const scoped = scopePluginUtilities(css, ROOTS);
    expect(scoped).toContain("@layer theme{:root{--color-red:red}}");
    expect(scoped).toContain(
      '@property --tw-scale-x{syntax:"*";inherits:false}',
    );
    expect(scoped).toContain(`${SELF}.scale-x-50`);
  });

  it("preserves the license banner in readable optimized CSS", () => {
    const banner =
      "/*! tailwindcss v4.3.0 | MIT License | https://tailwindcss.com */";
    expect(
      scopePluginUtilities(`${banner}@layer utilities{.a{color:red}}`, ROOTS),
    ).toBe(`${banner}@layer utilities{${rules(".a", "color:red")}}`);
  });

  it("accepts a build with no utilities layer", () => {
    expect(scopePluginUtilities("@layer theme{:root{--a:1}}", ROOTS)).toBe(
      "@layer theme{:root{--a:1}}",
    );
  });

  it("throws when a class rule lands outside the utilities layer", () => {
    expect(() =>
      scopePluginUtilities(
        "@layer theme{.flex-col{flex-direction:column}}",
        ROOTS,
      ),
    ).toThrow(/class rule outside the utilities layer/);
  });

  it("keeps a license banner that precedes a layer without mistaking it for a class rule", () => {
    const banner =
      "/*! tailwindcss v4.3.0 | MIT License | https://tailwindcss.com */";
    const scoped = scopePluginUtilities(
      `${banner}\n@layer theme{:root{--a:1}}@layer utilities{.a{color:red}}`,
      ROOTS,
    );
    expect(scoped).toBe(
      `${banner}\n@layer theme{:root{--a:1}}@layer utilities{${rules(".a", "color:red")}}`,
    );
  });

  it("allows the universal registered-property fallback layer", () => {
    const css =
      "@layer properties{@supports (top:1px){*,::before{--tw-blur:initial}}}" +
      "@layer utilities{.blur-sm{filter:blur(4px)}}";
    expect(() => scopePluginUtilities(css, ROOTS)).not.toThrow();
  });
});

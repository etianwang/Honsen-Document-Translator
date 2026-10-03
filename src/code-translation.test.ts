import { describe, expect, it } from "vitest";
import { applyCodeTranslations, extractCodeSegments, validateCodeText } from "./code-translation";

describe("code translation extraction", () => {
  it("only replaces text in comments, literals, templates, and HTML content", () => {
    const source = 'const userName = `Hello ${name}`; // Welcome user\n<div title="Open document">Hello world</div>';
    const segments = extractCodeSegments(source, "tsx");
    const translated = applyCodeTranslations(source, segments, new Map(segments.map((segment) => [segment.id, `ZH:${segment.text}`])));
    expect(translated).toContain("const userName");
    expect(translated).toContain('`ZH:Hello ${name}`');
    expect(translated).toContain("//ZH: Welcome user");
    expect(translated).toContain('title="ZH:Open document"');
    expect(translated).toContain(">ZH:Hello world<");
  });

  it("keeps code-like string values unchanged", () => {
    const source = 'const route = "/api/v1/users"; const key = "user_name";';
    expect(extractCodeSegments(source, "ts")).toHaveLength(0);
  });

  it("translates configuration values but not keys or JSX expressions", () => {
    const yaml = 'page_title: Welcome home\napi_path: /api/v1/users\n';
    const yamlSegments = extractCodeSegments(yaml, "yaml");
    expect(yamlSegments.map((segment) => segment.text)).toEqual(["Welcome home"]);
    const jsx = '<p>Hello {userName}</p>';
    expect(extractCodeSegments(jsx, "tsx").map((segment) => segment.text)).toEqual(["Hello "]);
  });

  it("collects PHP markup text without changing the surrounding PHP code", () => {
    const source = '<?php $role = "admin"; ?> <h1>Welcome</h1>';
    expect(extractCodeSegments(source, "php").map((segment) => segment.text)).toEqual(["Welcome"]);
  });

  it("keeps fonts and event-handler calls out of translation", () => {
    const css = "body { font-family: 'PingFang SC', 'Microsoft YaHei'; content: 'Welcome'; }";
    expect(extractCodeSegments(css, "css").map((segment) => segment.text)).toEqual(["Welcome"]);
    const html = '<button onclick="setRole(\'设计师\')">Welcome</button>';
    expect(extractCodeSegments(html, "html").map((segment) => segment.text)).toEqual(["Welcome"]);
  });

  it("reports malformed structural syntax while ignoring braces in strings", () => {
    expect(validateCodeText('const text = "{";', "ts").valid).toBe(true);
    expect(validateCodeText("function broken() {", "ts")).toMatchObject({ valid: false });
    expect(validateCodeText('{"title":"Welcome"}', "json").valid).toBe(true);
    expect(validateCodeText('{"title":}', "json")).toMatchObject({ valid: false });
  });
});

/**
 * Tests for the Engineering Practices skill documentation.
 *
 * Validates that the skill file itself is well-formed, contains
 * the required rules, and documents the automated TDD enforcement.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("engineering-practices SKILL.md", () => {
  const skillPath = join(import.meta.dirname, "..", ".pi", "skills", "engineering-practices", "SKILL.md");
  const content = readFileSync(skillPath, "utf-8");
  const lines = content.split("\n");

  it("should have a valid YAML frontmatter", () => {
    expect(content.startsWith("---")).toBe(true);
    const end = content.indexOf("---", 3);
    expect(end).toBeGreaterThan(3);

    const frontmatter = content.slice(3, end).trim();
    expect(frontmatter).toContain("name: engineering-practices");
    expect(frontmatter).toContain("description:");
    expect(frontmatter).toContain("TDD");
  });

  it("should have section 1 as TDD: Red → Green → Refactor", () => {
    expect(content).toContain("## 1. TDD: Red → Green → Refactor");
  });

  it("should document the Red-Green-Refactor cycle", () => {
    expect(content).toContain("1. **Red** — Write a failing test _before_ any implementation code.");
    expect(content).toContain("2. **Green** — Write the simplest code that passes the test.");
    expect(content).toContain("3. **Refactor** — Improve the code while keeping tests green.");
  });

  it("should include the TDD pre-check question", () => {
    expect(content).toContain("If you can't name the test that proves it works");
  });

  it("should document the LemonHarness enforcement guardrails", () => {
    expect(content).toContain("**LemonHarness enforcement**");
    expect(content).toContain("P2 entry: quality gate checks for test runner and existing tests");
    expect(content).toContain("P3 entry: auto-runs tests");
  });

  it("should have all 7 numbered rule sections", () => {
    const ruleHeaders = lines.filter(l => /^## \d+\./.test(l));
    expect(ruleHeaders.length).toBeGreaterThanOrEqual(7);
  });

  it("should have complexity thresholds table", () => {
    expect(content).toContain("Cyclomatic complexity per function");
    expect(content).toContain("Lines per function");
  });

  it("should have the Pseudocode contract", () => {
    expect(content).toContain("SKILL engineering-practices");
    expect(content).toContain("PRECONDITIONS:");
    expect(content).toContain("POSTCONDITIONS:");
    expect(content).toContain("tdd_compliant");
  });

  it("should reference conventional commits in cross-references", () => {
    expect(content).toContain("Commit conventions");
    expect(content).toContain("general-rules/reference.md");
  });

  it("file should not exceed 400 lines", () => {
    expect(lines.length).toBeLessThanOrEqual(400);
  });
});

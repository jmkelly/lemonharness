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

  it("should have Rule 1 as TDD (Test-Driven Development)", () => {
    expect(content).toContain("## Rule 1: TDD (Test-Driven Development)");
  });

  it("should document the Red-Green-Refactor cycle", () => {
    expect(content).toContain("**Red → Green → Refactor.** Always.");
    expect(content).toContain("1. **Red** — Write a failing test first.");
    expect(content).toContain("2. **Green** — Write the simplest code that passes the test.");
    expect(content).toContain("3. **Refactor** — Improve the code while keeping tests green.");
  });

  it("should include the TDD pre-check question", () => {
    // The quote spans two lines in the markdown, so check fragments
    expect(content).toContain('"What test would');
    expect(content).toContain('prove this works?"');
  });

  it("should document the Automated Enforcement guardrails", () => {
    expect(content).toContain("### Automated Enforcement (LemonHarness Guardrails)");
    expect(content).toContain("**P2 entry** (Implement phase)");
    expect(content).toContain("**P3 entry** (Validate phase)");
    expect(content).toContain("`npm test`");
  });

  it("should have the TDD cycle diagram", () => {
    expect(content).toContain("P1 Explore → [TDD check on Implement entry]");
  });

  it("should have all 12 rules", () => {
    const ruleHeaders = lines.filter(l => l.startsWith("## Rule "));
    expect(ruleHeaders.length).toBeGreaterThanOrEqual(12);
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

  it("should reference conventional commits", () => {
    expect(content).toContain("Conventional Commits");
    expect(content).toContain("feat");
    expect(content).toContain("fix");
    expect(content).toContain("test");
  });

  it("file should not exceed 400 lines", () => {
    expect(lines.length).toBeLessThanOrEqual(400);
  });
});

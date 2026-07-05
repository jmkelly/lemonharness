/**
 * Tests for the LemonHarness Search Extension.
 *
 * Tests use real imports and a plain-object fake for the pi SDK
 * (no mocks, no vi.fn() — per engineering-practices test philosophy).
 */

import { describe, it, expect } from "vitest";

// ── Plain-object fake for the pi SDK ────────────────────────────
// A real object with the same shape as the ExtensionAPI interface.
// Stores registrations in arrays that tests can inspect.

interface RegisteredTool {
  name: string;
  label?: string;
  description?: string;
  parameters?: unknown;
}

interface RegisteredCommand {
  name: string;
  description?: string;
}

function createFakePI() {
  const tools: RegisteredTool[] = [];
  const commands: RegisteredCommand[] = [];

  const pi = {
    registerTool: (config: RegisteredTool) => {
      tools.push(config);
    },
    registerCommand: (name: string, config: { description?: string }) => {
      commands.push({ name, description: config.description });
    },
    /** Test helper: return registered tools */
    getRegisteredTools: () => [...tools],
    /** Test helper: return registered commands */
    getRegisteredCommands: () => [...commands],
  };

  return pi;
}

// ── Tests ────────────────────────────────────────────────────────

describe("Search Extension", () => {
  it("should load the extension module and export a default function", async () => {
    const mod = await import("../.pi/extensions/lemonharness-search.ts");
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe("function");
  });

  it("should register a web_search tool with correct contract", async () => {
    const mod = await import("../.pi/extensions/lemonharness-search.ts");
    const pi = createFakePI();

    mod.default(pi as any);

    const tools = pi.getRegisteredTools();
    expect(tools.length).toBe(1);

    const tool = tools[0];
    expect(tool.name).toBe("web_search");
    expect(tool.label).toBe("Web Search");
    expect(tool.description).toContain("Search the web");
    expect(tool.parameters).toBeDefined();
  });

  it("should register a /search command with correct name", async () => {
    const mod = await import("../.pi/extensions/lemonharness-search.ts");
    const pi = createFakePI();

    mod.default(pi as any);

    const cmds = pi.getRegisteredCommands();
    expect(cmds.length).toBe(1);

    const cmd = cmds[0];
    expect(cmd.name).toBe("search");
    expect(cmd.description).toContain("Search the web");
  });

  it("should register a tool whose execute function is callable", async () => {
    const mod = await import("../.pi/extensions/lemonharness-search.ts");
    const pi = createFakePI();

    mod.default(pi as any);

    const tool = pi.getRegisteredTools()[0];
    // The tool registration must include an execute function
    expect(typeof (tool as any).execute).toBe("function");
  });
});

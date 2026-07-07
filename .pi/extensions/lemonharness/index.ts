/**
 * LemonHarness — pi extension entry point
 *
 * Follows pi's multi-file extension convention:
 *   .pi/extensions/lemonharness/
 *     index.ts          # Entry point (exports default function)
 *     workspace.ts      # Workspace extension logic
 *     memory.ts         # Memory extension logic
 *     subsystems.ts     # Subsystems extension logic
 *     integration.ts    # Integration adapter
 *     search.ts         # Web search tool
 *     summary.ts        # Live documentation generator
 *     visualization.ts  # Execution visualization
 *     workspace-core.ts # Core workspace classes
 *     memory-core.ts    # Core memory classes
 *     subsystems-core.ts# Core subsystem classes
 *     shared.ts         # Shared utilities
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { setupWorkspace } from "./workspace";
import { setupMemory } from "./memory";
import { setupSubsystems } from "./subsystems";
import { setupIntegration } from "./integration";
import { setupSearch } from "./search";
import { setupSummary } from "./summary";
import { setupVisualization } from "./visualization";

export default function (pi: ExtensionAPI) {
  setupWorkspace(pi);
  setupMemory(pi);
  setupSubsystems(pi);
  setupIntegration(pi);
  setupSearch(pi);
  setupSummary(pi);
  setupVisualization(pi);
}

/**
 * LemonHarness Subsystems Extension — Entry Point
 * All classes and functions are in .pi/extensions/lib/subsystems-core.ts
 */
export * from "./subsystems-core";

export function setupSubsystems(pi: any) {
  pi.on("session_start", async (_event: any, ctx: any) => {
    ctx.ui.setStatus("lemonharness-subsystems", "🔧 Subsystems module loaded");
  });
  pi.on("session_shutdown", async (_event: any, ctx: any) => {
    ctx.ui.setStatus("lemonharness-subsystems", undefined);
  });
}

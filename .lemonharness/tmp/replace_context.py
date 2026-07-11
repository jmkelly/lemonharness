import sys

with open(sys.argv[1], 'rb') as f:
    content = f.read()

# Find the contextBudget threshold block at the end of turn_end handler
# It comes after "not a git repo" or similar
old_bytes = b"""    const settings = readLemonHarnessSettings();
    if (settings.contextBudget?.enabled !== false) {
      const trail = executionLogger.getExecutionTrail();
      const status = contextBudgetTracker.getContextStatus(trail);
      const thresholdHits = contextBudgetTracker.checkThresholds(status.percentUsed);
      for (const hit of thresholdHits) {
        ctx.ui.notify(hit.message, hit.threshold >= 90 ? "error" : hit.threshold >= 70 ? "warning" : "info");
      }
    }
  });"""

new_bytes = b"""    const settings = readLemonHarnessSettings();
    if (settings.contextBudget?.enabled !== false) {
      const usage = ctx.getContextUsage();
      if (usage && usage.percent !== null) {
        const thresholds = [50, 70, 90];
        for (const threshold of thresholds) {
          if (usage.percent >= threshold && !state.warnedContextThresholds.has(threshold)) {
            state.warnedContextThresholds.add(threshold);
            const emoji = threshold >= 90 ? "\xf0\x9f\x94\xb4" : threshold >= 70 ? "\xe2\x9a\xa0\xef\xb8\x8f" : "\xf0\x9f\x93\x8b";
            ctx.ui.notify(
              `${emoji} Context usage at ${usage.percent}% (exceeded ${threshold}% threshold). Model: ${usage.tokens?.toLocaleString()} / ${usage.contextWindow.toLocaleString()} tokens. Use /lemonharness:context for details.`,
              threshold >= 90 ? "error" : threshold >= 70 ? "warning" : "info",
            );
          }
        }
      }
    }
  });"""

if old_bytes not in content:
    print("ERROR: old block not found in file")
    # Try to find where contextBudget appears and show context
    idx = content.rfind(b'contextBudget')
    if idx >= 0:
        start = max(0, idx - 60)
        end = min(len(content), idx + 400)
        print(f"Found contextBudget at byte {idx}")
        print(repr(content[start:end]))
    sys.exit(1)

content = content.replace(old_bytes, new_bytes, 1)
with open(sys.argv[1], 'wb') as f:
    f.write(content)
print("SUCCESS: Replaced threshold block")

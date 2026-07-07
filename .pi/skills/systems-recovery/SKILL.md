---
name: systems-recovery
description: >
  Disaster response and systems recovery: controlled execution paths,
  backup-first discipline, build/runtime probes, and checkpoint-based
  rollback. Use for debugging crashes, data recovery, failover
  scenarios, or infrastructure repair.
---

# Systems Recovery

**Leading word:** _checkpoint_ — before every state-changing operation, create a point you can return to. Recovery is a series of checkpoints, not a single rollback.

## Rules

1. **Backup first** — Before any repair, ensure a recent, verified backup exists. Test that the backup is restorable before modifying anything.
2. **Controlled paths** — Operate on copies of important data first. Never modify the last known good backup in-place without verification.
3. **Checkpoints** — Create recovery checkpoints before every state-changing operation. Log each step so rollback is possible at any point.
4. **Build probes** — Before attempting a fix, verify build system integrity: compiler available, dependencies intact, disk space sufficient.
5. **Runtime probes** — Check process health, resource usage, and log files before diagnosing root cause. Don't guess — probe first.

## Diagnostic Tools

```bash
# rsync — file-level backups
# dmesg/journalctl — system logs
# strace/lsof — process diagnostics
```

Detailed probing patterns: [`references/probe-strategies.md`](references/probe-strategies.md)

---

## Pseudocode

```
SKILL systems-recovery

INPUTS:
  failureType: string       // crash, data_loss, build_fail, runtime_error
  targetSystem: string      // Service, application, or path affected
  backupPath?: string       // Optional path to known-good backup

OUTPUTS:
  recoveryPlan: array       // Ordered recovery steps
  rootCause: string         // Identified root cause
  recoveryStatus: object    // Status per step with rollback info

PRECONDITIONS:
  - Backup verified restorable before any modification
  - Build system integrity confirmed (compiler, deps, disk)
  - Runtime probes collected before diagnosis

POSTCONDITIONS:
  - All state changes logged for rollback
  - Recovery checkpoints before each state change
  - If recovery fails → rollback to last checkpoint
  - Root cause documented for future prevention

ERROR_HANDLING:
  - Backup not restorable → halt and alert
  - Build system missing or corrupted → repair before recovery
  - Runtime probe fails → fall back to log analysis
  - Recovery step fails → rollback to last checkpoint
```

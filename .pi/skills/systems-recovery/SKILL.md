---
name: systems-recovery
description: >
  Rules for systems recovery and disaster response tasks: controlled
  execution paths, recoverable artifacts, and build/integrity/runtime
  probes. Use for debugging crashes, data recovery, failover scenarios,
  or infrastructure repair.
---

# Systems Recovery

## Key Rules

1. **Controlled paths**: Always operate on copies of important data first.
   Never modify the last known good backup in-place without verification.
2. **Recoverable artifacts**: Create recovery checkpoints before making
   state-changing operations. Log each step so rollback is possible.
3. **Build probes**: Before attempting a fix, verify the build system
   integrity (compiler available, dependencies intact, disk space).
4. **Runtime probes**: Check process health, resource usage, and log
   files before diagnosing the root cause.
5. **Backup first**: Before any repair, ensure a recent, verified backup
   exists. Test that the backup is restorable.

## Setup

```bash
# Recovery tools may be needed:
# - rsync for file-level backups
# - dmesg/journalctl for system logs
# - strace/lsof for process diagnostics
```

## Usage

See [probe-strategies](references/probe-strategies.md) for detailed
probing and diagnostic patterns.

---

## Pseudocode

```
SKILL systems-recovery

INPUTS:
  failureType: string       // crash, data_loss, build_fail, runtime_error
  targetSystem: string      // Service, application, or path affected
  backupPath?: string       // Optional path to known-good backup

OUTPUTS:
  recoveryPlan: array       // Ordered list of recovery steps
  rootCause: string         // Identified root cause
  recoveryStatus: object    // // Status of each recovery step
  //   step: string
  //   status: string
  //   rollback?: string

PRECONDITIONS:
  - Backup verified restorable before any modification
  - Build system integrity confirmed (compiler, deps, disk)
  - Runtime probes collected before diagnosis

POSTCONDITIONS:
  - All state changes are logged for rollback
  - Recovery checkpoints exist before each state change
  - If recovery fails -> rollback to last checkpoint
  - Root cause documented for future prevention

ERROR_HANDLING:
  - If backup not restorable -> halt and alert
  - If build system missing or corrupted -> repair before recovery
  - If runtime probe fails -> fall back to log analysis
  - If recovery step fails -> rollback to last checkpoint
```

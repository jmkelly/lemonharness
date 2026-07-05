# Probe Strategies

## Build System Probe

```bash
#!/bin/bash
# Check build system integrity
echo "=== Build System Probe ==="
echo "Disk space:"
df -h . | tail -1
echo "Compiler:"
which gcc || which clang || echo "No compiler found"
echo "Memory:"
free -h | grep Mem
echo "Load:"
uptime
```

## Runtime Probe

```bash
#!/bin/bash
# Check process health
PID=${1:-$(pgrep -f "your-app" | head -1)}
if [ -n "$PID" ]; then
    echo "Process $PID is running"
    echo "CPU/MEM:"
    ps -p $PID -o %cpu,%mem,etime
    echo "Open files:"
    lsof -p $PID 2>/dev/null | wc -l
else
    echo "Process not found"
fi
```

## Integrity Checks

- Compare checksums: `sha256sum <file> > <file>.sha256`
- Verify with: `sha256sum -c <file>.sha256`
- For databases: use built-in integrity checks (e.g., `sqlite3 database.db "PRAGMA integrity_check;"`)
- For tarballs: `tar -tzf archive.tar.gz > /dev/null`

## Recovery Checklist

- [ ] Confirm the problem (replicate if possible)
- [ ] Backup current state
- [ ] Check build/runtime probes
- [ ] Apply minimal fix
- [ ] Verify fix resolves the issue
- [ ] Document what went wrong and how it was fixed

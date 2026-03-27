# Expected Status Procedure

## Step 1: Query State
1. Run quorum status command (primary)
2. If CLI unavailable, fallback: quorum tool audit_history --summary --json
3. Query SQLite for gate state, pending items, verdicts, locks

## Step 2: Format Output
4. Present structured summary table:
   - Gate State: approved / pending / idle
   - Pending Items: count with trigger_tag
   - Last Verdict: tag + timestamp
   - Active Locks: count + lock holder list
   - Agent Assignments: active agent count + task mapping
5. Show recent verdict history (last 5)
6. Show rejection patterns if any

## Step 3: Additional Context
7. Show track progress if orchestrate is active (wave-state files)
8. Show fitness score trend if available
9. Show parliament session status (convergence, pending amendments)
10. All data sourced from SQLite — never from markdown verdict files

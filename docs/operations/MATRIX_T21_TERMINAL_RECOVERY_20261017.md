# T21: durable failure and scoped recovery

Exhausted attempts previously marked the job FAILED but left its run PROCESSING. A new check was blocked indefinitely. The shared terminal propagation now closes the attempt and active run, updates object status, cancels dependent jobs/leases and writes exactly one FAILED stage event in the same transaction. claim exhaustion, explicit terminal failure and bounded relay repair use the same policy. Original FAILED/DEAD error information is retained.

Only the current OPEN inspection and QUEUED/RUNNING run are eligible. Sealed artifacts and coverage remain untouched. Retry recovery now also rechecks inspection/run/job under locks, preserves finalized/superseded/terminal scopes, expires the old attempt, advances the lease fence and dispatches one job event even under concurrent relays. Candidate scans are bounded at 100 and transactions release locks after each job.

## Evidence

- Six actual PostgreSQL tests cover exhaustion, reported failure, concurrent FAILED/DEAD repair, max-attempt expiry versus a live lease, concurrent ordinary retry recovery, finalized/superseded/sealed job immutability and frozen artifacts/coverage.
- Added scope regression failed against the old relay, changing all three protected scopes and adding job.ready events; the fixed relay passes. Logs: output/matrix-t21-20261017/scope-{red,green}.log.
- On ordinary homeserver, existing stranded CHK-20F43F32 became FAILED through normal relay repair. No database state was manually repaired. A new immutable FULL CHK-DF0C0C68 started on the same exact F0126 original and reached PARTIAL100. Full browser/PNG validation is tracked under T19.
- Before the last scope patch, all five PostgreSQL files passed 41 tests. Final common check passed: API544/web174/Python1230, typecheck/buildPASS. Clean full PostgreSQL passed42 with no unhandled errors. Restart readback preserved8checks and1localreview. T21 accepted; lock-order followup remains T23.

## Concurrency limit

Worker commands and recovery use inspection/run/job ordering. Existing startCheck also locks the object before the inspection, while terminal propagation updates the object after the inspection. A concurrent start can therefore still produce a PostgreSQL deadlock; transactions roll back and the periodic relay retries. This pre-existing cross-command ordering is not claimed resolved by T21. No global transaction retry policy was added.

Test teardown initially FORCE-dropped the disposable database before pg-pool sockets finished closing, producing two57P01 unhandled errors despite42passed assertions. Teardown now waits for zero backend connections before ordinaryDROP. Failed receipt retained privately; clean rerun passed42/exit0.

# T24: Nginx upstream DNS replacement regression

Date: 2026-10-18 Europe/Moscow. Initial investigation used disposable Docker integration only. The runtime owner subsequently applied and accepted the configuration on the isolated feedback stand; final acceptance is recorded below.

## Reproduced problem and supported fix

The current `location /api/` uses `proxy_pass http://api:4100/api/;`. A separately created Nginx container with this exact mounted config continued connecting to the old API IP after the `api` network alias moved to a replacement container. This independently reproduces the operational failure reported after API recreation.

The Nginx upstream `server ... resolve` parameter monitors address changes without restarting Nginx. It requires a shared upstream zone and a resolver; the parameter became available in open source Nginx 1.27.3. [Official Nginx upstream documentation](https://nginx.org/en/docs/http/ngx_http_upstream_module.html#server). The cached web image used here reports `nginx/1.29.8`, which supports it. Docker provides embedded DNS at `127.0.0.11` on custom networks. [Official Docker networking documentation](https://docs.docker.com/engine/network/#dns-services).

Proposed configuration for the runtime owner to implement after T22 acceptance:

```nginx
upstream inspector_api {
  zone inspector_api 64k;
  resolver 127.0.0.11 valid=5s ipv6=off;
  resolver_timeout 2s;
  server api:4100 resolve;
}

# Inside the existing server/location /api/:
proxy_pass http://inspector_api/api/;
```

The existing URI suffix, request buffering settings, timeouts, `Host` and `X-Forwarded-Proto` headers must remain equivalent. This packet does not edit `apps/web/nginx.conf` or restart real services. Candidate GREEN is recorded below; the runtime owner must still apply and verify the actual runtime configuration.

## Repeatable integration script

`scripts/smoke-web-upstream-dns.py` accepts a local Nginx `conf.d` configuration and either `--expect-stale` or `--expect-recovery`. It connects through ordinary SSH to the single allowlisted host `homeserver`; it does not read an env file or print connection credentials.

```sh
python3 scripts/smoke-web-upstream-dns.py \
  --config apps/web/nginx.conf --expect-stale

# After the runtime owner implements dynamic resolution:
python3 scripts/smoke-web-upstream-dns.py \
  --config apps/web/nginx.conf --expect-recovery
```

Default cached images are `inspector-feedback-20261017-api:latest` and `inspector-feedback-20261017-web:latest`. Image arguments can select another already cached image; `--pull=never` forbids downloading. Each run resolves tags once, runs containers by those immutable image IDs, and reports them with config SHA256. Concurrent image builds cannot silently switch the test backend or web image after inspection.

The script creates one UUID-named network and at most four containers with its exact owner label. The API image runs only a small Node HTTP echo server through an explicit entrypoint. The Nginx image mounts the supplied configuration read-only and publishes one random loopback-only port. No real API, web, model container, network or compose project is selected.

Initial GET and POST must return the exact method, URL including duplicate query parameters/percent encodings/empty values, forwarded Host, byte count and SHA256 of a binary POST body. The body includes all byte values, Cyrillic UTF-8, CRLF and NUL. The echo server returns a generation marker, preventing a response from the old backend from counting as recovery.

After initial success, the script removes its old echo backend and starts a non-listening holder container at that exact old IP. A replacement echo backend receives alias `api` and must have a different inspected IP. This prevents Docker address recycling from producing a false pass. The script polls for at most 20 seconds. A successful recovery requires exact GET semantics followed by exact POST semantics against the new generation. Stale mode requires no recovery during the entire observation window and an observed HTTP 502.

Nginx's host PID, container `StartedAt`, and master PID must be unchanged. The script never sends a reload or restart to Nginx. Dynamic recovery is therefore demonstrated in the running original container.

Docker operations have 12-second timeouts; setup/test work has a 120-second signal deadline; SSH transport has a 240-second outer timeout. SIGHUP/SIGTERM enter cleanup. `finally` removes only exact owned resources after checking owner labels, removes the temporary mounted file/directory, then queries matching owner labels to verify absence. No global prune, model operation, production network operation or global force cleanup occurs. A cleanup failure makes the receipt fail. Forced removal applies only to this run's owned disposable container names. A machine/daemon outage can prevent cleanup; the receipt then explicitly reports `cleanupComplete=false` and identifies its owner.

## RED evidence: unchanged static config

The first actual run completed at approximately `2026-10-17T21:21Z` (2026-10-18 MSK), before the runtime patch:

| Evidence | Observed |
| --- | --- |
| Receipt expectation/status | `stale` / `PASS` (expected RED behavior reproduced) |
| Config SHA256 | `5f5c5b30532c30e6e91b5c9a798fed28e47b7d427147c08f1d03ec701b714d08` |
| API image ID | `sha256:9a52252150dd557bffe587be5f319412a8fb354786abce24b2c937ba1d7d951e` |
| Web image ID | `sha256:90a540d1cf542e0f7eb554be3c296e56ef27957fba7b9d7f2bae8ede1bbf7ee7` |
| Nginx version | `nginx/1.29.8` |
| Initial semantics | GET + POST passed |
| POST body | 4889 bytes, SHA256 `9354d1da69fa6aca5feafe093abe43e03d0792fca8ef524ff4646e851163317f` |
| Backend addresses | `192.168.144.2` replaced by `192.168.144.4` |
| Post-replacement observation | 50 requests, only HTTP 502, 20.095 seconds |
| Recovery | None |
| Nginx identity | host PID `3467323`, master PID `1`, StartedAt `2026-10-17T21:20:51.929237585Z`; unchanged |
| Cleanup | `cleanupComplete=true` |
| Disposable owner | `inspector-dns-smoke-d429259d2304` |

This proves the static DNS failure with byte/query/Host preservation before replacement. It does not claim the runtime configuration is fixed or the live feedback stack has been restarted.

## GREEN evidence: mounted candidate configuration

The runtime owner prepared `/tmp/nginx-t24-candidate.conf`, whose SHA256 is `649db5b7e34e6469a4531e40ffbcb8697edb17fc25e742fd4b24719d939b1e39`. It uses the exact upstream shown above plus `proxy_pass http://inspector_api/api/;`, preserving the existing remaining server configuration.

The owner's first candidate run receipt is `/tmp/matrix-t24-dns-green-candidate.log`, independently read for this review. It reports PASS, changed backend IP `.2` to `.4`, GET/POST preservation, recovery in **4.834 seconds**, 13 polls with statuses 502 then 200, unchanged container/master identity, and `cleanupComplete=true`. Nginx host PID was `3474287`, master PID `1`, StartedAt `2026-10-17T21:21:54.0671803Z`. Owner was `inspector-dns-smoke-cf4493794922`.

The script subsequently pinned container launches to inspected image IDs. Final-script RED and GREEN receipts follow, so both modes are verified on the same harness revision.

Final harness SHA256: `1d36b4be761d7c35a6fbae992dafe7c5a662785aeaba42ba27890b9454a18d76`.

| Evidence | Final RED, `--expect-stale` | Final candidate GREEN, `--expect-recovery` |
| --- | --- | --- |
| Status | PASS (expected failure reproduced) | PASS |
| Config SHA256 | `5f5c5b30532c30e6e91b5c9a798fed28e47b7d427147c08f1d03ec701b714d08` | `649db5b7e34e6469a4531e40ffbcb8697edb17fc25e742fd4b24719d939b1e39` |
| Owner | `inspector-dns-smoke-2a36886b36a5` | `inspector-dns-smoke-c6d7857dd725` |
| Distinct backend IPs | `192.168.144.2` / `192.168.144.4` | `192.168.128.2` / `192.168.128.4` |
| Initial GET/POST semantics | PASS / PASS | PASS / PASS |
| POST body bytes/SHA256 | 4889 / `9354d1da69fa6aca5feafe093abe43e03d0792fca8ef524ff4646e851163317f` | same |
| Poll count/statuses | 50 / `[502]` | 13 / `[502, 200]` |
| Recovery seconds | null | **4.839** |
| Observation seconds | 20.099 | 4.932 |
| Recovered GET/POST semantics | unavailable, expected | PASS / PASS |
| Nginx host PID/master PID | `3480780` / `1` | `3479166` / `1` |
| Nginx StartedAt | `2026-10-17T21:22:50.210413724Z` | `2026-10-17T21:22:41.627787189Z` |
| PID/container start unchanged | true | true |
| Cleanup complete | true | true |
| Docker command count | 27 | 27 |

Both final receipts report the same immutable API/web image IDs as the initial RED above and Nginx `1.29.8`. AST parsing and `git diff --check` passed. Final code is frozen; this packet's only modified paths are the new harness and this operation note. Applying the candidate to the actual feedback web service remains with the runtime owner.


## Runtime acceptance on the isolated feedback stand

T24 accepted after T22 acceptance. The runtime owner applied the exact candidate to `apps/web/nginx.conf` and built/deployed web only. The uploaded configuration SHA remains `649db5b7e34e6469a4531e40ffbcb8697edb17fc25e742fd4b24719d939b1e39`; `nginx -t` passed. The final actual-source disposable GREEN recovered in4.033s, preserved GET/POST byte/query/Host semantics, left Nginx identity unchanged and cleaned all owned resources.

A separate actual-stand test first required zero QUEUED/RUNNING analysis runs. It replaced only the API container while retaining the same tested API image. A short-lived labelled holder on the isolated feedback network occupied the former API address, guaranteeing a different replacement address rather than relying on Docker address recycling. The holder had no alias/port and was removed in `finally`. No model, database, queue or storage container was restarted.

Actual API address changed from192.168.96.9 to192.168.96.14. The original web container ID, PID and StartedAt all remained identical. Health through port28082 recovered in **4.925seconds**,18polls, statuses502then200. Final health and owned-resource cleanup both passed. This is one observed test replacement, not an availability or fixed-latency guarantee.

After replacement: all29 prior machine/submission/source-review/history snapshots plus1localregistration matched the T22 checkpoint. A readonly public F0154 browser repeat at1440/768/375 passed exactsource/hash/2-lineframe and nooverflow/errors/failedrequests/projectwrites. No application source changed during these repeats.

Final receipt: `output/matrix-t24-20261018/acceptance.json`; actual live script/receipt, immutable source hashes, disposable GREEN, build log and browser/persistence evidence are retained alongside it. The earlier sections describe the deliberately mutation-free investigation phase; this section records the later authorized test-stand rollout.

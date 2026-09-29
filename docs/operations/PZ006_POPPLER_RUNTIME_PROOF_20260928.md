# PZ-006: isolated Poppler runtime proof, 2026-09-28

`infra/pz006-review/compose.yml` runs one disposable review container. Its input is the original permitted public `F0101`: `TRAIN_PUBLIC / INCLUDE / PUBLIC_TRAIN`, manifest `PD / OTHER`, object `OBJ-NOVOSLOBODSKAYA`, 891,618 bytes, 13 physical PDF pages, SHA-256 `01db90e015c39a9502b99969ce04f27825265203bc8728da6141d7b6d2b1ef54`. Only physical page 9 is examined. The PDF mount is read-only. The container has no network, ports, database, queue, or normal stack dependency; its root filesystem is read-only and its temporary worker packet lives in tmpfs. Capabilities are dropped and resource limits apply.

Image uses the same digest-pinned `node:22-alpine@sha256:b64da1de5a51067ab8e75f0bc8dbd0905d8894baa22261f439a4572f41291e50` base and Alpine `poppler-utils=25.12.0-r1` as the ZU-127 one-shot. PyMuPDF is `1.27.2.2`, installed from the `cp310-abi3-musllinux_1_2_x86_64` wheel with SHA-256 `8b4bbfa6ef347fade678771a93f6364971c51a2cdc44cd2400dc4eeed1ddb4e6`. The built image's `/usr/bin/pdftotext` SHA-256 is `04f1da090e97301791df5308a3612c73e48413d9d9b431ff9a00691cd2902330`; `/usr/bin/pdfinfo` is `26026beb23e23cd50a3357d0626ef7e468d20c5d0806b4bb03941dae81735c7e`. The local image ID after final build was `sha256:ad085c34444a9d40ecfd69644024e4b96e1e64cc11139cd3c8baa34b3a0a639a`; this is a local artifact, not a published image digest. APK repository and npm registry are not snapshot-pinned, so the same source may build a different image later.

Worker process verifies source bytes and runs existing PyMuPDF PZ-006 proposal code. It writes its complete 322-word page artifact and review packet to tmpfs. Separately, API verifier reads original bytes, independently calls Poppler `pdfinfo` and `pdftotext -bbox-layout`, requires unique full-page text-and-box bijection for all 322 words, then replays all seven proposals and hashes against the PyMuPDF artifact. Word enumeration order differs between providers. The bijection accepts order differences but rejects missing, duplicate, ambiguous, or altered word boxes. It does not authenticate PyMuPDF `wordIndex` order. The verifier currently adapts the worker-supplied complete words to the existing `TrustedPageWords` replay contract; this isolated adapter is not an authenticated API-owned durable word artifact.

Run from repository root with an absolute path readable by UID 1000:

```sh
export INSPECTOR_PUBLIC_F0101_PDF=/absolute/path/to/F0101.pdf
sha256sum "$INSPECTOR_PUBLIC_F0101_PDF"
docker compose -f infra/pz006-review/compose.yml --profile pz006-review build pz006-review
docker compose -f infra/pz006-review/compose.yml --profile pz006-review run --rm --no-deps pz006-review
```

Local run used `/tmp/inspector-pz006-F0101-public.pdf`, independently matched size and manifest SHA. Compose build and one-shot run passed: Poppler `25.12.0`, PyMuPDF `1.27.2.2`, full word bijection `322/322`, seven review-only proposals, `ABSTAIN`, `typedFact: null`, `findingCount: null`, `parameterCoverage: null`, result content hash `cc8cf9447a71664c83b8d53adb44a97aac30f676f26d8c3b36af9ca2c93406bb`. The verifier also rejected one changed source byte and one rehashed worker word box changed by 101 thousandths of a PDF point. A separate `docker compose run` mounting `/etc/hosts` exited 1 before either extractor. `docker compose config --quiet` and `git diff --check` passed. No homeserver deploy or normal service change was made.

The same one-shot profile passed on homeserver from a separate directory
`/home/freetok/Projects/inspector-ai-pz006-review-20260928` with the
SHA-matching public F0101 PDF. The homeserver image ID was
`sha256:69ccd8cb03644e570c4bb8eca96a14663f6ba20aec39d5085af3e291b8380e81`.
The output again reported 322/322 words, seven proposals, `ABSTAIN`, null
finding count, the same content hash, and rejection of changed bytes and a
101-millipoint word-box mutation. This was an isolated build and disposable
run; no normal service was rebuilt or redeployed.

This proves an offline review gate on one original public page, not an approved CURRENT source, authenticated PD/RD pair, floor-count fact, finding, parameter coverage, or durable save/seal/GET/UI path. The manifest section remains `OTHER`; the catalog title and trigger still conflict for PZ-006. Do not promote these navigation proposals into engineering conclusions. Runtime integration needs authentic full-word artifact provenance and a decision on PZ-006 semantics before any durable use.

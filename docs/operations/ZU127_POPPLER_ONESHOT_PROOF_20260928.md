# ZU-127: isolated one-shot Poppler proof, 2026-09-28

`infra/zu127-review/compose.yml` runs only the pure public F0152 review. It is separate from the normal Compose stack. The one-shot image uses the API's digest-pinned `node:22-alpine` base, installs Alpine `poppler-utils=25.12.0-r1` and Python for the worker module, then runs worker and API verifier as separate processes against the original mounted PDF. API independently extracts every Poppler word on physical pages 49 and 51, replays proposals, and checks the worker's complete receipts. Both processes call the same installed `pdftotext` and `pdfinfo` binary. Their parsing and proposal logic remain separate.

Input is restricted to original public `F0152`, SHA-256 `99ec972d7dfe5039fca922e3120bd5e486f2a26518f78044d0850992c028e7af`, 6,359,136 bytes, 77 pages, manifest role `TRAIN_PUBLIC / INCLUDE / PUBLIC_TRAIN`. The input is mounted read-only. Container has no network, ports, databases, queues, or stack dependencies. Root filesystem is read-only, temporary result lives in 64 MiB tmpfs, capabilities are dropped, and process/memory/CPU limits apply. No review result is saved after container exit.

Run from repository root, setting path to a SHA-verified allowed PDF readable by UID 1000:

```sh
export INSPECTOR_PUBLIC_F0152_PDF=/absolute/path/to/F0152.pdf
sha256sum "$INSPECTOR_PUBLIC_F0152_PDF"
docker compose -f infra/zu127-review/compose.yml --profile zu127-review build zu127-review
docker compose -f infra/zu127-review/compose.yml --profile zu127-review run --rm --no-deps zu127-review
```

Local proof used `/tmp/F0152-public-sha-verified.pdf`, independently checked 6,359,136 bytes and expected SHA before build. One-shot image ID `sha256:5ded90244031b3b99b69181ffe0945eb4b1947136754693203c79514202f89ef` is a local build artifact; do not use it as a published image digest. Successful run returned `PASS`, Poppler `25.12.0`, page word counts `135/173`, four review-only proposals, `ABSTAIN`, `findingCount: null`, content hash `0bc655e71e296625b1e13d9aca9334bc87599e91c02c65986df63b6e6fdc4863`. A run with `/etc/hosts` as input exited 1 before extraction. Build and run left existing Compose services untouched.

This proves the offline Poppler v2 profile on this exact source and image build. It does not establish a real PD/RD pair, approved source, typed fact, finding, coverage, durable save/seal/GET, UI, or equivalence with PyMuPDF word indices. Existing API image on homeserver uses Alpine Poppler `25.12.0`; existing worker image is Debian trixie without Poppler. The disposable proof gives both parsers one pinned runtime without changing either live image. If production integration is later needed, pin Poppler package and base digest in both execution paths or use this common runtime while preserving independent full-page extraction; verify exact binary/package hashes at runtime and fail closed on every mismatch. APK dependencies may change on rebuild because Alpine repositories are not snapshot-pinned here, so the image ID and full package manifest should be retained for any reproducible release claim.

Homeserver one-shot proof also passed in a separate directory
`/home/freetok/Projects/inspector-ai-zu127-review-20260928` on the
SHA-matching public F0152 PDF copied from the original public ZIP extract.
The local build on that machine had image ID
`sha256:cc021fc3f9579cc78f9fb5132f347636626fff2a504e9e78017fc25e41136a01`.
`docker compose run --rm --no-deps` returned `PASS`, Poppler `25.12.0`,
word counts `135/173`, four review proposals, `ABSTAIN`, null finding
count, and the same content hash
`0bc655e71e296625b1e13d9aca9334bc87599e91c02c65986df63b6e6fdc4863`.
No normal API, worker, database, queue, or web container was rebuilt.
The local and homeserver images have identical tool bytes:
`/usr/bin/pdftotext` SHA-256
`04f1da090e97301791df5308a3612c73e48413d9d9b431ff9a00691cd2902330`,
`/usr/bin/pdfinfo` SHA-256
`26026beb23e23cd50a3357d0626ef7e468d20c5d0806b4bb03941dae81735c7e`.
Matching executable hashes still do not by themselves prove every linked library
matches; the source and result hashes plus the version pin are the proof used
for this one-shot result.

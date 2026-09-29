# ZU-127 Poppler v2: pure queue routing policy

`apps/api/src/zu127-queue-policy.ts` defines a dedicated
`rules.evaluate.zu127.poppler-v2` queue only for `RULE_EVALUATION` with an
immutable `analysis-release-v1` DRAFT manifest and a unique configured
`RULE_ENGINE` slot whose profile ID is exactly
`zu127-window-table-poppler-review-v2`. A malformed ZU slot or duplicate rule
slot is rejected. Other jobs and normal/legacy rule profiles retain their
existing queues. A claim must compare its persisted `analysis_jobs.queue_name`
against the queue resolved from the stored release; mismatch is rejected.

The policy is now called at job claim. Before any attempt/fence mutation, API
checks the stored release ID, canonical content SHA-256 and byte length, then
checks persisted `analysis_jobs.queue_name` against that release. A caller
claiming the dedicated queue must state the same `queueName`; a caller stating
any wrong queue gets `QUEUE_MISMATCH`. Legacy callers can omit `queueName`.
The PostgreSQL integration test checked both a forged claim queue and a
tampered persisted queue; the full main PostgreSQL file passed 23/23.

Run creation and outbox relay do **not** yet route or declare the dedicated
queue. No normal worker consumes it. A fixture-only F0152 adapter checks the
exact queue but deliberately exits before consuming. Run creation must persist
the selected queue with the job; initial and retry
`job.ready` outbox routing must use that same persisted queue. Claim must check
the persisted queue against the release before mutating attempt/fence state.
Normal workers must not consume the dedicated queue; its worker must still
verify the profile and source gates. Routing alone does not authorize durable
ZU-127 artifacts, findings, coverage, or source comparison.

The API verifier now requires Poppler `25.12.0` exactly; local `25.03.0`
fails closed. Rebuilt isolated original-F0152 one-shot image
`sha256:ed9792c21802fb44680bcf3e088f4b04f0e9490b15497a10fad971de6def5854`
passed independent re-extraction: 135/173 words, four review-only proposals,
`ABSTAIN`, null findings, result SHA
`0bc655e71e296625b1e13d9aca9334bc87599e91c02c65986df63b6e6fdc4863`.
The same changed verifier file SHA
`7c5476322d5ee6bcff53f3f8ffc1d1acd84f1cd79a28d1ac34db10748170dde2`
was copied into the isolated homeserver directory, backed up there first,
and rebuilt as image
`sha256:afd5b738135ff93f43a528646e68e5a761be4c1276238006ed5b61b004f91496`.
Its networkless read-only one-shot returned the same result SHA, word counts,
four proposals and `ABSTAIN`; normal homeserver services were unchanged.
This is not a durable run or positive source decision.

The API image now pins `poppler-utils=25.12.0-r1` and checks both
`pdftotext` and `pdfinfo` at build time. A local Docker probe built as
`sha256:af07dc8eb562c16b40079aee9007616575c9922ae980c07d76cdf823cacd8ba0`;
both tools reported `25.12.0` in a networkless, read-only container.
The normal API deployment was not replaced. This only aligns the parser
runtime; it does not make the F0152 fixture a source-independent or durable
review.

Focused test: `npm run test --workspace=@inspector-ai/api -- test/zu127-queue-policy.test.ts`.

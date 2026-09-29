-- Destructive rollback reference. Never run automatically.

DROP TRIGGER IF EXISTS inspection_protocol_versions_immutable ON inspection_protocol_versions;
DROP TRIGGER IF EXISTS review_decisions_immutable ON review_decisions;
DROP TRIGGER IF EXISTS rule_results_immutable ON rule_results;
DROP TRIGGER IF EXISTS analysis_runs_sealed_immutable ON analysis_runs;
DROP TRIGGER IF EXISTS manifest_items_immutable ON manifest_items;
DROP TRIGGER IF EXISTS input_manifests_immutable ON input_manifests;
DROP TRIGGER IF EXISTS source_files_immutable ON source_files;
DROP TRIGGER IF EXISTS blobs_immutable ON blobs;
DROP FUNCTION IF EXISTS reject_sealed_run_mutation();
DROP FUNCTION IF EXISTS reject_immutable_domain_mutation();

DROP TABLE IF EXISTS inspection_protocol_versions;
DROP TABLE IF EXISTS review_decisions;
DROP TABLE IF EXISTS review_items;
DROP TABLE IF EXISTS rule_results;
DROP TABLE IF EXISTS parameter_coverage;

ALTER TABLE inspections DROP CONSTRAINT IF EXISTS inspections_working_manifest_fk;
ALTER TABLE inspections DROP CONSTRAINT IF EXISTS inspections_active_run_fk;

DROP TABLE IF EXISTS analysis_runs;
DROP TABLE IF EXISTS manifest_items;
DROP TABLE IF EXISTS input_manifests;
DROP TABLE IF EXISTS upload_receipt_files;
DROP TABLE IF EXISTS upload_receipts;
DROP TABLE IF EXISTS source_file_stages;
DROP TABLE IF EXISTS source_files;
DROP TABLE IF EXISTS blobs;
DROP TABLE IF EXISTS object_stage_summaries;
DROP TABLE IF EXISTS inspections;
DROP TABLE IF EXISTS objects;
DROP TABLE IF EXISTS organizations;

-- Hashes prove integrity; these constraints additionally bind nested evidence to saved input identities.
CREATE FUNCTION verify_native_source_comparison_nested_binding() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  comparison JSONB := NEW.content_json->'comparison';
  source JSONB;
  evidence JSONB;
  role TEXT;
  side TEXT;
  collection TEXT;
BEGIN
  IF (comparison->>'status') IS NOT DISTINCT FROM 'ABSTAIN' THEN
    RETURN NEW;
  END IF;
  IF (comparison->>'status') IS DISTINCT FROM 'COMPARED' THEN
    RAISE EXCEPTION 'Native source comparison status mismatch' USING ERRCODE='23514';
  END IF;
  FOREACH role IN ARRAY ARRAY['PD','RD'] LOOP
    side := lower(role);
    source := comparison->'sources'->role;
    IF (source @> jsonb_build_object(
      'checkId',NEW.content_json->>'checkId',
      'sourceFileId',NEW.content_json->'input'->>(side||'SourceFileId'),
      'sourceSha256',NEW.content_json->'bindings'->>(side||'SourceSha256'),
      'inputManifestHash',NEW.content_json->'bindings'->>'inputManifestHash',
      'textArtifactByteSha256',NEW.content_json->'bindings'->>(side||'TextArtifactHash'),
      'selectedRole',role)) IS NOT TRUE THEN
      RAISE EXCEPTION 'Native source comparison nested source mismatch' USING ERRCODE='23514';
    END IF;
    IF jsonb_typeof(comparison->'quotes'->role) IS DISTINCT FROM 'array'
      OR jsonb_array_length(comparison->'quotes'->role)=0 THEN
      RAISE EXCEPTION 'Native source comparison quotes missing' USING ERRCODE='23514';
    END IF;
    FOREACH collection IN ARRAY ARRAY['quotes','references'] LOOP
      IF collection='references' AND NOT comparison ? collection THEN CONTINUE; END IF;
      IF jsonb_typeof(comparison->collection->role) IS DISTINCT FROM 'array' THEN
        RAISE EXCEPTION 'Native source comparison evidence list mismatch' USING ERRCODE='23514';
      END IF;
      FOR evidence IN SELECT value FROM jsonb_array_elements(comparison->collection->role) LOOP
        IF (evidence @> jsonb_build_object('inputRole',role,'sourceFileId',source->>'sourceFileId',
          'sourceSha256',source->>'sourceSha256','textArtifactContentHash',source->>'textArtifactContentHash')) IS NOT TRUE THEN
          RAISE EXCEPTION 'Native source comparison nested evidence mismatch' USING ERRCODE='23514';
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;
  RETURN NEW;
END $$;
CREATE TRIGGER native_capacity_comparisons_nested_binding BEFORE INSERT ON native_capacity_comparisons
  FOR EACH ROW EXECUTE FUNCTION verify_native_source_comparison_nested_binding();
CREATE TRIGGER native_airflow_comparisons_nested_binding BEFORE INSERT ON native_airflow_comparisons
  FOR EACH ROW EXECUTE FUNCTION verify_native_source_comparison_nested_binding();

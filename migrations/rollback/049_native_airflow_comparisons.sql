DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM native_airflow_comparisons) THEN
    RAISE EXCEPTION 'Refusing rollback of populated native capacity comparisons';
  END IF;
END $$;
DROP TABLE native_airflow_comparisons;
DROP FUNCTION verify_native_airflow_comparison_binding();

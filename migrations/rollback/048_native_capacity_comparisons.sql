DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM native_capacity_comparisons) THEN
    RAISE EXCEPTION 'Refusing rollback of populated native capacity comparisons';
  END IF;
END $$;
DROP TABLE native_capacity_comparisons;
DROP FUNCTION verify_native_capacity_comparison_binding();

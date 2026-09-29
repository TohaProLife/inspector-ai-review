-- Reference only. Never delete reviewed evidence in a production rollback.
DROP TRIGGER IF EXISTS visual_proposal_reviews_immutable ON visual_proposal_reviews;
DROP TABLE IF EXISTS visual_proposal_reviews;

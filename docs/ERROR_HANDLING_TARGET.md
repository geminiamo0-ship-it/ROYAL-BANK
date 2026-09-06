# Core Error Handling Target

No silent database failure for answers, session state, access, or subscription changes. Application integration should map authentication, authorization, validation, not-found, conflict, database, and unexpected errors consistently. In particular, answer saving must stop retrying invalid option relationships with a null option and must surface failures.

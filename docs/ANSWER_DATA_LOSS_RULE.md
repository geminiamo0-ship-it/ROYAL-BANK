# Answer Durability Rule

An answer must never appear successfully submitted when persistence failed. The application must await the authoritative database result, surface failure, and avoid advancing state as if the answer were saved. No null-option fallback or swallowed Supabase error is acceptable in the completed exam flow.

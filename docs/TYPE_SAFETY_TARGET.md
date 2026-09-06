# Type Safety Target

After behavior integration, move shared question/session/category/state DTOs out of Server Action modules, remove avoidable `any`/unsafe casts in completed core, and type RPC inputs/outputs. TypeScript is not an authorization boundary; runtime validation and database constraints remain required.

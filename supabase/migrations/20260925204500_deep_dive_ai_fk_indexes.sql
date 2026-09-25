begin;

create index if not exists ai_user_entitlements_updated_by
  on public.ai_user_entitlements (updated_by)
  where updated_by is not null;

create index if not exists ai_entitlement_audit_actor_user
  on public.ai_entitlement_audit (actor_user_id)
  where actor_user_id is not null;

commit;

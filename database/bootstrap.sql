-- Speedway training database. Reviewed bootstrap source, not a local CLI migration.
-- No personal addresses, credentials, raw messages or photographs belong in this file.
create schema speedway_private;
revoke all on schema speedway_private from public, anon;
grant usage on schema speedway_private to authenticated;

create table speedway_private.approved_access (
  email text primary key check (email=lower(email)),
  role text not null check(role in ('operario','supervisor')),
  enabled boolean not null default true
);
alter table speedway_private.approved_access enable row level security;
revoke all on speedway_private.approved_access from public,anon,authenticated;
create policy deny_direct_access on speedway_private.approved_access
  for all to anon,authenticated using(false) with check(false);

create function speedway_private.current_role() returns text
language sql stable security definer set search_path='' as $$
  select a.role from speedway_private.approved_access a
  join auth.users u on lower(u.email)=a.email
  where u.id=(select auth.uid()) and u.email_confirmed_at is not null and a.enabled;
$$;
revoke all on function speedway_private.current_role() from public,anon;
grant execute on function speedway_private.current_role() to authenticated;

create table public.speedway_warehouses (
  id text primary key check(id='speedway-principal'),
  name text not null default 'Bodega principal Speedway'
);
insert into public.speedway_warehouses(id) values('speedway-principal');
create table public.speedway_events (
  id text primary key,
  channel text not null check(channel in ('whatsapp_entrenamiento','telegram_entrenamiento')),
  external_id text not null,
  owner_id uuid references auth.users(id),
  payload jsonb not null check(jsonb_typeof(payload)='object'),
  source_hash text not null,
  received_at timestamptz not null default now(),
  unique(channel,external_id)
);
create index speedway_events_owner on public.speedway_events(owner_id);
create table public.speedway_products (
  id text primary key default ('SP-P-'||gen_random_uuid()::text),
  name text not null check(length(name) between 3 and 250),
  status text not null check(status in ('provisional','identificado')),
  effi_id text unique,
  merged_into text references public.speedway_products(id),
  check(merged_into is null or merged_into<>id)
);
create index speedway_products_merged on public.speedway_products(merged_into);
create table public.speedway_codes (
  product_id text not null references public.speedway_products(id),
  value text not null check(length(value) between 1 and 100),
  kind text not null check(kind in ('desconocido','EAN','SKU','referencia')),
  validated boolean not null default false,
  primary key(product_id,value,kind),
  check(not validated or kind in ('EAN','SKU'))
);
create unique index speedway_validated_code on public.speedway_codes(value) where validated;
create table public.speedway_drafts (
  event_id text primary key references public.speedway_events(id),
  product_id text references public.speedway_products(id),
  owner_id uuid not null references auth.users(id),
  quantity bigint check(abs(quantity)<=1000000),
  kind text check(kind in ('entrada','salida','apertura','conteo','ajuste')),
  lot text not null default '' check(length(lot)<=100),
  expiry text not null default '' check(expiry='' or expiry ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  notes text not null default '' check(length(notes)<=2000),
  version integer not null default 1 check(version>0),
  status text not null default 'borrador' check(status in ('borrador','confirmado'))
);
create index speedway_drafts_owner on public.speedway_drafts(owner_id);
create index speedway_drafts_product on public.speedway_drafts(product_id);
create table public.speedway_movements (
  id uuid primary key default gen_random_uuid(),
  event_id text not null unique references public.speedway_events(id),
  product_id text not null references public.speedway_products(id),
  warehouse text not null references public.speedway_warehouses(id),
  delta bigint not null,
  kind text not null check(kind in ('entrada','salida','apertura','conteo','ajuste')),
  lot text not null,
  expiry text not null,
  actor uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);
create index speedway_movements_product on public.speedway_movements(product_id,warehouse,lot,expiry);
create index speedway_movements_actor on public.speedway_movements(actor);
create index speedway_movements_warehouse on public.speedway_movements(warehouse);
create table public.speedway_evidence (
  event_id text not null references public.speedway_events(id),
  object_path text not null unique,
  content_sha256 text not null,
  primary key(event_id,object_path)
);
create table public.speedway_audit (
  id bigint generated always as identity primary key,
  actor uuid references auth.users(id),
  action text not null,
  detail jsonb not null,
  created_at timestamptz not null default now()
);
create index speedway_audit_actor on public.speedway_audit(actor);

-- RLS and grants are paired. No browser role may directly mutate the ledger.
alter table public.speedway_warehouses enable row level security;
alter table public.speedway_events enable row level security;
alter table public.speedway_products enable row level security;
alter table public.speedway_codes enable row level security;
alter table public.speedway_drafts enable row level security;
alter table public.speedway_movements enable row level security;
alter table public.speedway_evidence enable row level security;
alter table public.speedway_audit enable row level security;
revoke all on public.speedway_warehouses,public.speedway_events,public.speedway_products,public.speedway_codes,public.speedway_drafts,public.speedway_movements,public.speedway_evidence,public.speedway_audit from anon,authenticated;
grant select on public.speedway_warehouses,public.speedway_events,public.speedway_products,public.speedway_codes,public.speedway_drafts,public.speedway_movements,public.speedway_evidence,public.speedway_audit to authenticated;
create policy member_read on public.speedway_warehouses for select to authenticated using((select speedway_private.current_role()) is not null);
create policy member_read on public.speedway_products for select to authenticated using((select speedway_private.current_role()) is not null);
create policy member_read on public.speedway_codes for select to authenticated using((select speedway_private.current_role()) is not null);
create policy member_read on public.speedway_movements for select to authenticated using((select speedway_private.current_role()) is not null);
create policy own_events on public.speedway_events for select to authenticated using((select speedway_private.current_role())='supervisor' or ((select speedway_private.current_role())='operario' and owner_id=(select auth.uid())));
create policy own_drafts on public.speedway_drafts for select to authenticated using((select speedway_private.current_role())='supervisor' or ((select speedway_private.current_role())='operario' and owner_id=(select auth.uid())));
create policy supervisor_audit on public.speedway_audit for select to authenticated using((select speedway_private.current_role())='supervisor');
create policy own_evidence on public.speedway_evidence for select to authenticated using(exists(select 1 from public.speedway_events e where e.id=event_id));

create view public.speedway_balances with(security_invoker=true) as
select p.id as product_id,'speedway-principal'::text as warehouse,
  coalesce(sum(m.delta),0)::bigint as physical,
  case when p.status='identificado' then coalesce(sum(m.delta),0) else 0 end::bigint as available,
  case when p.status='provisional' then coalesce(sum(m.delta),0) else 0 end::bigint as provisional
from public.speedway_products p
left join public.speedway_products origin on coalesce(origin.merged_into,origin.id)=p.id
left join public.speedway_movements m on m.product_id=origin.id
where p.merged_into is null group by p.id;
revoke all on public.speedway_balances from anon,authenticated;
grant select on public.speedway_balances to authenticated;

create function speedway_private.immutable_row() returns trigger
language plpgsql set search_path='' as $$
begin raise exception 'El historial y la evidencia originales son inmutables'; end;
$$;
revoke all on function speedway_private.immutable_row() from public,anon,authenticated;
create trigger immutable_movements before update or delete on public.speedway_movements for each row execute function speedway_private.immutable_row();
create trigger immutable_events before update or delete on public.speedway_events for each row execute function speedway_private.immutable_row();
create trigger immutable_audit before update or delete on public.speedway_audit for each row execute function speedway_private.immutable_row();

-- Guarded SECURITY DEFINER lives in the unexposed schema. Public wrapper is invoker.
create function speedway_private.confirm_movement(p_event text,p_version integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  v_actor uuid:=auth.uid(); v_role text:=speedway_private.current_role();
  d public.speedway_drafts; p public.speedway_products; v_qty bigint; v_delta bigint;
begin
  if v_actor is null or v_role is null then raise exception 'Acceso no autorizado'; end if;
  select * into d from public.speedway_drafts where event_id=p_event;
  if not found or d.product_id is null then raise exception 'Primero guarda un borrador con producto'; end if;
  if v_role<>'supervisor' and d.owner_id<>v_actor then raise exception 'El borrador pertenece a otro usuario'; end if;
  -- All identity and confirmation operations must lock products before drafts.
  select * into p from public.speedway_products where id=d.product_id for update;
  if p.merged_into is not null then raise exception 'Recarga la ficha enlazada'; end if;
  select * into d from public.speedway_drafts where event_id=p_event for update;
  if d.product_id<>p.id then raise exception 'La ficha cambió; recarga'; end if;
  if d.status='confirmado' then return jsonb_build_object('duplicate',true); end if;
  if d.version<>p_version then raise exception 'La versión del borrador cambió'; end if;
  if d.quantity is null or d.kind is null then raise exception 'Completa cantidad y tipo'; end if;
  if v_role<>'supervisor' and (d.owner_id<>v_actor or p.status<>'identificado' or d.kind not in ('entrada','salida')) then raise exception 'Se requiere supervisor'; end if;
  if (d.kind<>'ajuste' and d.quantity<0) or (d.kind in ('entrada','salida','apertura') and d.quantity=0) then raise exception 'Cantidad inválida'; end if;
  if d.kind in ('apertura','conteo','ajuste') and btrim(d.notes)='' then raise exception 'Se requiere motivo'; end if;
  select coalesce(sum(m.delta),0) into v_qty from public.speedway_movements m join public.speedway_products origin on origin.id=m.product_id
    where coalesce(origin.merged_into,origin.id)=p.id and m.warehouse='speedway-principal' and m.lot=d.lot and m.expiry=d.expiry;
  if d.kind='apertura' and exists(select 1 from public.speedway_movements m join public.speedway_products origin on origin.id=m.product_id where coalesce(origin.merged_into,origin.id)=p.id) then raise exception 'La apertura ya no es posible'; end if;
  v_delta:=case when d.kind='conteo' then d.quantity-v_qty when d.kind='salida' then -d.quantity else d.quantity end;
  if v_qty+v_delta<0 then raise exception 'Saldo insuficiente en este lote y vencimiento'; end if;
  insert into public.speedway_movements(event_id,product_id,warehouse,delta,kind,lot,expiry,actor) values(d.event_id,p.id,'speedway-principal',v_delta,d.kind,d.lot,d.expiry,v_actor);
  update public.speedway_drafts set status='confirmado',version=version+1 where event_id=d.event_id;
  insert into public.speedway_audit(actor,action,detail) values(v_actor,'confirmar_movimiento',jsonb_build_object('eventId',d.event_id,'delta',v_delta,'before',v_qty,'after',v_qty+v_delta));
  return jsonb_build_object('duplicate',false,'delta',v_delta);
end;
$$;
revoke all on function speedway_private.confirm_movement(text,integer) from public,anon;
grant execute on function speedway_private.confirm_movement(text,integer) to authenticated;
create function public.speedway_confirm_movement(p_event text,p_version integer) returns jsonb
language sql security invoker set search_path='' as $$ select speedway_private.confirm_movement(p_event,p_version); $$;
revoke all on function public.speedway_confirm_movement(text,integer) from public,anon;
grant execute on function public.speedway_confirm_movement(text,integer) to authenticated;

create function public.speedway_access() returns jsonb language sql security invoker set search_path='' as $$
  select jsonb_build_object('user_id',auth.uid(),'role',speedway_private.current_role(),'environment','entrenamiento');
$$;
revoke all on function public.speedway_access() from public,anon;
grant execute on function public.speedway_access() to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('speedway-training-evidence','speedway-training-evidence',false,10485760,array['image/jpeg','image/png','image/webp']);
create policy speedway_private_photos on storage.objects for select to authenticated
using(bucket_id='speedway-training-evidence' and exists(select 1 from public.speedway_evidence e where e.object_path=name));
-- No client upload policy until event registration and ownership are wired end to end.

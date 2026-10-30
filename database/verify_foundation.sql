-- Run only in the training project. All fixtures roll back; no email is sent.
begin;
insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,aud,role) values
('10000000-0000-0000-0000-000000000001','test-supervisor@example.invalid',now(),'{}','{}','authenticated','authenticated'),
('10000000-0000-0000-0000-000000000002','test-operator@example.invalid',now(),'{}','{}','authenticated','authenticated'),
('10000000-0000-0000-0000-000000000003','test-outsider@example.invalid',now(),'{}','{"role":"supervisor"}','authenticated','authenticated');
insert into speedway_private.approved_access(email,role) values
('test-supervisor@example.invalid','supervisor'),('test-operator@example.invalid','operario');
insert into public.speedway_products(id,name,status) values
('pg-test-product','Producto de prueba','identificado'),('pg-test-provisional','Provisional de prueba','provisional');
insert into public.speedway_events(id,channel,external_id,owner_id,payload,source_hash)
select 'pg-test-'||i,'whatsapp_entrenamiento','pg-test-'||i,
case when i in (0,5) then '10000000-0000-0000-0000-000000000001'::uuid else '10000000-0000-0000-0000-000000000002'::uuid end,'{}'::jsonb,'test-only' from generate_series(0,5) i;
insert into public.speedway_drafts(event_id,product_id,owner_id,quantity,kind,notes)
select e.id,case when e.external_id='pg-test-3' then 'pg-test-provisional' else 'pg-test-product' end,e.owner_id,
case e.external_id when 'pg-test-0' then 5 when 'pg-test-1' then 2 when 'pg-test-4' then 4 else 1 end,
case e.external_id when 'pg-test-0' then 'apertura' when 'pg-test-1' then 'salida' when 'pg-test-2' then 'conteo' when 'pg-test-4' then 'salida' else 'entrada' end,'Prueba aislada con rollback'
from public.speedway_events e where e.source_hash='test-only';

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
do $$ begin
  if (public.speedway_access()->>'role') is distinct from 'supervisor' then raise exception 'Fallo de supervisor'; end if;
  perform public.speedway_confirm_movement('pg-test-0',1);
  if (public.speedway_confirm_movement('pg-test-0',1)->>'duplicate')::boolean is not true then raise exception 'Fallo de idempotencia'; end if;
  if (select physical from public.speedway_balances where product_id='pg-test-product')<>5 then raise exception 'Saldo inicial incorrecto'; end if;
  begin
    update public.speedway_movements set delta=100 where event_id='pg-test-0';
    raise exception 'Fallo: modificación directa permitida';
  exception when insufficient_privilege then null; end;
end $$;

select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000002","role":"authenticated"}',true);
do $$ declare msg text; begin
  perform public.speedway_confirm_movement('pg-test-1',1);
  if (select physical from public.speedway_balances where product_id='pg-test-product')<>3 then raise exception 'Salida incorrecta'; end if;
  if exists(select 1 from public.speedway_events where id='pg-test-5') then raise exception 'RLS mostró evento ajeno'; end if;
  begin
    perform public.speedway_confirm_movement('pg-test-2',1); raise exception 'FALLO: conteo autorizado';
  exception when raise_exception then get stacked diagnostics msg=message_text; if msg<>'Se requiere supervisor' then raise exception '%',msg; end if; end;
  begin
    perform public.speedway_confirm_movement('pg-test-3',1); raise exception 'FALLO: provisional autorizado';
  exception when raise_exception then get stacked diagnostics msg=message_text; if msg<>'Se requiere supervisor' then raise exception '%',msg; end if; end;
  begin
    perform public.speedway_confirm_movement('pg-test-4',1); raise exception 'FALLO: negativo permitido';
  exception when raise_exception then get stacked diagnostics msg=message_text; if msg<>'Saldo insuficiente en este lote y vencimiento' then raise exception '%',msg; end if; end;
  begin
    perform public.speedway_confirm_movement('pg-test-5',1); raise exception 'FALLO: evento ajeno autorizado';
  exception when raise_exception then get stacked diagnostics msg=message_text; if msg<>'El borrador pertenece a otro usuario' then raise exception '%',msg; end if; end;
end $$;

-- User-editable metadata must not grant supervisor privileges.
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000003","role":"authenticated","user_metadata":{"role":"supervisor"}}',true);
do $$ begin
  if (public.speedway_access()->>'role') is not null then raise exception 'Escalada por metadata'; end if;
  if exists(select 1 from public.speedway_products) then raise exception 'RLS mostró datos a tercero'; end if;
end $$;
reset role;
select 'PASS: roles, RLS, idempotencia, saldo, aislamiento y bloqueo de escritura directa' as result;
rollback;

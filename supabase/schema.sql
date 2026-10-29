-- =====================================================================
--  NATALIA & EMANUEL · Base de datos de la invitación (Supabase / Postgres)
--  Se ejecuta (la primera vez y también cuando haya una versión nueva) en Supabase → SQL Editor → New query → Run.
--  Se puede volver a ejecutar sin romper nada ni borrar datos.
--
--  Seguridad: las tablas quedan CERRADAS al público (RLS activado y sin
--  permisos). La página solo puede llamar a las 4 funciones de abajo, que
--  exigen el código de 4 dígitos (o la clave de administración).
-- =====================================================================

-- ---------- Tablas ----------
create table if not exists public.invitations (
  id          bigint generated always as identity primary key,
  pin         text not null unique check (pin ~ '^[0-9]{4}$'),
  group_name  text not null,
  pays_card   boolean not null default false,   -- true = paga la tarjeta (solo cambia los colores; el control de pago es solo del panel privado)
  created_at  timestamptz not null default now()
);

create table if not exists public.guests (
  id            bigint generated always as identity primary key,
  invitation_id bigint not null references public.invitations(id) on delete cascade,
  name          text not null,
  attendance    text check (attendance in ('si','no')),
  responded_at  timestamptz,
  sort          int not null default 0
);
create index if not exists guests_invitation_idx on public.guests(invitation_id);

-- Datos privados de configuración (banco, precio, clave de admin)
-- Datos agregados en la segunda versión (seguro de re-ejecutar)
alter table public.invitations add column if not exists phone   text;                       -- WhatsApp del invitado principal
alter table public.invitations add column if not exists paid    boolean not null default false;  -- ¿ya pagó la tarjeta?
alter table public.invitations add column if not exists paid_at timestamptz;
alter table public.invitations add column if not exists category text;                      -- etiqueta interna (ej. Amigos colegio); nunca se muestra al invitado
alter table public.invitations add column if not exists message text;                       -- mensaje opcional para los novios
alter table public.guests      add column if not exists diet    text;                       -- restricción alimentaria (opcional)

create table if not exists public.settings (
  key   text primary key,
  value jsonb not null
);

-- Intentos fallidos de código/clave (freno contra adivinar códigos)
create table if not exists public.failed_attempts (
  id   bigint generated always as identity primary key,
  ip   text not null,
  at   timestamptz not null default now()
);
create index if not exists failed_attempts_ip_at_idx on public.failed_attempts(ip, at);

-- ---------- Cerrar las tablas al público ----------
alter table public.invitations     enable row level security;
alter table public.guests          enable row level security;
alter table public.settings        enable row level security;
alter table public.failed_attempts enable row level security;

revoke all on public.invitations, public.guests, public.settings, public.failed_attempts from anon, authenticated;

-- Vista cómoda para mirar la lista desde el Table Editor (cerrada al público)
drop view if exists public.lista_invitados;   -- se recrea (Postgres no deja reordenar columnas de una vista existente)
create view public.lista_invitados with (security_invoker = true) as
  select i.pin                                   as codigo,
         i.group_name                            as grupo,
         case when i.pays_card then 'PAGA' else 'DIRECTO' end as tipo,
         g.name                                  as invitado,
         case g.attendance when 'si' then 'Sí' when 'no' then 'No' else '' end as asistencia,
         g.responded_at                          as respondio,
         g.diet                                  as restriccion_alimentaria,
         i.message                               as mensaje,
         i.phone                                 as telefono,
         i.category                              as categoria,
         case when i.pays_card then (case when i.paid then 'Pagó' else 'Falta pagar' end) else '' end as pago
    from public.invitations i
    join public.guests g on g.invitation_id = i.id
   order by i.id, g.sort, g.id;
revoke all on public.lista_invitados from anon, authenticated;

-- ---------- Funciones auxiliares (no se pueden llamar desde la web) ----------
create or replace function public.client_ip_() returns text
language sql stable set search_path = public as $$
  select coalesce(
    nullif(nullif(current_setting('request.headers', true), '')::json ->> 'cf-connecting-ip', ''),
    nullif(split_part(coalesce(nullif(current_setting('request.headers', true), '')::json ->> 'x-forwarded-for', ''), ',', 1), ''),
    'desconocida')
$$;

create or replace function public.is_locked_(p_ip text) returns boolean
language sql stable security definer set search_path = public as $$
  select count(*) >= 10 from public.failed_attempts
   where ip = p_ip and at > now() - interval '10 minutes'
$$;

create or replace function public.register_failure_(p_ip text) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into public.failed_attempts(ip) values (p_ip);
  delete from public.failed_attempts where at < now() - interval '1 day';
end $$;

-- Texto del pago de la tarjeta (solo se devuelve a invitaciones que pagan)
create or replace function public.payment_note_() returns text
language sql stable security definer set search_path = public as $$
  select 'Hacemos este festejo entre todos para poder celebrar juntos. ' ||
         'El valor de la tarjeta por invitado es de ' || coalesce(value ->> 'card_price', '') || '. ' ||
         '¡Te esperamos para brindar! Por favor, confirmar asistencia y abonar hasta el ' ||
         coalesce(value ->> 'payment_deadline', '') || '.'
    from (select coalesce((select value from public.settings where key = 'config'), '{}'::jsonb) as value) s
$$;

-- ---------- 1) Abrir una invitación con el código de 4 dígitos ----------
create or replace function public.get_invitation(p_pin text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_pin    text := regexp_replace(coalesce(p_pin, ''), '\D', '', 'g');
  v_ip     text := public.client_ip_();
  v_inv    public.invitations;
  v_cfg    jsonb := coalesce((select value from public.settings where key = 'config'), '{}'::jsonb);
  v_guests jsonb;
begin
  if v_pin !~ '^[0-9]{4}$' then
    return jsonb_build_object('ok', false, 'message', 'Ingresá los 4 números de tu invitación.');
  end if;
  if public.is_locked_(v_ip) then
    return jsonb_build_object('ok', false, 'message', 'Demasiados intentos. Esperá unos minutos y probá de nuevo.');
  end if;

  select * into v_inv from public.invitations where pin = v_pin;
  if not found then
    perform public.register_failure_(v_ip);
    return jsonb_build_object('ok', false, 'message', 'No encontramos ese código. Revisalo e intentá nuevamente.');
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('id', g.id::text, 'name', g.name, 'attendance', coalesce(g.attendance, ''), 'diet', coalesce(g.diet, ''))
                            order by g.sort, g.id), '[]'::jsonb)
    into v_guests from public.guests g where g.invitation_id = v_inv.id;

  -- El tipo (PAGA / DIRECTO) no viaja al navegador: solo el comportamiento.
  return jsonb_build_object(
    'ok', true,
    'invitationId', v_inv.id::text,
    'groupName', v_inv.group_name,
    'guests', v_guests,
    'message', coalesce(v_inv.message, ''),
    'paysCard', v_inv.pays_card,
    'bank', v_cfg -> 'bank'
  );
end $$;

-- ---------- 2) Guardar la respuesta de cada persona ----------
-- p_answers: [{"id":"12","attends":true,"diet":"Celíaco"}, ...] · p_message: mensaje opcional.
-- Solo se pueden modificar personas que pertenecen a la invitación del código.
drop function if exists public.save_rsvp(text, jsonb);
create or replace function public.save_rsvp(p_pin text, p_answers jsonb, p_message text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_pin text := regexp_replace(coalesce(p_pin, ''), '\D', '', 'g');
  v_ip  text := public.client_ip_();
  v_inv public.invitations;
  v_n   int;
begin
  if v_pin !~ '^[0-9]{4}$' or p_answers is null or jsonb_typeof(p_answers) <> 'array'
     or jsonb_array_length(p_answers) > 40 then
    return jsonb_build_object('ok', false, 'message', 'Solicitud inválida.');
  end if;
  if public.is_locked_(v_ip) then
    return jsonb_build_object('ok', false, 'message', 'Demasiados intentos. Esperá unos minutos y probá de nuevo.');
  end if;

  select * into v_inv from public.invitations where pin = v_pin;
  if not found then
    perform public.register_failure_(v_ip);
    return jsonb_build_object('ok', false, 'message', 'Código de invitación inválido.');
  end if;

  update public.guests g
     set attendance   = case when a.value ->> 'attends' = 'true' then 'si' else 'no' end,
         diet         = case when a.value ->> 'attends' = 'true'
                             then nullif(left(trim(coalesce(a.value ->> 'diet', '')), 200), '') else null end,
         responded_at = now()
    from jsonb_array_elements(p_answers) as a(value)
   where g.invitation_id = v_inv.id
     and g.id::text = a.value ->> 'id'
     and a.value ? 'attends';
  get diagnostics v_n = row_count;

  update public.invitations set message = nullif(left(trim(coalesce(p_message, '')), 600), '')
   where id = v_inv.id;

  return jsonb_build_object('ok', true, 'updated', v_n, 'message', '¡Gracias! Tu confirmación quedó registrada.');
end $$;

-- Verifica la clave de administración (con freno de intentos). Solo uso interno.
create or replace function public.admin_check_(p_key text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_ip  text := public.client_ip_();
  v_adm jsonb := (select value from public.settings where key = 'admin');
begin
  if public.is_locked_(v_ip) then
    return jsonb_build_object('ok', false, 'message', 'Demasiados intentos. Esperá unos minutos y probá de nuevo.');
  end if;
  if v_adm is null or p_key is null
     or encode(sha256(convert_to((v_adm ->> 'salt') || p_key, 'UTF8')), 'hex') <> (v_adm ->> 'hash') then
    perform public.register_failure_(v_ip);
    return jsonb_build_object('ok', false, 'message', 'Clave incorrecta.');
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- ---------- 3) Panel de los novios (clave de administración) ----------
create or replace function public.admin_summary(p_key text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_chk  jsonb := public.admin_check_(p_key);
  v_tot  jsonb;
  v_list jsonb;
begin
  if not (v_chk ->> 'ok')::boolean then return v_chk; end if;

  select jsonb_build_object(
           'invitations',  (select count(*) from public.invitations),
           'people',       count(*),
           'yes',          count(*) filter (where g.attendance = 'si'),
           'no',           count(*) filter (where g.attendance = 'no'),
           'pending',      count(*) filter (where g.attendance is null),
           'yesPay',       count(*) filter (where g.attendance = 'si' and i.pays_card),
           'yesDirect',    count(*) filter (where g.attendance = 'si' and not i.pays_card),
           'payInvites',   count(distinct i.id) filter (where i.pays_card),
           'paidInvites',  count(distinct i.id) filter (where i.pays_card and i.paid))
    into v_tot
    from public.guests g join public.invitations i on i.id = g.invitation_id;

  select coalesce(jsonb_agg(jsonb_build_object(
           'pin', i.pin, 'group', i.group_name, 'paysCard', i.pays_card,
           'paid', i.paid, 'phone', coalesce(i.phone, ''), 'category', coalesce(i.category, ''), 'message', coalesce(i.message, ''),
           'guests', (select coalesce(jsonb_agg(jsonb_build_object(
                         'name', g.name, 'attendance', coalesce(g.attendance, ''),
                         'diet', coalesce(g.diet, ''), 'at', g.responded_at)
                         order by g.sort, g.id), '[]'::jsonb)
                      from public.guests g where g.invitation_id = i.id))
           order by i.id), '[]'::jsonb)
    into v_list from public.invitations i;

  return jsonb_build_object('ok', true, 'totals', v_tot, 'invitations', v_list);
end $$;

-- Marcar / desmarcar que una invitación ya pagó la tarjeta (desde el panel)
create or replace function public.admin_set_paid(p_key text, p_pin text, p_paid boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_chk jsonb := public.admin_check_(p_key); v_n int;
begin
  if not (v_chk ->> 'ok')::boolean then return v_chk; end if;
  update public.invitations
     set paid = coalesce(p_paid, false), paid_at = case when coalesce(p_paid, false) then now() else null end
   where pin = p_pin and pays_card;
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', v_n = 1);
end $$;

-- Cargar el teléfono de una invitación (desde el panel o el importador)
create or replace function public.admin_set_phone(p_key text, p_pin text, p_phone text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_chk jsonb := public.admin_check_(p_key); v_n int;
begin
  if not (v_chk ->> 'ok')::boolean then return v_chk; end if;
  update public.invitations set phone = nullif(left(regexp_replace(coalesce(p_phone, ''), '[^0-9+]', '', 'g'), 20), '')
   where pin = p_pin;
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', v_n = 1);
end $$;

-- ---------- 4) Latido: mantiene activo el proyecto gratuito ----------
create or replace function public.ping() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('ok', true, 'invitations', (select count(*) from public.invitations))
$$;

-- ---------- Funciones de uso privado (solo desde el SQL Editor) ----------
create or replace function public.set_admin_key(p_key text) returns void
language plpgsql security definer set search_path = public as $$
declare v_salt text := md5(random()::text || clock_timestamp()::text);
begin
  if length(coalesce(p_key, '')) < 10 then
    raise exception 'La clave de administración debe tener al menos 10 caracteres.';
  end if;
  insert into public.settings(key, value)
  values ('admin', jsonb_build_object('salt', v_salt,
                   'hash', encode(sha256(convert_to(v_salt || p_key, 'UTF8')), 'hex')))
  on conflict (key) do update set value = excluded.value;
end $$;

-- add_invitation('Familia Pérez', true, array['Juan Pérez','María López'])
-- Crea la invitación con un código de 4 dígitos al azar (o el que indiques) y devuelve ese código.
drop function if exists public.add_invitation(text, boolean, text[], text);
create or replace function public.add_invitation(p_group text, p_pays boolean, p_names text[], p_pin text default null, p_phone text default null)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_pin text := p_pin;
  v_id  bigint;
  v_i   int := 0;
  v_n   text;
begin
  if coalesce(array_length(p_names, 1), 0) = 0 then
    raise exception 'Falta al menos un nombre de invitado.';
  end if;
  if v_pin is null then
    loop
      v_pin := lpad(floor(random() * 10000)::int::text, 4, '0');
      exit when not exists (select 1 from public.invitations where pin = v_pin);
    end loop;
  end if;
  insert into public.invitations(pin, group_name, pays_card, phone)
  values (v_pin, p_group, p_pays, nullif(regexp_replace(coalesce(p_phone, ''), '[^0-9+]', '', 'g'), '')) returning id into v_id;
  foreach v_n in array p_names loop
    v_i := v_i + 1;
    insert into public.guests(invitation_id, name, sort) values (v_id, trim(v_n), v_i);
  end loop;
  return v_pin;
end $$;

-- ---------- Permisos de las funciones ----------
revoke all on function public.client_ip_(), public.is_locked_(text), public.register_failure_(text), public.payment_note_(),
  public.admin_check_(text), public.set_admin_key(text), public.add_invitation(text, boolean, text[], text, text)
  from public, anon, authenticated;
revoke all on function public.get_invitation(text), public.save_rsvp(text, jsonb, text), public.admin_summary(text),
  public.admin_set_paid(text, text, boolean), public.admin_set_phone(text, text, text), public.ping()
  from public, anon, authenticated;
grant execute on function public.get_invitation(text), public.save_rsvp(text, jsonb, text),
  public.admin_summary(text), public.admin_set_paid(text, text, boolean), public.admin_set_phone(text, text, text),
  public.ping() to anon, authenticated;

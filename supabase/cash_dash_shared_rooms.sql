-- Shared Cash Dash room storage. This was applied to the configured project.
-- Game data stays in a private schema; clients can only use the guarded RPCs.
create schema if not exists private;

create table if not exists private.cash_dash_rooms (
  room_id uuid primary key,
  room_key uuid not null,
  game_state jsonb,
  command jsonb,
  command_id bigint not null default 0 check (command_id >= 0),
  screen_status jsonb,
  screen_seen_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table private.cash_dash_rooms enable row level security;
revoke all on schema private from public, anon, authenticated;
revoke all on private.cash_dash_rooms from public, anon, authenticated;

create or replace function public.cash_dash_create_room(
  p_room_id uuid, p_room_key uuid, p_initial_state jsonb
) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  insert into private.cash_dash_rooms (room_id, room_key, game_state, updated_at)
  values (p_room_id, p_room_key, p_initial_state, now())
  on conflict (room_id) do nothing;
  return exists (
    select 1 from private.cash_dash_rooms
    where room_id = p_room_id and room_key = p_room_key
  );
end;
$$;

create or replace function public.cash_dash_get_room(
  p_room_id uuid, p_room_key uuid, p_since bigint default 0,
  p_mark_screen_seen boolean default false
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare result jsonb;
begin
  if p_mark_screen_seen then
    update private.cash_dash_rooms
    set screen_seen_at = now(), updated_at = now()
    where room_id = p_room_id and room_key = p_room_key;
  end if;
  select jsonb_build_object(
    'gameState', game_state,
    'command', case when command_id > p_since
      then jsonb_build_object('id', command_id, 'value', command) else null end,
    'commandId', command_id,
    'screenStatus', screen_status,
    'connected', screen_seen_at > now() - interval '5 seconds'
  ) into result
  from private.cash_dash_rooms
  where room_id = p_room_id and room_key = p_room_key;
  return result;
end;
$$;

create or replace function public.cash_dash_set_game_state(
  p_room_id uuid, p_room_key uuid, p_game_state jsonb
) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  update private.cash_dash_rooms
  set game_state = p_game_state, updated_at = now()
  where room_id = p_room_id and room_key = p_room_key;
  return found;
end;
$$;

create or replace function public.cash_dash_set_screen_status(
  p_room_id uuid, p_room_key uuid, p_screen_status jsonb
) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  update private.cash_dash_rooms
  set screen_status = p_screen_status, updated_at = now()
  where room_id = p_room_id and room_key = p_room_key;
  return found;
end;
$$;

create or replace function public.cash_dash_send_command(
  p_room_id uuid, p_room_key uuid, p_command jsonb
) returns bigint
language plpgsql security definer set search_path = '' as $$
declare next_command_id bigint;
begin
  update private.cash_dash_rooms
  set command_id = command_id + 1, command = p_command, updated_at = now()
  where room_id = p_room_id and room_key = p_room_key
  returning command_id into next_command_id;
  return next_command_id;
end;
$$;

revoke all on function public.cash_dash_create_room(uuid, uuid, jsonb) from public;
revoke all on function public.cash_dash_get_room(uuid, uuid, bigint, boolean) from public;
revoke all on function public.cash_dash_set_game_state(uuid, uuid, jsonb) from public;
revoke all on function public.cash_dash_set_screen_status(uuid, uuid, jsonb) from public;
revoke all on function public.cash_dash_send_command(uuid, uuid, jsonb) from public;

grant execute on function public.cash_dash_create_room(uuid, uuid, jsonb) to anon;
grant execute on function public.cash_dash_get_room(uuid, uuid, bigint, boolean) to anon;
grant execute on function public.cash_dash_set_game_state(uuid, uuid, jsonb) to anon;
grant execute on function public.cash_dash_set_screen_status(uuid, uuid, jsonb) to anon;
grant execute on function public.cash_dash_send_command(uuid, uuid, jsonb) to anon;

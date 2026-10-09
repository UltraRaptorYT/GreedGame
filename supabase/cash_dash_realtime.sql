-- Notify room clients only when a facilitator command or screen status changes.
-- The topic includes the unguessable room key so each classroom has its own channel.
create or replace function public.cash_dash_broadcast_room_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.command_id is distinct from old.command_id
     or new.screen_status is distinct from old.screen_status then
    perform realtime.send(
      jsonb_build_object('commandId', new.command_id),
      'room_update',
      'cash-dash:' || new.room_key::text,
      false
    );
  end if;
  return new;
end;
$$;

revoke all on function public.cash_dash_broadcast_room_update() from public, anon, authenticated;

drop trigger if exists cash_dash_broadcast_room_update on private.cash_dash_rooms;
create trigger cash_dash_broadcast_room_update
after update on private.cash_dash_rooms
for each row execute function public.cash_dash_broadcast_room_update();

-- The screen now checks in every 30 seconds; leave room for background-tab delays.
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
    'connected', screen_seen_at > now() - interval '65 seconds'
  ) into result
  from private.cash_dash_rooms
  where room_id = p_room_id and room_key = p_room_key;
  return result;
end;
$$;

revoke all on function public.cash_dash_get_room(uuid, uuid, bigint, boolean) from public;
grant execute on function public.cash_dash_get_room(uuid, uuid, bigint, boolean) to anon;

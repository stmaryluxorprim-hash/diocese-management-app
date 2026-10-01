-- Test helper (20261004120000): signup is invite-only. Creates one unlimited
-- invite per kind (as superuser) and exposes the tokens as settings
-- test.inv_servant / test.inv_child / test.inv_priest for the older tests.
do $$
declare t text; k text;
begin
  foreach k in array array['servant', 'child', 'priest'] loop
    t := encode(gen_random_bytes(18), 'hex');
    insert into public.signup_invites (kind, token_hash, expires_at) values (k, encode(digest(t, 'sha256'), 'hex'), now() + interval '1 day');
    perform set_config('test.inv_' || k, t, false);
  end loop;
end $$;

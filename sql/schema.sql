-- Zaženi to v Supabase projektu: Dashboard -> SQL Editor -> New query -> prilepi -> Run

create table if not exists oauth_tokens (
  platform text primary key,           -- 'fanvue' | 'instagram' | 'tiktok'
  access_token text not null,
  refresh_token text,
  expires_at bigint,                   -- unix ms
  account_label text,
  updated_at bigint not null
);

create table if not exists platform_settings (
  platform text primary key,
  instructions text not null default '',
  trigger_words jsonb not null default '[]',
  auto_reply_enabled boolean not null default true
);

create table if not exists conversations (
  id bigint generated always as identity primary key,
  platform text not null,
  external_chat_id text not null,
  fan_name text,
  incoming_message text,
  ai_reply text,
  status text not null,                -- 'ok' | 'warn' | 'problem'
  reason text,
  created_at bigint not null
);

create index if not exists idx_conversations_platform on conversations (platform, created_at desc);

insert into platform_settings (platform, instructions, trigger_words, auto_reply_enabled)
values
  ('fanvue',
   'Bodi topel in oseben, a nikoli ne obljubljaj česa, česar ni mogoče dostaviti. Pri vprašanjih o naročnini usmeri na nastavitve profila. Vsako nejasno ali prazno sporočilo označi kot problem za ročni pregled.',
   '["naročnina", "podaljšaj", "vsebina", "plačilo"]'::jsonb,
   true),
  ('instagram',
   'Odgovarjaj prijazno in jedrnato, v slovenščini. Pri vprašanjih o ceni ali dostavi podaj konkretne podatke. Če uporabnik zahteva pogovor z osebo, sporočilo označi kot ''Čaka''.',
   '["cena", "termin", "dostava", "podpora"]'::jsonb,
   true),
  ('tiktok',
   'Odgovarjaj kratko, sproščeno in z energijo. Poslovna povpraševanja vedno označi kot ''Čaka'' za potrditev ekipe, nikoli jih ne potrjuj samodejno.',
   '["sodelovanje", "promocija", "glasba", "kontakt"]'::jsonb,
   true)
on conflict (platform) do nothing;

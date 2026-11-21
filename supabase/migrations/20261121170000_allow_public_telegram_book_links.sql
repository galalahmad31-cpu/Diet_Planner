-- Accept both public Telegram channel/user links and private invite links.
-- Public links use a 5-32 character Telegram username; invite links retain
-- the existing +token and joinchat/token formats.
alter table public.book_delivery_links
  drop constraint if exists book_delivery_links_private_invite_url_check;

alter table public.book_delivery_links
  add constraint book_delivery_links_telegram_url_check
  check (
    telegram_url ~* '^https://(t\.me|telegram\.me)/((\+|joinchat/)[A-Za-z0-9_-]+|[A-Za-z][A-Za-z0-9_]{4,31})/?$'
  );
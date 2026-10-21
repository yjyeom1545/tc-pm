-- 참고용: 실제 DB(tc-ai-office)에는 이 내용이 이미 적용되어 있습니다. 다시 실행할 필요 없습니다.
-- TC 생산관리(tc-pm) : 외주 입고 등록 · 월마감 대사
-- 승인된 사용자만 데이터 접근. 첫 가입자는 자동으로 관리자.

create table if not exists public.pm_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  name text not null default '',
  email text,
  role text not null default 'staff' check (role in ('staff','admin')),
  approved boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.pm_items (
  code text primary key,                 -- 모델 ID 또는 ERP 품번 (예: Z45OSC, CW01, 1301223)
  name text not null,                    -- 화면 표시명
  category text not null default '모델', -- 모델 / 단품 / CWT
  unit text not null default '대',       -- 대 / ea / kg
  vendor text not null default '대림에스앤티',
  sort int not null default 100,
  active boolean not null default true
);

create table if not exists public.pm_prices (
  id bigserial primary key,
  code text not null references public.pm_items(code) on update cascade,
  price numeric not null,
  valid_from date not null,
  note text,
  created_at timestamptz not null default now(),
  unique (code, valid_from)
);

create table if not exists public.pm_receipts (
  id uuid primary key default gen_random_uuid(),
  po text not null unique check (po ~ '^PO[0-9]{8}$'),
  recv_date date not null,
  vendor text not null default '대림에스앤티',
  pre_reg boolean not null default false,   -- 선등록(출고대기·선입고)
  note text,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists pm_receipts_date_idx on public.pm_receipts (recv_date);

create table if not exists public.pm_receipt_lines (
  id bigserial primary key,
  receipt_id uuid not null references public.pm_receipts(id) on delete cascade,
  code text not null references public.pm_items(code) on update cascade,
  qty numeric not null check (qty > 0),
  unit_price numeric not null,
  amount numeric not null,
  price_overridden boolean not null default false
);
create index if not exists pm_receipt_lines_rid_idx on public.pm_receipt_lines (receipt_id);
create index if not exists pm_receipt_lines_code_idx on public.pm_receipt_lines (code);

create table if not exists public.pm_config (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.pm_closings (
  id bigserial primary key,
  month text not null unique,              -- '2026-09'
  locked boolean not null default true,    -- true면 해당 월 입고 수정 불가
  erp_amt numeric, vendor_amt numeric, staff_amt numeric,
  ok int, warn int, bad int, date_diff int,
  summary jsonb, rows jsonb,
  erp_file text, vendor_file text,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_by_name text,
  created_at timestamptz not null default now()
);

-- ===== 권한 헬퍼 =====
create or replace function public.pm_is_approved() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.pm_profiles where user_id = auth.uid() and approved);
$$;
create or replace function public.pm_is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.pm_profiles where user_id = auth.uid() and approved and role = 'admin');
$$;
create or replace function public.pm_month_locked(d date) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.pm_closings where month = to_char(d, 'YYYY-MM') and locked);
$$;

-- 가입 시 프로필 자동 생성 (첫 사용자 = 관리자·승인)
create or replace function public.pm_handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare first boolean;
begin
  select not exists (select 1 from public.pm_profiles) into first;
  insert into public.pm_profiles (user_id, name, email, role, approved)
  values (new.id, coalesce(new.raw_user_meta_data->>'name', split_part(new.email,'@',1)), new.email,
          case when first then 'admin' else 'staff' end, first);
  return new;
end $$;
drop trigger if exists pm_on_auth_user_created on auth.users;
create trigger pm_on_auth_user_created after insert on auth.users
  for each row execute function public.pm_handle_new_user();

-- 입고 작성자 이름 자동 기록 / 수정시각
create or replace function public.pm_receipt_stamp() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(new.created_by, auth.uid());
    new.created_by_name := coalesce((select name from public.pm_profiles where user_id = new.created_by), new.created_by_name);
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists pm_receipt_stamp on public.pm_receipts;
create trigger pm_receipt_stamp before insert or update on public.pm_receipts
  for each row execute function public.pm_receipt_stamp();

-- ===== RLS =====
alter table public.pm_profiles enable row level security;
alter table public.pm_items enable row level security;
alter table public.pm_prices enable row level security;
alter table public.pm_receipts enable row level security;
alter table public.pm_receipt_lines enable row level security;
alter table public.pm_config enable row level security;
alter table public.pm_closings enable row level security;

-- 프로필: 본인 것은 항상 조회(승인 대기 화면용), 승인자는 전체 조회, 관리자만 수정
create policy pm_profiles_sel on public.pm_profiles for select to authenticated
  using (user_id = (select auth.uid()) or (select public.pm_is_approved()));
create policy pm_profiles_upd on public.pm_profiles for update to authenticated
  using ((select public.pm_is_admin())) with check ((select public.pm_is_admin()));
create policy pm_profiles_del on public.pm_profiles for delete to authenticated
  using ((select public.pm_is_admin()) and user_id <> (select auth.uid()));

-- 기준정보: 승인자 조회, 관리자 수정
create policy pm_items_sel on public.pm_items for select to authenticated using ((select public.pm_is_approved()));
create policy pm_items_all on public.pm_items for all to authenticated using ((select public.pm_is_admin())) with check ((select public.pm_is_admin()));
create policy pm_prices_sel on public.pm_prices for select to authenticated using ((select public.pm_is_approved()));
create policy pm_prices_all on public.pm_prices for all to authenticated using ((select public.pm_is_admin())) with check ((select public.pm_is_admin()));
create policy pm_config_sel on public.pm_config for select to authenticated using ((select public.pm_is_approved()));
create policy pm_config_all on public.pm_config for all to authenticated using ((select public.pm_is_admin())) with check ((select public.pm_is_admin()));

-- 입고: 승인자 조회·등록, 본인 또는 관리자 수정·삭제, 마감 잠긴 월은 수정 불가
create policy pm_receipts_sel on public.pm_receipts for select to authenticated using ((select public.pm_is_approved()));
create policy pm_receipts_ins on public.pm_receipts for insert to authenticated
  with check ((select public.pm_is_approved()) and not public.pm_month_locked(recv_date));
create policy pm_receipts_upd on public.pm_receipts for update to authenticated
  using ((select public.pm_is_approved()) and (created_by = (select auth.uid()) or (select public.pm_is_admin())) and not public.pm_month_locked(recv_date))
  with check (not public.pm_month_locked(recv_date));
create policy pm_receipts_del on public.pm_receipts for delete to authenticated
  using ((select public.pm_is_approved()) and (created_by = (select auth.uid()) or (select public.pm_is_admin())) and not public.pm_month_locked(recv_date));

create policy pm_lines_sel on public.pm_receipt_lines for select to authenticated using ((select public.pm_is_approved()));
create policy pm_lines_write on public.pm_receipt_lines for all to authenticated
  using (exists (select 1 from public.pm_receipts r where r.id = receipt_id and (r.created_by = (select auth.uid()) or (select public.pm_is_admin())) and not public.pm_month_locked(r.recv_date)) and (select public.pm_is_approved()))
  with check (exists (select 1 from public.pm_receipts r where r.id = receipt_id and (r.created_by = (select auth.uid()) or (select public.pm_is_admin())) and not public.pm_month_locked(r.recv_date)) and (select public.pm_is_approved()));

-- 마감: 승인자 조회·저장, 관리자만 수정·삭제(잠금 해제)
create policy pm_closings_sel on public.pm_closings for select to authenticated using ((select public.pm_is_approved()));
create policy pm_closings_ins on public.pm_closings for insert to authenticated with check ((select public.pm_is_approved()));
create policy pm_closings_upd on public.pm_closings for update to authenticated using ((select public.pm_is_admin())) with check ((select public.pm_is_admin()));
create policy pm_closings_del on public.pm_closings for delete to authenticated using ((select public.pm_is_admin()));

-- 함수 실행 권한 정리
revoke execute on function public.pm_handle_new_user() from public, anon, authenticated;
revoke execute on function public.pm_receipt_stamp() from public, anon, authenticated;

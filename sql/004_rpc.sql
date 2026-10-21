-- 참고용: 실제 DB(tc-ai-office)에는 이 내용이 이미 적용되어 있습니다. 다시 실행할 필요 없습니다.
-- 신규 입고 저장(헤더+라인 한 번에, RLS 그대로 적용). 수정은 화면에서 헤더 수정 → 라인 교체로 처리.
create or replace function public.pm_new_receipt(p jsonb) returns uuid
language plpgsql security invoker set search_path = public as $$
declare rid uuid; ln jsonb;
begin
  if jsonb_array_length(coalesce(p->'lines','[]'::jsonb)) = 0 then raise exception '품목을 1개 이상 입력하세요'; end if;
  insert into pm_receipts (po, recv_date, pre_reg, note)
  values (upper(trim(p->>'po')), (p->>'recv_date')::date, coalesce((p->>'pre_reg')::boolean,false), nullif(p->>'note',''))
  returning id into rid;
  for ln in select * from jsonb_array_elements(p->'lines') loop
    insert into pm_receipt_lines (receipt_id, code, qty, unit_price, amount, price_overridden)
    values (rid, ln->>'code', (ln->>'qty')::numeric, (ln->>'unit_price')::numeric,
            round((ln->>'qty')::numeric * (ln->>'unit_price')::numeric), coalesce((ln->>'overridden')::boolean,false));
  end loop;
  return rid;
end $$;
revoke execute on function public.pm_new_receipt(jsonb) from public, anon;
grant execute on function public.pm_new_receipt(jsonb) to authenticated;

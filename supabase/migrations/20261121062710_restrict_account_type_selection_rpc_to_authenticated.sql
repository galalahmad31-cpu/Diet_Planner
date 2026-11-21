revoke execute on function public.complete_account_type_selection(text) from public;
revoke execute on function public.complete_account_type_selection(text) from anon;
grant execute on function public.complete_account_type_selection(text) to authenticated;
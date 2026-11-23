do $guard$ begin raise exception 'An already applied staging migration was selected. Stop.'; end $guard$;

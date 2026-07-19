# Scripts to get the data about the latest projects being made on the uniqus code platform.

``` sql
select
  p.id,
  p.name,
  p.description,
  u.email          as owner_email,
  u.display_name   as owner_name,
  u.account_type   as owner_account_type,   -- 'standard' | 'guest'
  o.name           as org_name,
  p.github_repo_full_name,
  p.vercel_project_name,
  p.created_at,
  p.updated_at
from projects p
join users u          on u.id = p.owner_id
left join organizations o on o.id = p.org_id
order by p.created_at desc
limit 50;
```

# Version that gives each project's latest deploy status and how much activity it's had.


``` sql
select
  p.id,
  p.name,
  u.email        as owner_email,
  u.display_name as owner_name,
  o.name         as org_name,
  p.created_at,
  p.updated_at   as last_activity,
  d.state        as last_deploy_state,
  d.created_at   as last_deploy_at,
  (select count(*) from messages m where m.project_id = p.id) as message_count
from projects p
join users u on u.id = p.owner_id
left join organizations o on o.id = p.org_id
left join lateral (
  select state, created_at
  from deployments
  where project_id = p.id
  order by created_at desc
  limit 1
) d on true
order by p.created_at desc
limit 50;
```
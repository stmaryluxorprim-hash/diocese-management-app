-- =====================================================================
-- SEED TEST DATA — بيانات تجريبية كاملة لكل وحدات التطبيق
-- =====================================================================
-- Fills EVERY table of the schema (0001 → 0050) with realistic Arabic
-- demo data so the whole app can be shown and tested:
--   البنية: 2 كنائس · 3 خدمات · 5 فصول
--   الخدام: 8 حسابات (مالك · مدير كنيسة · مسؤول خدمة · 3 خدام · طلب معلق
--           · خادم موقوف) + نطاقات إضافية (خادم يخدم في فصلين) + صفوف
--           المرآة في enrollments (kind = servant — يُنشئها المشغّل تلقائياً)
--   المخدومين: 26 شخصاً · 27 تسجيلاً (واحد مسجّل في فصلين · واحد موقوف)
--   حسابات المخدومين: كلمات مرور · جلسات بوابة حيّة · طلبات انضمام
--   المناسبات (events) · الأسباب · الافتراضي لكل مستوى · نتائج الافتقاد
--   حضور 8 أسابيع · نقاط · الاتصالات · الكروت وطباعتها · ملفات الطباعة
--   مجموعات الافتقاد · المتجر وفواتيره
--   الامتحانات الإلكترونية ومحاولاتها · أعياد الميلاد وهداياها
--   الرسائل (طفل/خادم/بث) · الفصول الأونلاين · الإنجازات · الفعاليات
--   الإشعارات وأتمتتها · نتائج الامتحانات وأنظمة التقدير · المكتبة
--   التقارير والجداول (قوالب محفوظة) · النسخ الاحتياطي (جدولة + سجل)
--   سجل النشاط (كل عملية في هذا الملف تُسجَّل باسم الخادم الذي «قام بها»)
--   ملفات الصلاحيات · صلاحيات الوحدات · تخصيص التطبيق (ودجات · أسماء ·
--   تنقّل · نظام الأكواد · إعدادات سجل النشاط) · طلبات تعديل البيانات
--
-- HOW TO RUN
--   Supabase → SQL Editor → paste the whole file → Run.   (once)
--   Local:  psql -d app -v ON_ERROR_STOP=1 -f supabase/seed_test_data.sql
--
-- LOGIN ACCOUNTS (login = الكود · password = Test@1234 for all)
--   ┌──────────────────────────┬────────────────┬──────────────────────────────┐
--   │ الدور                    │ الكود (login)  │ النطاق                        │
--   ├──────────────────────────┼────────────────┼──────────────────────────────┤
--   │ مالك التطبيق owner       │ 10000000000001 │ كل شيء                        │
--   │ مدير كنيسة               │ 10000000000002 │ كنيسة العذراء — الأقصر        │
--   │ مسؤول خدمة               │ 10000000000003 │ مدارس الأحد — كنيسة العذراء    │
--   │ خادم فصل                 │ 10000000000004 │ فصل إعدادي                    │
--   │ خادم فصل                 │ 10000000000005 │ فصل ابتدائي                   │
--   │ خادم فصل (كنيسة ٢)       │ 10000000000006 │ ابتدائي — كنيسة مارجرجس       │
--   │ طلب انضمام معلق          │ 10000000000007 │ (pending — يظهر في الطلبات)    │
--   │ خادم موقوف (suspended)   │ 10000000000008 │ ثانوي — لا يستطيع الدخول      │
--   └──────────────────────────┴────────────────┴──────────────────────────────┘
--   Servant 10000000000004 (جورج) also serves in فصل ثانوي (servant_scopes).
--
--   Child portal (بوابة المخدوم) — login = code + password (migration 0042):
--     · 30101010100001 … 30101010100026  → password 123456  (set by a servant)
--     · 30101010100005 (أبانوب)           → password 000000  (default — never set)
--     · 30101010100021 (بيتر)             → STOPPED (موقوف) — login refused
--     · 30101010100099 / 30101010100098    → pending / rejected join requests
--
-- SAFE TO RE-RUN?  No — run supabase/wipe_test_data.sql first, then this.
-- Every seeded row uses a fixed UUID prefix so the wipe script can also
-- remove the seeded auth users:  a0000000-0000-4000-8000-0000000000NN
--
-- Works on Supabase (real auth.users + auth.identities, password hashed
-- with pgcrypto) AND on the local shim (supabase/tests/local_shim.sql).
-- Dates are relative to today so widgets (اليوم · هذا الأسبوع · أعياد
-- الميلاد القادمة · المناسبة الآن) always have something to show.
-- =====================================================================
begin;
set local search_path = public, extensions;
set local client_min_messages = warning;

-- Everything below is written «as the owner» for the activity log (0047):
-- the audit trigger resolves the actor from auth.uid(). Individual sections
-- switch the actor (pg_temp.act) so the log shows WHO did what. On Supabase
-- the SQL editor runs as postgres, so setting the claim is harmless.
do $$ begin
  perform set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000001', true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
end $$;

-- ---------------------------------------------------------------------
-- 0. Helpers (temporary — live only in this session)
-- ---------------------------------------------------------------------
-- Create a login account. On Supabase → full auth.users + auth.identities
-- row (email = <code>@diocese.app, password hashed). On the local shim →
-- a bare auth.users row.
create or replace function pg_temp.seed_user(p_id uuid, p_code text, p_password text)
returns void language plpgsql as $$
declare v_email text := lower(p_code) || '@diocese.app';
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'auth' and table_name = 'users' and column_name = 'encrypted_password') then
    execute format($q$
      insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                              raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                              confirmation_token, recovery_token, email_change_token_new, email_change)
      values ('00000000-0000-0000-0000-000000000000', %L, 'authenticated', 'authenticated', %L,
              crypt(%L, gen_salt('bf')), now(),
              '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', '')
      on conflict (id) do nothing$q$, p_id, v_email, p_password);
    if to_regclass('auth.identities') is not null then
      execute format($q$
        insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
        values (gen_random_uuid(), %L, %L, jsonb_build_object('sub', %L, 'email', %L, 'email_verified', true), 'email', now(), now(), now())
        on conflict do nothing$q$, p_id, p_id::text, p_id::text, v_email);
    end if;
  else
    insert into auth.users (id, email) values (p_id, v_email) on conflict (id) do nothing;
  end if;
end $$;

-- switch the «current user» for the audit trigger (0047) — transaction-local
create or replace function pg_temp.act(p_servant uuid)
returns void language sql as $$
  select set_config('request.jwt.claim.sub', p_servant::text, true)
$$;

-- a birthdate that falls N days from today, X years ago (for the birthday widgets)
create or replace function pg_temp.bday(p_days_from_today int, p_years int)
returns date language sql immutable as $$
  select make_date(extract(year from current_date)::int - p_years,
                   extract(month from current_date + p_days_from_today)::int,
                   extract(day   from current_date + p_days_from_today)::int)
$$;

-- card-design builders (shape mirrors src/lib/card-types.ts)
create or replace function pg_temp.el(p_id text, p_type text, p_x numeric, p_y numeric, p_w numeric, p_h numeric, p_extra jsonb default '{}', p_style jsonb default '{}')
returns jsonb language sql immutable as $$
  select jsonb_build_object('id', p_id, 'type', p_type, 'x', p_x, 'y', p_y, 'w', p_w, 'h', p_h, 'rotation', 0,
           'imageFit', case when p_type in ('qr','logo') then 'contain' else 'cover' end,
           'borderRadius', case when p_type = 'qr' then 0 else 2 end, 'opacity', 1,
           'bgEnabled', false, 'bgColor', '#ffffff', 'bgOpacity', 1,
           'strokeEnabled', false, 'strokeColor', '#000000', 'strokeWidth', 0.3,
           'lockAspect', p_type in ('photo','qr','logo','image'),
           'style', jsonb_build_object('fontFamily', 'Cairo', 'fontSize', 12, 'color', '#1e293b', 'bold', true, 'italic', false, 'align', 'center') || p_style)
         || p_extra
$$;
create or replace function pg_temp.design(p_w numeric, p_h numeric, p_bg text, p_border text, p_elements jsonb)
returns jsonb language sql immutable as $$
  select jsonb_build_object('version', 1, 'width', p_w, 'height', p_h, 'cornerRadius', 3,
           'background', jsonb_build_object('color', p_bg, 'imageUrl', null, 'imageFit', 'cover', 'imageOpacity', 1, 'zoom', 1, 'offsetX', 0, 'offsetY', 0),
           'border', jsonb_build_object('enabled', true, 'color', p_border, 'width', 0.5),
           'elements', p_elements)
$$;
create or replace function pg_temp.print_settings(p_orientation text default 'portrait', p_paper text default 'A4', p_margin numeric default 10, p_gap numeric default 4, p_cut boolean default false, p_align_h text default 'center', p_align_v text default 'top')
returns jsonb language sql immutable as $$
  select jsonb_build_object('version', 1, 'paper', p_paper, 'centerLineV', false, 'centerLineH', false,
           'customWidth', case p_paper when 'A3' then 297 when 'A5' then 148 else 210 end,
           'customHeight', case p_paper when 'A3' then 420 when 'A5' then 210 else 297 end,
           'orientation', p_orientation, 'marginTop', p_margin, 'marginBottom', p_margin, 'marginRight', p_margin, 'marginLeft', p_margin,
           'gapX', p_gap, 'gapY', p_gap, 'cutMarks', p_cut, 'alignH', p_align_h, 'alignV', p_align_v)
$$;

-- ---------------------------------------------------------------------
-- 1. البنية — churches · services · classes
-- ---------------------------------------------------------------------
insert into public.churches (id, name, address) values
  ('a1000000-0000-4000-8000-000000000001', 'كنيسة العذراء مريم — الأقصر', 'شارع الكرنك، الأقصر'),
  ('a1000000-0000-4000-8000-000000000002', 'كنيسة مارجرجس — إسنا', 'ميدان المحطة، إسنا');

insert into public.services (id, church_id, name, description) values
  ('a2000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'مدارس الأحد', 'خدمة أطفال وشباب مدارس الأحد — الجمعة'),
  ('a2000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001', 'اجتماع الشباب', 'اجتماع الشباب الجامعي — الخميس'),
  ('a2000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000002', 'مدارس الأحد', 'مدارس الأحد — كنيسة مارجرجس');

insert into public.classes (id, church_id, service_id, name, description) values
  ('a3000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', 'ابتدائي', 'من الصف الأول إلى السادس الابتدائي'),
  ('a3000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', 'إعدادي', 'المرحلة الإعدادية'),
  ('a3000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', 'ثانوي', 'المرحلة الثانوية'),
  ('a3000000-0000-4000-8000-000000000004', 'a1000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000002', 'شباب جامعي', 'طلبة الجامعة'),
  ('a3000000-0000-4000-8000-000000000005', 'a1000000-0000-4000-8000-000000000002', 'a2000000-0000-4000-8000-000000000003', 'ابتدائي', 'ابتدائي — مارجرجس');

-- ---------------------------------------------------------------------
-- 2. الخدام — auth users → persons → servant_enrollments
--    (the servant IS a person; code = national_id = login)
-- ---------------------------------------------------------------------
do $$ begin
  perform pg_temp.seed_user(('a0000000-0000-4000-8000-00000000000' || i)::uuid, '1000000000000' || i, 'Test@1234')
    from generate_series(1, 8) i;
end $$;

insert into public.persons (id, national_id, name, gender, birthdate, phone, address, notes) values
  ('b0000000-0000-4000-8000-000000000001', '10000000000001', 'أبونا يوحنا — مالك التطبيق', 'male',   '1975-03-12', '+201000000001', 'الأقصر', 'حساب المالك التجريبي'),
  ('b0000000-0000-4000-8000-000000000002', '10000000000002', 'مينا عادل',                   'male',   '1985-07-01', '+201000000002', 'الأقصر — الكرنك', 'مدير كنيسة العذراء'),
  ('b0000000-0000-4000-8000-000000000003', '10000000000003', 'مريم سامح',                   'female', '1990-11-20', '+201000000003', 'الأقصر', 'مسؤولة خدمة مدارس الأحد'),
  ('b0000000-0000-4000-8000-000000000004', '10000000000004', 'جورج فايز',                   'male',   '1996-02-14', '+201000000004', 'الأقصر — العوامية', 'خادم فصل إعدادي'),
  ('b0000000-0000-4000-8000-000000000005', '10000000000005', 'مارينا نبيل',                 'female', '1998-09-09', '+201000000005', 'الأقصر', 'خادمة فصل ابتدائي'),
  ('b0000000-0000-4000-8000-000000000006', '10000000000006', 'بيشوي رأفت',                  'male',   '1994-05-30', '+201000000006', 'إسنا', 'خادم — كنيسة مارجرجس'),
  ('b0000000-0000-4000-8000-000000000007', '10000000000007', 'كيرلس ماهر',                  'male',   '2001-12-25', '+201000000007', 'الأقصر', 'طلب انضمام جديد'),
  ('b0000000-0000-4000-8000-000000000008', '10000000000008', 'هاني عزت',                    'male',   '1992-08-17', '+201000000008', 'الأقصر — البغدادي', 'خادم موقوف مؤقتاً — مسافر للعمل');

insert into public.servant_enrollments (id, full_name, user_id, phone, role, status, church_id, service_id, class_id, person_id, approved_by, approved_at, photo_url) values
  ('a0000000-0000-4000-8000-000000000001', 'أبونا يوحنا — مالك التطبيق', '10000000000001', '+201000000001', 'owner',           'approved', null, null, null, 'b0000000-0000-4000-8000-000000000001', null, now() - interval '400 days', null),
  ('a0000000-0000-4000-8000-000000000002', 'مينا عادل',                   '10000000000002', '+201000000002', 'church_manager',  'approved', 'a1000000-0000-4000-8000-000000000001', null, null, 'b0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001', now() - interval '300 days', null),
  ('a0000000-0000-4000-8000-000000000003', 'مريم سامح',                   '10000000000003', '+201000000003', 'service_manager', 'approved', 'a1000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', null, 'b0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000002', now() - interval '200 days', null),
  ('a0000000-0000-4000-8000-000000000004', 'جورج فايز',                   '10000000000004', '+201000000004', 'class_servant',   'approved', 'a1000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000004', 'a0000000-0000-4000-8000-000000000003', now() - interval '150 days', null),
  ('a0000000-0000-4000-8000-000000000005', 'مارينا نبيل',                 '10000000000005', '+201000000005', 'class_servant',   'approved', 'a1000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000005', 'a0000000-0000-4000-8000-000000000003', now() - interval '120 days', null),
  ('a0000000-0000-4000-8000-000000000006', 'بيشوي رأفت',                  '10000000000006', '+201000000006', 'class_servant',   'approved', 'a1000000-0000-4000-8000-000000000002', 'a2000000-0000-4000-8000-000000000003', 'a3000000-0000-4000-8000-000000000005', 'b0000000-0000-4000-8000-000000000006', 'a0000000-0000-4000-8000-000000000001', now() - interval '90 days', null),
  ('a0000000-0000-4000-8000-000000000007', 'كيرلس ماهر',                  '10000000000007', '+201000000007', 'class_servant',   'pending',  'a1000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000003', 'b0000000-0000-4000-8000-000000000007', null, null, null),
  -- suspended (موقوف): keeps his data, cannot log in; his mirror row in enrollments is «stopped» (0043)
  ('a0000000-0000-4000-8000-000000000008', 'هاني عزت',                    '10000000000008', '+201000000008', 'class_servant',   'suspended', 'a1000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000003', 'b0000000-0000-4000-8000-000000000008', 'a0000000-0000-4000-8000-000000000003', now() - interval '250 days', null);

update public.persons set created_by = 'a0000000-0000-4000-8000-000000000001', edited_by = 'a0000000-0000-4000-8000-000000000001'
 where id::text like 'b0000000-%';

-- 0045: a servant may serve in SEVERAL places. جورج (إعدادي) also serves in
-- فصل ثانوي; مارينا (ابتدائي) helps the whole youth meeting (service-level scope).
-- The trigger builds one mirror enrollment (kind = servant) PER CLASS served.
insert into public.servant_scopes (id, servant_id, church_id, service_id, class_id, created_by, created_at) values
  ('a5000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000004', 'a1000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000003', now() - interval '100 days'),
  ('a5000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000005', 'a1000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000002', null, 'a0000000-0000-4000-8000-000000000002', now() - interval '40 days');

-- The servants' MIRROR rows (0042/0045) were just created by the trigger with
-- random ids. Every «scan» below must see CHILDREN only, so the rest of the
-- file reads through this temp view instead of public.enrollments directly.
create temp view kids as
  select * from public.enrollments where kind = 'child';

-- ---------------------------------------------------------------------
-- 3. صلاحيات الوحدات — grant every module globally (owner can restrict later)
-- ---------------------------------------------------------------------
insert into public.module_access (module_key, church_id, service_id, class_id, created_by)
select m, null, null, null, 'a0000000-0000-4000-8000-000000000001'
  from unnest(array['cards','shepherds','store','exams','birthdays','messages','online',
                    'achievements','occasions','notifications','results','library','activity','reports']) m
 where not exists (select 1 from public.module_access x where x.module_key = m and x.church_id is null);
-- + a scoped grant example (store for class إعدادي of church 1, in addition to the global one)
insert into public.module_access (id, module_key, church_id, service_id, class_id, created_by) values
  ('a8000000-0000-4000-8000-000000000001', 'store', 'a1000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001');

-- ---------------------------------------------------------------------
-- 4. ملفات الصلاحيات + ربط الخدام
-- ---------------------------------------------------------------------
insert into public.permission_profiles (id, name, description, permissions, color, sort_order, created_by) values
  ('a4000000-0000-4000-8000-000000000001', 'خادم فصل أساسي', 'عرض المخدومين وتسجيل الحضور والنقاط والاتصال', array['children.view','children.attendance','children.points','children.call','children.message','scanner.use','stats.view','library.view','results.view'], '#1e3a8a', 1, 'a0000000-0000-4000-8000-000000000001'),
  ('a4000000-0000-4000-8000-000000000002', 'أمين خدمة',       'إدارة المخدومين والبنية والمناسبات داخل نطاقه', array['children.view','children.add','children.edit','children.delete','children.attendance','children.points','children.call','children.message','children.print_card','children.export','scanner.use','stats.view','structure.classes','activity.events','activity.causes','activity.feedbacks','activity.data_requests','servants.view','servants.approve','servants.invite','servants.permissions','results.enter','results.edit','results.export','library.manage'], '#047857', 2, 'a0000000-0000-4000-8000-000000000001'),
  ('a4000000-0000-4000-8000-000000000003', 'كاشير المتجر',    'النقاط فقط — لاستبدال النقاط في المتجر', array['children.view','children.points','scanner.use'], '#c2410c', 3, 'a0000000-0000-4000-8000-000000000001'),
  ('a4000000-0000-4000-8000-000000000004', 'مراقب نتائج',     'إدخال واستيراد نتائج الامتحانات وقفلها', array['results.view','results.enter','results.edit','results.import','results.export','results.manage_exams','results.manage_subjects','results.manage_grading','results.lock','results.stats'], '#7c3aed', 4, 'a0000000-0000-4000-8000-000000000001'),
  ('a4000000-0000-4000-8000-000000000005', 'مراقب النشاط والتقارير', 'قراءة سجل النشاط وبناء التقارير وحفظ قوالبها وإضافة خدام', array['activity.view','activity.view_all','reports.build','reports.templates','servants.view','servants.add','servants.manage','children.view','children.export','stats.view'], '#0f766e', 5, 'a0000000-0000-4000-8000-000000000001');

insert into public.permissions (servant_id, permission_profile_id, granted_by) values
  ('a0000000-0000-4000-8000-000000000004', 'a4000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000003'),
  ('a0000000-0000-4000-8000-000000000004', 'a4000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000003'),
  ('a0000000-0000-4000-8000-000000000004', 'a4000000-0000-4000-8000-000000000005', 'a0000000-0000-4000-8000-000000000002'),
  ('a0000000-0000-4000-8000-000000000005', 'a4000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000003'),
  ('a0000000-0000-4000-8000-000000000005', 'a4000000-0000-4000-8000-000000000004', 'a0000000-0000-4000-8000-000000000002'),
  ('a0000000-0000-4000-8000-000000000006', 'a4000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001'),
  ('a0000000-0000-4000-8000-000000000003', 'a4000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000002');

-- ---------------------------------------------------------------------
-- 5. المخدومين — persons (code = national id = QR) + enrollments
--    Birthdates: 3 children have birthdays today / in 2 days / in 6 days.
-- ---------------------------------------------------------------------
insert into public.persons (id, national_id, name, gender, birthdate, phone, address, notes, created_by) values
  -- ابتدائي (church 1)
  ('b1000000-0000-4000-8000-000000000001', '30101010100001', 'يوسف مجدي فهيم',      'male',   pg_temp.bday(0, 9),  '+201011111001', 'الأقصر — الكرنك',   'عيد ميلاده اليوم 🎂', 'a0000000-0000-4000-8000-000000000005'),
  ('b1000000-0000-4000-8000-000000000002', '30101010100002', 'مارية عماد رزق',      'female', '2016-04-18',        '+201011111002', 'الأقصر — الحبيل',   null, 'a0000000-0000-4000-8000-000000000005'),
  ('b1000000-0000-4000-8000-000000000003', '30101010100003', 'كاراس هاني وديع',     'male',   '2015-09-02',        '+201011111003', 'الأقصر',            'يحب الألحان', 'a0000000-0000-4000-8000-000000000005'),
  ('b1000000-0000-4000-8000-000000000004', '30101010100004', 'جوليا رامي صبحي',     'female', pg_temp.bday(2, 8),  '+201011111004', 'الأقصر — العوامية', 'عيد ميلادها بعد يومين', 'a0000000-0000-4000-8000-000000000005'),
  ('b1000000-0000-4000-8000-000000000005', '30101010100005', 'أبانوب سامي جرجس',    'male',   '2016-12-25',        '+201011111005', 'الأقصر',            null, 'a0000000-0000-4000-8000-000000000005'),
  ('b1000000-0000-4000-8000-000000000006', '30101010100006', 'فيرينا نادر لطفي',    'female', '2017-06-06',        '+201011111006', 'الأقصر — المنشية',  'انتقلت من كنيسة أخرى', 'a0000000-0000-4000-8000-000000000005'),
  ('b1000000-0000-4000-8000-000000000007', '30101010100007', 'مارك أيمن نصيف',      'male',   '2015-01-30',        '+201011111007', 'الأقصر',            null, 'a0000000-0000-4000-8000-000000000005'),
  ('b1000000-0000-4000-8000-000000000008', '30101010100008', 'ساندرا وائل فهمي',    'female', '2016-08-21',        '+201011111008', 'الأقصر',            null, 'a0000000-0000-4000-8000-000000000005'),
  -- إعدادي (church 1)
  ('b1000000-0000-4000-8000-000000000009', '30101010100009', 'مينا رومانى عزيز',    'male',   '2012-03-14',        '+201011111009', 'الأقصر — الكرنك',   'متفوق في المسابقات', 'a0000000-0000-4000-8000-000000000004'),
  ('b1000000-0000-4000-8000-000000000010', '30101010100010', 'مريم جرجس حبيب',      'female', '2011-10-05',        '+201011111010', 'الأقصر',            null, 'a0000000-0000-4000-8000-000000000004'),
  ('b1000000-0000-4000-8000-000000000011', '30101010100011', 'بولا شنودة رزق',      'male',   pg_temp.bday(6, 13), '+201011111011', 'الأقصر — الحبيل',   'عيد ميلاده الأسبوع القادم', 'a0000000-0000-4000-8000-000000000004'),
  ('b1000000-0000-4000-8000-000000000012', '30101010100012', 'كريستين فادي ثابت',   'female', '2012-07-19',        '+201011111012', 'الأقصر',            null, 'a0000000-0000-4000-8000-000000000004'),
  ('b1000000-0000-4000-8000-000000000013', '30101010100013', 'أنطونيوس ماجد شفيق',  'male',   '2011-05-23',        '+201011111013', 'الأقصر — العوامية', 'يحتاج افتقاد', 'a0000000-0000-4000-8000-000000000004'),
  ('b1000000-0000-4000-8000-000000000014', '30101010100014', 'دميانة عاطف بشرى',    'female', '2012-11-11',        '+201011111014', 'الأقصر',            null, 'a0000000-0000-4000-8000-000000000004'),
  ('b1000000-0000-4000-8000-000000000015', '30101010100015', 'يوستينا هاني منير',   'female', '2011-02-02',        '+201011111015', 'الأقصر',            null, 'a0000000-0000-4000-8000-000000000004'),
  ('b1000000-0000-4000-8000-000000000016', '30101010100016', 'شنودة عادل حنا',      'male',   '2012-09-28',        '+201011111016', 'الأقصر — المنشية',  null, 'a0000000-0000-4000-8000-000000000004'),
  -- ثانوي (church 1)
  ('b1000000-0000-4000-8000-000000000017', '30101010100017', 'مايكل نبيل فرج',      'male',   '2008-06-15',        '+201011111017', 'الأقصر',            null, 'a0000000-0000-4000-8000-000000000003'),
  ('b1000000-0000-4000-8000-000000000018', '30101010100018', 'نانسي سامح إبراهيم',  'female', '2009-01-08',        '+201011111018', 'الأقصر — الكرنك',   null, 'a0000000-0000-4000-8000-000000000003'),
  ('b1000000-0000-4000-8000-000000000019', '30101010100019', 'فادي جورج مكرم',      'male',   '2008-12-01',        '+201011111019', 'الأقصر',            'يخدم مع الابتدائي أيضاً', 'a0000000-0000-4000-8000-000000000003'),
  ('b1000000-0000-4000-8000-000000000020', '30101010100020', 'إيريني عماد زكي',     'female', '2009-04-27',        '+201011111020', 'الأقصر',            null, 'a0000000-0000-4000-8000-000000000003'),
  -- شباب جامعي (church 1 — اجتماع الشباب)
  ('b1000000-0000-4000-8000-000000000021', '30101010100021', 'بيتر أشرف حليم',      'male',   '2004-08-08',        '+201011111021', 'الأقصر',            null, 'a0000000-0000-4000-8000-000000000002'),
  ('b1000000-0000-4000-8000-000000000022', '30101010100022', 'مارينا رأفت سليمان',  'female', '2005-03-03',        '+201011111022', 'الأقصر — الحبيل',   null, 'a0000000-0000-4000-8000-000000000002'),
  ('b1000000-0000-4000-8000-000000000023', '30101010100023', 'أندرو ميلاد وهبة',    'male',   '2003-10-10',        '+201011111023', 'الأقصر',            null, 'a0000000-0000-4000-8000-000000000002'),
  -- ابتدائي (church 2 — مارجرجس)
  ('b1000000-0000-4000-8000-000000000024', '30201010100024', 'جورج عاطف ساويرس',    'male',   '2016-02-20',        '+201022222024', 'إسنا',              null, 'a0000000-0000-4000-8000-000000000006'),
  ('b1000000-0000-4000-8000-000000000025', '30201010100025', 'مونيكا وجيه رياض',    'female', '2015-07-07',        '+201022222025', 'إسنا — المحطة',     null, 'a0000000-0000-4000-8000-000000000006'),
  ('b1000000-0000-4000-8000-000000000026', '30201010100026', 'توماس صموئيل نجيب',   'male',   '2017-03-15',        '+201022222026', 'إسنا',              null, 'a0000000-0000-4000-8000-000000000006');

-- enrollments: person → church + service + class  (b2… id = b1… person id, same suffix)
-- kind = 'child' (0042) · status = 'active' (0043) are the defaults — set explicitly for clarity
insert into public.enrollments (id, person_id, church_id, service_id, class_id, kind, status, created_by)
select replace(p.id::text, 'b1000000', 'b2000000')::uuid, p.id,
       (case when p.national_id like '302%' then 'a1000000-0000-4000-8000-000000000002' else 'a1000000-0000-4000-8000-000000000001' end)::uuid,
       (case when p.national_id like '302%' then 'a2000000-0000-4000-8000-000000000003'
             when n between 21 and 23 then 'a2000000-0000-4000-8000-000000000002'
             else 'a2000000-0000-4000-8000-000000000001' end)::uuid,
       (case when p.national_id like '302%' then 'a3000000-0000-4000-8000-000000000005'
             when n between 1  and 8  then 'a3000000-0000-4000-8000-000000000001'
             when n between 9  and 16 then 'a3000000-0000-4000-8000-000000000002'
             when n between 17 and 20 then 'a3000000-0000-4000-8000-000000000003'
             else 'a3000000-0000-4000-8000-000000000004' end)::uuid,
       'child', 'active', p.created_by
  from public.persons p, lateral (select right(p.id::text, 2)::int as n) x
 where p.id::text like 'b1000000-%';

-- one person → TWO enrollments (فادي يخدم مع الابتدائي أيضاً): shows the multi-enrollment model
insert into public.enrollments (id, person_id, church_id, service_id, class_id, kind, status, created_by) values
  ('b2000000-0000-4000-8000-000000000027', 'b1000000-0000-4000-8000-000000000019', 'a1000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000001', 'child', 'active', 'a0000000-0000-4000-8000-000000000003');

-- ---------------------------------------------------------------------
-- 5b. حسابات المخدومين (0042 / 0043) — passwords · live portal sessions ·
--     a STOPPED child · join requests from «إنشاء حساب مخدوم»
-- ---------------------------------------------------------------------
-- Portal password 123456 for every child except أبانوب (05), who never had
-- one set and therefore logs in with the default 000000 (default_password()).
insert into public.person_credentials (person_id, password_hash, set_by, created_at, updated_at)
select p.id, crypt('123456', gen_salt('bf', 10)), p.created_by, now() - interval '30 days', now() - interval '30 days'
  from public.persons p
 where p.id::text like 'b1000000-%' and p.id <> 'b1000000-0000-4000-8000-000000000005';
-- يوسف changed his own password from the portal last week
update public.person_credentials set updated_at = now() - interval '6 days', set_by = null
 where person_id = 'b1000000-0000-4000-8000-000000000001';

-- Live portal sessions (token = sha256 of a known string so a tester can
-- call child_portal_* RPCs directly: token 'seed-token-01' → يوسف, …-09 → مينا,
-- …-13 → أنطونيوس). One «تذكرني» session (90 days), one expired yesterday.
insert into public.child_sessions (person_id, token_hash, remember, created_at, expires_at, last_seen_at, user_agent) values
  ('b1000000-0000-4000-8000-000000000001', encode(digest('seed-token-01', 'sha256'), 'hex'), true,  now() - interval '6 days',    now() + interval '84 days', now() - interval '2 hours 50 minutes', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari'),
  ('b1000000-0000-4000-8000-000000000009', encode(digest('seed-token-09', 'sha256'), 'hex'), false, now() - interval '1 hour',    now() + interval '11 hours', now() - interval '5 minutes', 'Mozilla/5.0 (Linux; Android 13; SM-A525F) Chrome'),
  ('b1000000-0000-4000-8000-000000000013', encode(digest('seed-token-13', 'sha256'), 'hex'), false, now() - interval '40 minutes', now() + interval '11 hours 20 minutes', now() - interval '30 minutes', 'Mozilla/5.0 (Linux; Android 12) Chrome'),
  ('b1000000-0000-4000-8000-000000000012', encode(digest('seed-token-12-old', 'sha256'), 'hex'), false, now() - interval '1 day 13 hours', now() - interval '1 day 1 hour', now() - interval '1 day 2 hours', 'Mozilla/5.0 (Windows NT 10.0) Chrome');

-- Join requests (/child/signup → إدارة المخدومين → الطلبات):
--   pending (new child, ابتدائي) · pending (no class chosen → owner/church manager)
--   · rejected (duplicate of an existing child) · approved (became توماس, church 2)
insert into public.child_join_requests (id, code, name, gender, birthdate, phone, address, notes, password_hash, church_id, service_id, class_id, status, decision_note, decided_by, decided_at, person_id, enrollment_id, created_at) values
  ('b3000000-0000-4000-8000-000000000001', '30101010100099', 'جون ميلاد سعد',   'male',   '2016-05-14', '+201011111099', 'الأقصر — الكرنك', 'أخو مارية — انتقلنا من أسوان', crypt('123456', gen_salt('bf', 10)), 'a1000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000001', 'pending', null, null, null, null, null, now() - interval '5 hours'),
  ('b3000000-0000-4000-8000-000000000002', '30101010100098', 'سارة مجدي حليم',  'female', '2010-09-30', '+201011111098', 'الأقصر', null, crypt('123456', gen_salt('bf', 10)), 'a1000000-0000-4000-8000-000000000001', null, null, 'pending', null, null, null, null, null, now() - interval '2 days'),
  ('b3000000-0000-4000-8000-000000000003', '30101010100003', 'كاراس هاني',        'male',   '2015-09-02', '+201011111003', 'الأقصر', null, crypt('123456', gen_salt('bf', 10)), 'a1000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000001', 'rejected', 'مسجّل بالفعل — استخدم كارتك الحالي', 'a0000000-0000-4000-8000-000000000005', now() - interval '8 days', 'b1000000-0000-4000-8000-000000000003', null, now() - interval '9 days'),
  ('b3000000-0000-4000-8000-000000000004', '30201010100026', 'توماس صموئيل نجيب', 'male',   '2017-03-15', '+201022222026', 'إسنا', null, crypt('123456', gen_salt('bf', 10)), 'a1000000-0000-4000-8000-000000000002', 'a2000000-0000-4000-8000-000000000003', 'a3000000-0000-4000-8000-000000000005', 'approved', 'أهلاً توماس 🎉', 'a0000000-0000-4000-8000-000000000006', now() - interval '20 days', 'b1000000-0000-4000-8000-000000000026', 'b2000000-0000-4000-8000-000000000026', now() - interval '21 days');

-- ---------------------------------------------------------------------
-- 6. المناسبات (events) · الأسباب (causes) · نتائج الافتقاد (call_feedbacks)
-- ---------------------------------------------------------------------
insert into public.events (id, church_id, service_id, class_id, name, description, recurrence, weekdays, start_time, end_time, event_date, points, is_default, points_mode, created_by) values
  ('c1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', null, 'مدارس الأحد — الجمعة', 'الاجتماع الأسبوعي لمدارس الأحد', 'weekly', array[5]::smallint[], '10:00', '12:30', null, 5, true,  'fixed',    'a0000000-0000-4000-8000-000000000003'),
  ('c1000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', null, 'القداس الإلهي',        'قداس الجمعة — حضور القداس', 'weekly', array[5]::smallint[], '07:00', '09:30', null, 10, false, 'fixed',    'a0000000-0000-4000-8000-000000000003'),
  ('c1000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000002', 'درس الكتاب — إعدادي', 'درس الكتاب الأسبوعي لفصل إعدادي', 'weekly', array[2]::smallint[], '17:00', '18:30', null, 3, false, 'editable', 'a0000000-0000-4000-8000-000000000004'),
  ('c1000000-0000-4000-8000-000000000004', 'a1000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', null, 'مسابقة الكتاب المقدس',  'مسابقة اليوم — الحضور 15 نقطة', 'once', null, '16:00', '20:00', current_date, 15, false, 'open', 'a0000000-0000-4000-8000-000000000003'),
  ('c1000000-0000-4000-8000-000000000005', 'a1000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000002', null, 'اجتماع الشباب — الخميس','الاجتماع الأسبوعي للشباب', 'weekly', array[4]::smallint[], '19:00', '21:00', null, 5, true, 'fixed', 'a0000000-0000-4000-8000-000000000002'),
  ('c1000000-0000-4000-8000-000000000006', 'a1000000-0000-4000-8000-000000000002', 'a2000000-0000-4000-8000-000000000003', null, 'مدارس الأحد — مارجرجس','الاجتماع الأسبوعي', 'weekly', array[5]::smallint[], '10:00', '12:00', null, 5, true, 'fixed', 'a0000000-0000-4000-8000-000000000006'),
  ('c1000000-0000-4000-8000-000000000007', 'a1000000-0000-4000-8000-000000000001', null, null, 'نهضة العذراء', 'نهضة صوم السيدة العذراء — كل الكنيسة', 'once', null, '18:00', '21:00', current_date + 10, 8, false, 'fixed', 'a0000000-0000-4000-8000-000000000002');

-- 0048 scoped defaults: ONE default per exact scope, most-specific wins.
--   church 1 (all services)      → القداس الإلهي (church-wide default)
--   مدارس الأحد (service)         → مدارس الأحد — الجمعة (already is_default above)
--   فصل إعدادي (class)            → درس الكتاب — إعدادي (overrides the service default)
-- So selecting إعدادي preselects درس الكتاب, ابتدائي falls back to الجمعة,
-- and اجتماع الشباب has its own; a church-only selection gets القداس.
insert into public.events (id, church_id, service_id, class_id, name, description, recurrence, weekdays, start_time, end_time, event_date, points, is_default, points_mode, created_by) values
  ('c1000000-0000-4000-8000-000000000008', 'a1000000-0000-4000-8000-000000000001', null, null, 'القداس الإلهي — الأحد', 'قداس الأحد — الافتراضي لكل الكنيسة', 'weekly', array[0]::smallint[], '08:00', '10:30', null, 10, true, 'fixed', 'a0000000-0000-4000-8000-000000000002');
update public.events set is_default = true where id = 'c1000000-0000-4000-8000-000000000003';   -- class default (إعدادي)

insert into public.causes (id, church_id, service_id, class_id, name, description, points, is_default, points_mode, created_by) values
  ('c2000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', null, null, 'حفظ آية',            'حفظ آية الأسبوع', 5, true,  'fixed',    'a0000000-0000-4000-8000-000000000002'),
  ('c2000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001', null, null, 'إحضار صديق',         'دعوة مخدوم جديد', 10, false, 'fixed',    'a0000000-0000-4000-8000-000000000002'),
  ('c2000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', null, 'المشاركة في الدرس', 'إجابة / مشاركة فعّالة', 2, false, 'editable', 'a0000000-0000-4000-8000-000000000003'),
  ('c2000000-0000-4000-8000-000000000004', 'a1000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', null, 'خصم — سلوك',       'خصم نقاط لسلوك غير مناسب', 3, false, 'open',     'a0000000-0000-4000-8000-000000000003'),
  ('c2000000-0000-4000-8000-000000000005', 'a1000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000002', 'واجب الكتاب', 'حل واجب درس الكتاب', 4, false, 'fixed', 'a0000000-0000-4000-8000-000000000004'),
  ('c2000000-0000-4000-8000-000000000006', 'a1000000-0000-4000-8000-000000000002', null, null, 'حفظ آية',            'حفظ آية الأسبوع', 5, true,  'fixed',    'a0000000-0000-4000-8000-000000000006');
-- scoped default causes (0048): service default = المشاركة في الدرس · class إعدادي default = واجب الكتاب
update public.causes set is_default = true where id in ('c2000000-0000-4000-8000-000000000003', 'c2000000-0000-4000-8000-000000000005');

insert into public.call_feedbacks (id, church_id, service_id, class_id, event_id, name, color, icon, sort_order, created_by) values
  ('c3000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', null, null, null, 'تم الرد — سيحضر',   '#16a34a', 'phone', 1, 'a0000000-0000-4000-8000-000000000002'),
  ('c3000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001', null, null, null, 'لم يرد',            '#f59e0b', 'phone-missed', 2, 'a0000000-0000-4000-8000-000000000002'),
  ('c3000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000001', null, null, null, 'مريض',              '#ef4444', 'heart-pulse', 3, 'a0000000-0000-4000-8000-000000000002'),
  ('c3000000-0000-4000-8000-000000000004', 'a1000000-0000-4000-8000-000000000001', null, null, null, 'مسافر',             '#6366f1', 'plane', 4, 'a0000000-0000-4000-8000-000000000002'),
  ('c3000000-0000-4000-8000-000000000005', 'a1000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', null, null, 'رقم خطأ', '#64748b', 'phone-off', 5, 'a0000000-0000-4000-8000-000000000003'),
  ('c3000000-0000-4000-8000-000000000006', 'a1000000-0000-4000-8000-000000000002', null, null, null, 'تم الرد',           '#16a34a', 'phone', 1, 'a0000000-0000-4000-8000-000000000006');

-- ---------------------------------------------------------------------
-- 7. الإنجازات (achievements) — created BEFORE attendance so the
--    attendance-kind ones are awarded automatically by the trigger.
-- ---------------------------------------------------------------------
insert into public.achievements (id, church_id, service_id, class_id, event_id, name, description, points, is_active, kind, award_mode, max_awards, min_interval_days, attendance_rule, attendance_target, sort_order, created_by) values
  ('d1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', null, null, null, 'نجم الحضور 🌟',   'حضور 5 مرات',                      20, true, 'attendance', 'once',     null, null, 'count',  5, 1, 'a0000000-0000-4000-8000-000000000002'),
  ('d1000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', null, 'c1000000-0000-4000-8000-000000000001', 'المواظب 🔥', '3 مرات متتالية في مدارس الأحد', 15, true, 'attendance', 'multiple', 5, 14, 'streak', 3, 2, 'a0000000-0000-4000-8000-000000000003'),
  ('d1000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000001', null, null, null, 'حافظ الآيات 📖',  'حفظ 10 آيات — يُمنح يدوياً',       25, true, 'normal',     'once',     null, null, null, null, 3, 'a0000000-0000-4000-8000-000000000002'),
  ('d1000000-0000-4000-8000-000000000004', 'a1000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000002', null, 'بطل المسابقة 🏆', 'الفائز في مسابقة الفصل', 30, true, 'normal', 'multiple', null, null, null, null, 4, 'a0000000-0000-4000-8000-000000000004'),
  ('d1000000-0000-4000-8000-000000000005', 'a1000000-0000-4000-8000-000000000001', null, null, null, 'إنجاز قديم (موقوف)', 'مثال على إنجاز غير مفعّل', 5, false, 'normal', 'once', null, null, null, null, 9, 'a0000000-0000-4000-8000-000000000002'),
  ('d1000000-0000-4000-8000-000000000006', 'a1000000-0000-4000-8000-000000000002', null, null, null, 'نجم الحضور', 'حضور 4 مرات', 20, true, 'attendance', 'once', null, null, 'count', 4, 1, 'a0000000-0000-4000-8000-000000000006');

-- ---------------------------------------------------------------------
-- 8. أتمتة الإشعارات — created BEFORE attendance/points so the triggers
--    produce real automatic notifications.
-- ---------------------------------------------------------------------
insert into public.notification_automations (id, church_id, service_id, class_id, trigger_key, recipient, name, title_template, body_template, link_url, is_active, config, created_by) values
  ('d2000000-0000-4000-8000-000000000001', null, null, null, 'attendance',        'student',        'تأكيد الحضور',        'أهلاً [الاسم الأول] 👋',            'تم تسجيل حضورك في [المناسبة] وحصلت على [النقاط] نقطة. رصيدك الآن [الرصيد].', '/child/attendance', true, '{}', 'a0000000-0000-4000-8000-000000000001'),
  ('d2000000-0000-4000-8000-000000000002', null, null, null, 'points_added',      'student',        'نقاط جديدة',          'مبروك [الاسم الأول] 🎉',           'حصلت على [النقاط] نقطة — [السبب]. رصيدك [الرصيد].', '/child/points', true, '{"min_points": 5}', 'a0000000-0000-4000-8000-000000000001'),
  ('d2000000-0000-4000-8000-000000000003', null, null, null, 'points_deducted',   'student',        'خصم نقاط',            'تنبيه',                             'تم خصم [النقاط] نقطة — [السبب].', '/child/points', true, '{"min_points": 1}', 'a0000000-0000-4000-8000-000000000001'),
  ('d2000000-0000-4000-8000-000000000004', null, null, null, 'exam_published',    'student',        'امتحان جديد',         'امتحان جديد: [العنوان] 📝',        'متاح الآن في بوابتك — آخر موعد [آخر موعد].', null, true, '{}', 'a0000000-0000-4000-8000-000000000001'),
  ('d2000000-0000-4000-8000-000000000005', null, null, null, 'achievement_earned','student',        'إنجاز جديد',          'إنجاز جديد 🏅 [الإنجاز]',           'مبروك [الاسم الأول]! حصلت على إنجاز [الإنجاز] و[النقاط] نقطة.', '/child/achievements', true, '{}', 'a0000000-0000-4000-8000-000000000001'),
  ('d2000000-0000-4000-8000-000000000006', null, null, null, 'online_class_started','student',      'بدأ الفصل الأونلاين', '🔴 بدأ الآن: [العنوان]',           'ادخل الآن لتسجيل حضورك.', null, true, '{}', 'a0000000-0000-4000-8000-000000000001'),
  ('d2000000-0000-4000-8000-000000000007', 'a1000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', null, 'occasion_reminder', 'student', 'تذكير بالفعالية', 'تذكير: [العنوان] ⏰', 'الفعالية غداً — لا تنسَ تذكرتك.', null, true, '{"hours_before": 24}', 'a0000000-0000-4000-8000-000000000003'),
  ('d2000000-0000-4000-8000-000000000008', 'a1000000-0000-4000-8000-000000000001', null, null, 'attendance', 'class_servants', 'إشعار الخادم بالحضور', 'حضر [الاسم]', 'سجّل [الاسم] حضوره في [المناسبة] — فصل [الفصل].', null, false, '{}', 'a0000000-0000-4000-8000-000000000002');

-- ---------------------------------------------------------------------
-- 9. الحضور — last 8 Fridays for مدارس الأحد (church 1) + مارجرجس,
--    Thursdays for the youth meeting, Tuesdays for درس الكتاب (إعدادي),
--    and TODAY's contest so «نبض اليوم» is not empty.
--    Deterministic «randomness» from the enrollment number + week number.
-- ---------------------------------------------------------------------
-- (activity log: attendance is recorded by the service manager)
do $$ begin perform pg_temp.act('a0000000-0000-4000-8000-000000000003'); end $$;

-- weekly Fridays — church 1, مدارس الأحد (3 classes)
insert into public.attendance_log (enrollment_id, event_id, points_delta, recorded_by, attended_on, created_at)
select e.id, 'c1000000-0000-4000-8000-000000000001', 5,
       (case e.class_id when 'a3000000-0000-4000-8000-000000000001' then 'a0000000-0000-4000-8000-000000000005'
                        when 'a3000000-0000-4000-8000-000000000002' then 'a0000000-0000-4000-8000-000000000004'
                        else 'a0000000-0000-4000-8000-000000000003' end)::uuid,
       d.day, d.day + time '10:15' + (right(e.id::text, 2)::int || ' minutes')::interval
  from kids e
  cross join lateral (
    select (current_date - ((extract(dow from current_date)::int - 5 + 7) % 7) - 7 * g)::date as day
      from generate_series(0, 7) g
  ) d
 where e.service_id = 'a2000000-0000-4000-8000-000000000001'
   and d.day < current_date
   -- absence pattern: child N misses a week when (N + week) % 4 = 0; child 13 misses the last 3 weeks (needs follow-up)
   and not ((right(e.id::text, 2)::int + extract(epoch from d.day)::bigint / 604800) % 4 = 0)
   and not (e.person_id = 'b1000000-0000-4000-8000-000000000013' and d.day > current_date - 21);

-- القداس — half of the children attend on the same Fridays
insert into public.attendance_log (enrollment_id, event_id, points_delta, recorded_by, attended_on, created_at)
select e.id, 'c1000000-0000-4000-8000-000000000002', 10, 'a0000000-0000-4000-8000-000000000003', d.day, d.day + time '07:30'
  from kids e
  cross join lateral (
    select (current_date - ((extract(dow from current_date)::int - 5 + 7) % 7) - 7 * g)::date as day from generate_series(0, 7) g
  ) d
 where e.service_id = 'a2000000-0000-4000-8000-000000000001' and d.day < current_date
   and right(e.id::text, 2)::int % 2 = 0
   and (extract(epoch from d.day)::bigint / 604800) % 3 <> 0;   -- skip every 3rd week

-- درس الكتاب — إعدادي only, Tuesdays (event scoped to the class)
insert into public.attendance_log (enrollment_id, event_id, points_delta, recorded_by, attended_on, created_at)
select e.id, 'c1000000-0000-4000-8000-000000000003', 3, 'a0000000-0000-4000-8000-000000000004', d.day, d.day + time '17:10'
  from kids e
  cross join lateral (
    select (current_date - ((extract(dow from current_date)::int - 2 + 7) % 7) - 7 * g)::date as day from generate_series(0, 5) g
  ) d
 where e.class_id = 'a3000000-0000-4000-8000-000000000002' and d.day < current_date
   and (right(e.id::text, 2)::int + (extract(epoch from d.day)::bigint / 604800)) % 5 <> 0;

-- اجتماع الشباب — Thursdays
insert into public.attendance_log (enrollment_id, event_id, points_delta, recorded_by, attended_on, created_at)
select e.id, 'c1000000-0000-4000-8000-000000000005', 5, 'a0000000-0000-4000-8000-000000000002', d.day, d.day + time '19:05'
  from kids e
  cross join lateral (
    select (current_date - ((extract(dow from current_date)::int - 4 + 7) % 7) - 7 * g)::date as day from generate_series(0, 7) g
  ) d
 where e.service_id = 'a2000000-0000-4000-8000-000000000002' and d.day < current_date
   -- بيتر (21) will be STOPPED below — he attended only until 5 weeks ago
   and not (right(e.id::text, 2)::int = 21 and d.day >= current_date - 35)
   and (right(e.id::text, 2)::int + (extract(epoch from d.day)::bigint / 604800)) % 3 <> 0;

-- مارجرجس — Fridays
insert into public.attendance_log (enrollment_id, event_id, points_delta, recorded_by, attended_on, created_at)
select e.id, 'c1000000-0000-4000-8000-000000000006', 5, 'a0000000-0000-4000-8000-000000000006', d.day, d.day + time '10:20'
  from kids e
  cross join lateral (
    select (current_date - ((extract(dow from current_date)::int - 5 + 7) % 7) - 7 * g)::date as day from generate_series(0, 7) g
  ) d
 where e.church_id = 'a1000000-0000-4000-8000-000000000002' and d.day < current_date
   and (right(e.id::text, 2)::int + (extract(epoch from d.day)::bigint / 604800)) % 4 <> 0;

-- TODAY — مسابقة الكتاب المقدس (once, today): 12 children already scanned
insert into public.attendance_log (enrollment_id, event_id, points_delta, recorded_by, attended_on, created_at)
select e.id, 'c1000000-0000-4000-8000-000000000004', 15,
       (case when right(e.id::text, 2)::int <= 8 then 'a0000000-0000-4000-8000-000000000005' else 'a0000000-0000-4000-8000-000000000004' end)::uuid,
       current_date, now() - (interval '3 minutes' * right(e.id::text, 2)::int)
  from kids e
 where e.service_id = 'a2000000-0000-4000-8000-000000000001'
   and right(e.id::text, 2)::int in (1,2,3,5,6,9,10,11,12,14,17,18);

-- 0042: servants are enrollments too — the class servants scanned themselves
-- into TODAY's contest (their mirror rows carry attendance / points as well)
insert into public.attendance_log (enrollment_id, event_id, points_delta, recorded_by, attended_on, created_at)
select e.id, 'c1000000-0000-4000-8000-000000000004', 15, 'a0000000-0000-4000-8000-000000000003', current_date, now() - interval '50 minutes'
  from public.enrollments e
 where e.kind = 'servant' and e.status = 'active' and e.service_id = 'a2000000-0000-4000-8000-000000000001'
   and e.class_id in ('a3000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000002');

-- ---------------------------------------------------------------------
-- 10. النقاط — causes-based points log (adds / deducts) over the last weeks
-- ---------------------------------------------------------------------
do $$ begin perform pg_temp.act('a0000000-0000-4000-8000-000000000004'); end $$;
insert into public.points_log (enrollment_id, cause_id, event_id, delta, recorded_by, created_at)
select e.id,
       (case (n + w) % 4 when 0 then 'c2000000-0000-4000-8000-000000000001' when 1 then 'c2000000-0000-4000-8000-000000000003'
                         when 2 then 'c2000000-0000-4000-8000-000000000001' else 'c2000000-0000-4000-8000-000000000002' end)::uuid,
       'c1000000-0000-4000-8000-000000000001',
       case (n + w) % 4 when 0 then 5 when 1 then 2 when 2 then 5 else 10 end,
       'a0000000-0000-4000-8000-000000000003',
       (current_date - 7 * w - 1)::timestamp + time '11:30'
  from kids e, lateral (select right(e.id::text, 2)::int as n) x, generate_series(0, 5) w
 where e.service_id = 'a2000000-0000-4000-8000-000000000001' and (n * 7 + w) % 3 = 0;

-- deductions (خصم — سلوك) for a few children
insert into public.points_log (enrollment_id, cause_id, event_id, delta, recorded_by, created_at) values
  ('b2000000-0000-4000-8000-000000000013', 'c2000000-0000-4000-8000-000000000004', null, -3, 'a0000000-0000-4000-8000-000000000004', now() - interval '9 days'),
  ('b2000000-0000-4000-8000-000000000016', 'c2000000-0000-4000-8000-000000000004', null, -2, 'a0000000-0000-4000-8000-000000000004', now() - interval '16 days'),
  ('b2000000-0000-4000-8000-000000000007', 'c2000000-0000-4000-8000-000000000004', 'c1000000-0000-4000-8000-000000000001', -3, 'a0000000-0000-4000-8000-000000000005', now() - interval '2 days');

-- class-scoped cause (واجب الكتاب) — إعدادي, today
insert into public.points_log (enrollment_id, cause_id, event_id, delta, recorded_by, created_at)
select e.id, 'c2000000-0000-4000-8000-000000000005', 'c1000000-0000-4000-8000-000000000003', 4, 'a0000000-0000-4000-8000-000000000004', now() - interval '1 hour'
  from kids e where e.class_id = 'a3000000-0000-4000-8000-000000000002' and right(e.id::text, 2)::int in (9, 11, 12, 15);

-- church 2 points
insert into public.points_log (enrollment_id, cause_id, event_id, delta, recorded_by, created_at)
select e.id, 'c2000000-0000-4000-8000-000000000006', 'c1000000-0000-4000-8000-000000000006', 5, 'a0000000-0000-4000-8000-000000000006', now() - interval '3 days'
  from kids e where e.church_id = 'a1000000-0000-4000-8000-000000000002';

-- manual achievement awards (normal kind) — with their points
do $$
declare v_pl uuid;
begin
  insert into public.points_log (enrollment_id, delta, recorded_by, created_at) values ('b2000000-0000-4000-8000-000000000009', 25, 'a0000000-0000-4000-8000-000000000003', now() - interval '12 days') returning id into v_pl;
  insert into public.user_achievements (achievement_id, enrollment_id, person_id, church_id, service_id, class_id, points_awarded, awarded_by, source, points_log_id, note, awarded_at)
  values ('d1000000-0000-4000-8000-000000000003', 'b2000000-0000-4000-8000-000000000009', 'b1000000-0000-4000-8000-000000000009', 'a1000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000002', 25, 'a0000000-0000-4000-8000-000000000003', 'manual', v_pl, 'حفظ 10 آيات من المزامير', now() - interval '12 days');
  insert into public.points_log (enrollment_id, delta, recorded_by, created_at) values ('b2000000-0000-4000-8000-000000000011', 30, 'a0000000-0000-4000-8000-000000000004', now() - interval '5 days') returning id into v_pl;
  insert into public.user_achievements (achievement_id, enrollment_id, person_id, church_id, service_id, class_id, points_awarded, awarded_by, source, points_log_id, note, awarded_at)
  values ('d1000000-0000-4000-8000-000000000004', 'b2000000-0000-4000-8000-000000000011', 'b1000000-0000-4000-8000-000000000011', 'a1000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000002', 30, 'a0000000-0000-4000-8000-000000000004', 'manual', v_pl, 'الفائز الأول في مسابقة الفصل', now() - interval '5 days');
end $$;

-- 10b. A STOPPED child (0043): بيتر (شباب جامعي) moved abroad — keeps his
--      data and history, but from now on no attendance / points can be
--      logged (guard trigger) and the portal refuses his login. Stopped
--      AFTER his history was written; later sections skip him.
update public.enrollments set status = 'stopped', edited_by = 'a0000000-0000-4000-8000-000000000002'
 where id = 'b2000000-0000-4000-8000-000000000021';
update public.persons set notes = 'موقوف — سافر للدراسة في الخارج (يرجع الصيف)' where id = 'b1000000-0000-4000-8000-000000000021';

-- ---------------------------------------------------------------------
-- 11. الافتقاد — contact_log (calls · whatsapp · sms · internal) + feedback
-- ---------------------------------------------------------------------
do $$ begin perform pg_temp.act('a0000000-0000-4000-8000-000000000004'); end $$;
insert into public.contact_log (enrollment_id, event_id, kind, message, contacted_on, recorded_by, feedback_id, occurrence_on, created_at) values
  ('b2000000-0000-4000-8000-000000000013', 'c1000000-0000-4000-8000-000000000001', 'call',     null, current_date - 6,  'a0000000-0000-4000-8000-000000000004', 'c3000000-0000-4000-8000-000000000002', current_date - 7,  now() - interval '6 days'),
  ('b2000000-0000-4000-8000-000000000013', 'c1000000-0000-4000-8000-000000000001', 'call',     null, current_date - 5,  'a0000000-0000-4000-8000-000000000004', 'c3000000-0000-4000-8000-000000000003', current_date - 7,  now() - interval '5 days'),
  ('b2000000-0000-4000-8000-000000000013', 'c1000000-0000-4000-8000-000000000001', 'whatsapp', 'سلام أنطونيوس، افتقدناك الجمعة في مدارس الأحد — ألف سلامة، منتظرينك الأسبوع القادم 🙏', current_date - 5, 'a0000000-0000-4000-8000-000000000004', null, current_date - 7, now() - interval '5 days'),
  ('b2000000-0000-4000-8000-000000000004', 'c1000000-0000-4000-8000-000000000001', 'call',     null, current_date - 13, 'a0000000-0000-4000-8000-000000000005', 'c3000000-0000-4000-8000-000000000001', current_date - 14, now() - interval '13 days'),
  ('b2000000-0000-4000-8000-000000000008', 'c1000000-0000-4000-8000-000000000001', 'call',     null, current_date - 13, 'a0000000-0000-4000-8000-000000000005', 'c3000000-0000-4000-8000-000000000004', current_date - 14, now() - interval '13 days'),
  ('b2000000-0000-4000-8000-000000000008', 'c1000000-0000-4000-8000-000000000001', 'sms',      'ساندرا — نفتقدك في مدارس الأحد، ربنا يكون معاكي في السفر', current_date - 13, 'a0000000-0000-4000-8000-000000000005', null, current_date - 14, now() - interval '13 days'),
  ('b2000000-0000-4000-8000-000000000016', 'c1000000-0000-4000-8000-000000000003', 'call',     null, current_date - 2,  'a0000000-0000-4000-8000-000000000004', 'c3000000-0000-4000-8000-000000000005', current_date - 3,  now() - interval '2 days'),
  ('b2000000-0000-4000-8000-000000000010', 'c1000000-0000-4000-8000-000000000001', 'internal', 'ملاحظة داخلية: الأسرة تفضّل التواصل مع الأم فقط', current_date - 20, 'a0000000-0000-4000-8000-000000000003', null, null, now() - interval '20 days'),
  ('b2000000-0000-4000-8000-000000000024', 'c1000000-0000-4000-8000-000000000006', 'call',     null, current_date - 6,  'a0000000-0000-4000-8000-000000000006', 'c3000000-0000-4000-8000-000000000006', current_date - 7,  now() - interval '6 days');

-- ---------------------------------------------------------------------
-- 12. طلبات تعديل البيانات (child portal → servant review)
-- ---------------------------------------------------------------------
insert into public.data_change_requests (id, person_id, kind, changes, previous, note, status, decision_note, decided_by, decided_at, created_at) values
  ('d3000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000009', 'data',  '{"phone": "+201099999009", "address": "الأقصر — الكرنك الجديد"}', '{"phone": "+201011111009", "address": "الأقصر — الكرنك"}', 'غيّرنا الرقم والعنوان', 'pending',  null, null, null, now() - interval '1 day'),
  ('d3000000-0000-4000-8000-000000000002', 'b1000000-0000-4000-8000-000000000002', 'photo', '{"image_url": "https://placehold.co/400x400/png?text=Maria"}', '{"image_url": null}', null, 'pending', null, null, null, now() - interval '3 hours'),
  ('d3000000-0000-4000-8000-000000000003', 'b1000000-0000-4000-8000-000000000017', 'data',  '{"name": "مايكل نبيل فرج الله"}', '{"name": "مايكل نبيل فرج"}', 'الاسم الكامل', 'approved', 'تم', 'a0000000-0000-4000-8000-000000000003', now() - interval '10 days', now() - interval '11 days'),
  ('d3000000-0000-4000-8000-000000000004', 'b1000000-0000-4000-8000-000000000021', 'data',  '{"birthdate": "2004-08-09"}', '{"birthdate": "2004-08-08"}', null, 'rejected', 'التاريخ في شهادة الميلاد صحيح', 'a0000000-0000-4000-8000-000000000002', now() - interval '5 days', now() - interval '6 days'),
  ('d3000000-0000-4000-8000-000000000005', 'b1000000-0000-4000-8000-000000000005', 'data',  '{"address": "الأقصر — المطار"}', '{"address": "الأقصر"}', null, 'cancelled', null, null, null, now() - interval '15 days');

-- ---------------------------------------------------------------------
-- 13. الكروت — templates · print requests   (module cards)
-- ---------------------------------------------------------------------
do $$ begin perform pg_temp.act('a0000000-0000-4000-8000-000000000002'); end $$;
insert into public.card_templates (id, church_id, service_id, class_id, name, design, print_settings, created_by) values
  ('d4000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', null, null, 'كارت الكنيسة — أزرق',
   pg_temp.design(85.6, 54, '#ffffff', '#1e3a8a', jsonb_build_array(
     pg_temp.el('el_logo', 'logo', 3, 3, 12, 12, '{"borderRadius": 6}'),
     pg_temp.el('el_church', 'constant', 17, 3, 52, 7, '{"field": "church_name"}', '{"fontSize": 10, "color": "#1e3a8a"}'),
     pg_temp.el('el_photo', 'photo', 62, 16, 20, 26, '{"strokeEnabled": true, "strokeColor": "#1e3a8a"}'),
     pg_temp.el('el_name', 'variable', 4, 18, 55, 8, '{"field": "name", "label": "الاسم:"}', '{"fontSize": 11, "align": "right"}'),
     pg_temp.el('el_class', 'constant', 4, 27, 55, 6, '{"field": "class_name"}', '{"fontSize": 9, "color": "#475569", "bold": false, "align": "right"}'),
     pg_temp.el('el_qr', 'qr', 4, 34, 17, 17),
     pg_temp.el('el_code', 'variable', 23, 44, 36, 6, '{"field": "national_id"}', '{"fontSize": 8, "color": "#64748b", "bold": false}'))),
   pg_temp.print_settings(), 'a0000000-0000-4000-8000-000000000002'),
  ('d4000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', null, 'كارت مدارس الأحد — ذهبي',
   pg_temp.design(85.6, 54, '#fef3c7', '#b45309', jsonb_build_array(
     pg_temp.el('el_t', 'text', 4, 3, 77, 8, '{"text": "مدارس الأحد"}', '{"fontSize": 13, "color": "#92400e"}'),
     pg_temp.el('el_n', 'variable', 4, 14, 55, 8, '{"field": "name"}', '{"fontSize": 11, "align": "right"}'),
     pg_temp.el('el_q', 'qr', 62, 14, 20, 20, '{"bgEnabled": true}'))),
   pg_temp.print_settings('landscape'), 'a0000000-0000-4000-8000-000000000003');

insert into public.card_print_requests (enrollment_id, requested_by, created_at)
select e.id, 'a0000000-0000-4000-8000-000000000005', now() - (interval '1 hour' * right(e.id::text, 2)::int)
  from kids e where right(e.id::text, 2)::int in (1, 2, 4, 6, 9, 11, 17);

-- 0049 ملفات الطباعة — named, reusable print settings (paper · margins · gaps ·
-- alignment · cut marks) applied to any template / the bound print page.
-- shared (owner) · church-wide · service-level · class-level
insert into public.card_print_profiles (id, church_id, service_id, class_id, name, settings, created_by, edited_by, created_at, edited_at) values
  ('d8000000-0000-4000-8000-000000000001', null, null, null, 'A4 — قياسي (2×5)',            pg_temp.print_settings('portrait',  'A4', 10, 4, false, 'center', 'top'),    'a0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', now() - interval '90 days', now() - interval '90 days'),
  ('d8000000-0000-4000-8000-000000000002', null, null, null, 'A4 أفقي — علامات قص',          pg_temp.print_settings('landscape', 'A4', 8,  3, true,  'center', 'center'), 'a0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', now() - interval '90 days', now() - interval '20 days'),
  ('d8000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000001', null, null, 'مطبعة الكنيسة — A3',        pg_temp.print_settings('portrait',  'A3', 12, 5, true,  'center', 'top'),    'a0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000002', now() - interval '45 days', now() - interval '45 days'),
  ('d8000000-0000-4000-8000-000000000004', 'a1000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', null, 'مدارس الأحد — ورق لاصق A4', pg_temp.print_settings('portrait', 'A4', 6, 2, false, 'right', 'top'),      'a0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000003', now() - interval '30 days', now() - interval '3 days'),
  ('d8000000-0000-4000-8000-000000000005', 'a1000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000001', 'ابتدائي — A5 كارت واحد', pg_temp.print_settings('portrait', 'A5', 15, 0, false, 'center', 'center'), 'a0000000-0000-4000-8000-000000000005', 'a0000000-0000-4000-8000-000000000005', now() - interval '10 days', now() - interval '10 days'),
  ('d8000000-0000-4000-8000-000000000006', 'a1000000-0000-4000-8000-000000000002', null, null, 'مارجرجس — A4',              pg_temp.print_settings('portrait',  'A4', 10, 4, false, 'center', 'top'),    'a0000000-0000-4000-8000-000000000006', 'a0000000-0000-4000-8000-000000000006', now() - interval '25 days', now() - interval '25 days');
-- the مدارس الأحد template was saved with the service profile applied (copied settings)
update public.card_templates set print_settings = (select settings from public.card_print_profiles where id = 'd8000000-0000-4000-8000-000000000004')
 where id = 'd4000000-0000-4000-8000-000000000002';

-- ---------------------------------------------------------------------
-- 14. مجموعات الافتقاد (shepherd_groups) — each servant «adopts» children
-- ---------------------------------------------------------------------
insert into public.shepherd_groups (servant_id, enrollment_id, created_at)
select 'a0000000-0000-4000-8000-000000000005'::uuid, e.id, now() - interval '60 days' from kids e where right(e.id::text, 2)::int in (1, 2, 3, 4)
union all
select 'a0000000-0000-4000-8000-000000000003'::uuid, e.id, now() - interval '60 days' from kids e where right(e.id::text, 2)::int in (5, 6, 7, 8)
union all
select 'a0000000-0000-4000-8000-000000000004'::uuid, e.id, now() - interval '50 days' from kids e where right(e.id::text, 2)::int in (9, 10, 11, 12, 13)
union all
select 'a0000000-0000-4000-8000-000000000006'::uuid, e.id, now() - interval '30 days' from kids e where right(e.id::text, 2)::int in (24, 25);

-- ---------------------------------------------------------------------
-- 15. المتجر — the SHOP is the container (20261002120000): every item, sale,
--     request and bill belongs to a shop.
--   shop 1 «كانتين مدارس الأحد» — ACTIVE, shown to the whole مدارس الأحد service
--     AND the ثانوي class of the other service (multi-target)
--   shop 2 «مكتبة الكنيسة» — INACTIVE (hidden from the child portal), إعدادي only
--   shop 3 «كانتين إعدادي» — ACTIVE, one class (the class servant's own shop)
--   shop 4 «كانتين مارجرجس» — ACTIVE, church 2
-- ---------------------------------------------------------------------
do $$ begin perform pg_temp.act('a0000000-0000-4000-8000-000000000002'); end $$;
insert into public.store_shops (id, church_id, name, description, image_url, is_active, sort_order, created_by, edited_by, created_at) values
  ('d9000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'كانتين مدارس الأحد', 'أدوات مدرسية وستيكرات — استبدل نقاطك من موبايلك', null, true,  1, 'a0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000002', now() - interval '20 days'),
  ('d9000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001', 'مكتبة الكنيسة',      'كتب وقصص — قيد التجهيز (غير مفعّل)',                null, false, 2, 'a0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000002', now() - interval '5 days');
do $$ begin perform pg_temp.act('a0000000-0000-4000-8000-000000000004'); end $$;
insert into public.store_shops (id, church_id, name, description, image_url, is_active, sort_order, created_by, edited_by, created_at) values
  ('d9000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000001', 'كانتين إعدادي',      'أكواب وهدايا الفصل',                                null, true,  3, 'a0000000-0000-4000-8000-000000000004', 'a0000000-0000-4000-8000-000000000004', now() - interval '12 days');
do $$ begin perform pg_temp.act('a0000000-0000-4000-8000-000000000006'); end $$;
insert into public.store_shops (id, church_id, name, description, image_url, is_active, sort_order, created_by, edited_by, created_at) values
  ('d9000000-0000-4000-8000-000000000004', 'a1000000-0000-4000-8000-000000000002', 'كانتين مارجرجس',     'متجر الكنيسة',                                      null, true,  1, 'a0000000-0000-4000-8000-000000000006', 'a0000000-0000-4000-8000-000000000006', now() - interval '15 days');

do $$ begin perform pg_temp.act('a0000000-0000-4000-8000-000000000002'); end $$;
insert into public.store_shop_targets (shop_id, church_id, service_id, class_id) values
  ('d9000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', null),
  ('d9000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000002', 'a3000000-0000-4000-8000-000000000004'),
  ('d9000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000002'),
  ('d9000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000002');
do $$ begin perform pg_temp.act('a0000000-0000-4000-8000-000000000006'); end $$;
insert into public.store_shop_targets (shop_id, church_id, service_id, class_id) values
  ('d9000000-0000-4000-8000-000000000004', 'a1000000-0000-4000-8000-000000000002', null, null);

-- items — inside their shops (the trigger copies church_id from the shop)
do $$ begin perform pg_temp.act('a0000000-0000-4000-8000-000000000002'); end $$;
insert into public.store_items (id, church_id, shop_id, code, name, description, image_url, price, stock, is_active, sort_order, created_by) values
  ('d5000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'd9000000-0000-4000-8000-000000000001', 'PEN01',  'قلم ألوان',        'علبة 12 لون',            null, 15, 40, true, 1, 'a0000000-0000-4000-8000-000000000002'),
  ('d5000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001', 'd9000000-0000-4000-8000-000000000001', 'NB01',   'كشكول رسم',        'كشكول A4 — 40 ورقة',     null, 20, 25, true, 2, 'a0000000-0000-4000-8000-000000000002'),
  ('d5000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000001', 'd9000000-0000-4000-8000-000000000001', 'STK01',  'ستيكرات قديسين',   'ورقة ستيكرات',           null, 5,  200, true, 3, 'a0000000-0000-4000-8000-000000000002'),
  ('d5000000-0000-4000-8000-000000000004', 'a1000000-0000-4000-8000-000000000001', 'd9000000-0000-4000-8000-000000000002', 'BOOK01', 'كتاب قصص الكتاب المقدس', 'قصص مصورة للأطفال', null, 60, 10, true, 4, 'a0000000-0000-4000-8000-000000000003'),
  ('d5000000-0000-4000-8000-000000000005', 'a1000000-0000-4000-8000-000000000001', 'd9000000-0000-4000-8000-000000000003', 'CUP01',  'كوب إعدادي',       'كوب بشعار الفصل',        null, 45, 8, true, 5, 'a0000000-0000-4000-8000-000000000004'),
  ('d5000000-0000-4000-8000-000000000006', 'a1000000-0000-4000-8000-000000000001', 'd9000000-0000-4000-8000-000000000001', 'BAG01',  'شنطة ظهر',         'الجائزة الكبرى',         null, 250, 2, true, 6, 'a0000000-0000-4000-8000-000000000002'),
  ('d5000000-0000-4000-8000-000000000007', 'a1000000-0000-4000-8000-000000000001', 'd9000000-0000-4000-8000-000000000001', 'OLD01',  'صنف قديم (موقوف)', 'مثال صنف غير مفعّل',     null, 10, 0,  false, 9, 'a0000000-0000-4000-8000-000000000002'),
  ('d5000000-0000-4000-8000-000000000008', 'a1000000-0000-4000-8000-000000000002', 'd9000000-0000-4000-8000-000000000004', 'PEN01',  'قلم ألوان',        'علبة 12 لون',            null, 15, 20, true, 1, 'a0000000-0000-4000-8000-000000000006');
do $$ begin perform pg_temp.act('a0000000-0000-4000-8000-000000000004'); end $$;

-- helper: a completed order (redeem points → order + lines); p_lines = [[item_id, qty], ...]
create or replace function pg_temp.seed_order(p_id uuid, p_enrollment uuid, p_lines jsonb, p_by uuid, p_when timestamptz, p_note text default null, p_cancel_by uuid default null)
returns void language plpgsql as $$
declare e public.enrollments; it public.store_items; ln jsonb; v_total int := 0; v_count int := 0; v_before int; v_after int; v_pl uuid; v_rf uuid;
begin
  select * into e from public.enrollments where id = p_enrollment;
  v_before := e.points;
  insert into public.store_orders (id, enrollment_id, person_id, church_id, service_id, class_id, status, balance_before, balance_after, note, recorded_by, created_at, shop_id)
  values (p_id, e.id, e.person_id, e.church_id, e.service_id, e.class_id, 'completed', v_before, v_before, p_note, p_by, p_when,
          (select shop_id from public.store_items where id = (p_lines->0->>0)::uuid));
  for ln in select * from jsonb_array_elements(p_lines) loop
    select * into it from public.store_items where id = (ln->>0)::uuid;
    update public.store_items set stock = stock - (ln->>1)::int where id = it.id;
    insert into public.store_order_items (order_id, item_id, item_code, item_name, image_url, unit_price, qty, line_total)
    values (p_id, it.id, it.code, it.name, it.image_url, it.price, (ln->>1)::int, it.price * (ln->>1)::int);
    v_total := v_total + it.price * (ln->>1)::int; v_count := v_count + (ln->>1)::int;
  end loop;
  insert into public.points_log (enrollment_id, delta, recorded_by, created_at) values (e.id, -v_total, p_by, p_when) returning id into v_pl;
  select points into v_after from public.enrollments where id = e.id;
  update public.store_orders set items_count = v_count, total_points = v_total, balance_after = v_after, points_log_id = v_pl where id = p_id;
  if p_cancel_by is not null then
    insert into public.points_log (enrollment_id, delta, recorded_by, created_at) values (e.id, v_total, p_cancel_by, p_when + interval '1 day') returning id into v_rf;
    update public.store_items s set stock = s.stock + oi.qty from public.store_order_items oi where oi.order_id = p_id and oi.item_id = s.id;
    update public.store_orders set status = 'cancelled', refund_points_log_id = v_rf, cancelled_by = p_cancel_by, cancelled_at = p_when + interval '1 day' where id = p_id;
  end if;
end $$;

do $$ begin
  perform pg_temp.seed_order('d6000000-0000-4000-8000-000000000001', 'b2000000-0000-4000-8000-000000000010', '[["d5000000-0000-4000-8000-000000000001", 1], ["d5000000-0000-4000-8000-000000000002", 1]]', 'a0000000-0000-4000-8000-000000000004', now() - interval '4 days');
  perform pg_temp.seed_order('d6000000-0000-4000-8000-000000000002', 'b2000000-0000-4000-8000-000000000002', '[["d5000000-0000-4000-8000-000000000003", 3]]', 'a0000000-0000-4000-8000-000000000005', now() - interval '40 minutes', 'هدية نهاية الترم');
  perform pg_temp.seed_order('d6000000-0000-4000-8000-000000000003', 'b2000000-0000-4000-8000-000000000012', '[["d5000000-0000-4000-8000-000000000004", 1]]', 'a0000000-0000-4000-8000-000000000004', now() - interval '8 days', 'ألغيت — الكتاب غير متوفر', 'a0000000-0000-4000-8000-000000000003');
  perform pg_temp.seed_order('d6000000-0000-4000-8000-000000000004', 'b2000000-0000-4000-8000-000000000014', '[["d5000000-0000-4000-8000-000000000005", 1], ["d5000000-0000-4000-8000-000000000003", 2]]', 'a0000000-0000-4000-8000-000000000004', now() - interval '2 hours');
  perform pg_temp.seed_order('d6000000-0000-4000-8000-000000000005', 'b2000000-0000-4000-8000-000000000024', '[["d5000000-0000-4000-8000-000000000008", 1]]', 'a0000000-0000-4000-8000-000000000006', now() - interval '3 days');
end $$;

-- ---------- child purchase requests (20261001120000) ----------
-- helper: a child request (sent from the portal) — p_lines = [[item_id, qty], ...]
--   p_status: pending | approved (→ real order via seed_order, source 'request') | rejected | cancelled
create or replace function pg_temp.seed_request(p_id uuid, p_shop uuid, p_enrollment uuid, p_lines jsonb, p_when timestamptz,
                                                p_status text default 'pending', p_by uuid default null, p_note text default null, p_decision text default null)
returns void language plpgsql as $$
declare e public.enrollments; it public.store_items; ln jsonb; v_total int := 0; v_count int := 0; v_order uuid; v_servant text;
begin
  select * into e from public.enrollments where id = p_enrollment;
  v_servant := current_setting('request.jwt.claim.sub', true);
  -- the child sends the request from the portal (no auth) → the activity log shows him as actor
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('app.child_actor', e.person_id::text, true);
  insert into public.store_requests (id, shop_id, enrollment_id, person_id, church_id, service_id, class_id, status, balance_at_request, note, created_at)
  values (p_id, p_shop, e.id, e.person_id, e.church_id, e.service_id, e.class_id, 'pending', e.points, p_note, p_when);
  for ln in select * from jsonb_array_elements(p_lines) loop
    select * into it from public.store_items where id = (ln->>0)::uuid;
    insert into public.store_request_items (request_id, item_id, item_code, item_name, image_url, unit_price, qty, line_total)
    values (p_id, it.id, it.code, it.name, it.image_url, it.price, (ln->>1)::int, it.price * (ln->>1)::int);
    v_total := v_total + it.price * (ln->>1)::int; v_count := v_count + (ln->>1)::int;
  end loop;
  update public.store_requests set items_count = v_count, total_points = v_total where id = p_id;
  perform set_config('app.child_actor', '', true);
  perform set_config('request.jwt.claim.sub', v_servant, true);
  if p_status = 'approved' then
    v_order := replace(p_id::text, 'd9000000', 'd6000000')::uuid;
    perform pg_temp.seed_order(v_order, p_enrollment, p_lines, p_by, p_when + interval '2 hours', p_note);
    update public.store_orders set shop_id = p_shop, request_id = p_id, source = 'request' where id = v_order;
    update public.store_requests set status = 'approved', order_id = v_order, decided_by = p_by, decided_at = p_when + interval '2 hours' where id = p_id;
  elsif p_status = 'rejected' then
    update public.store_requests set status = 'rejected', decision_note = p_decision, decided_by = p_by, decided_at = p_when + interval '1 hour' where id = p_id;
  elsif p_status = 'cancelled' then
    perform set_config('request.jwt.claim.sub', '', true);
    perform set_config('app.child_actor', e.person_id::text, true);
    update public.store_requests set status = 'cancelled', decided_at = p_when + interval '30 minutes' where id = p_id;
    perform set_config('app.child_actor', '', true);
    perform set_config('request.jwt.claim.sub', v_servant, true);
  end if;
end $$;

do $$ begin
  -- waiting for the servant (الطلبات tab badge = 2)
  perform pg_temp.seed_request('d9000000-0000-4000-8000-000000000011', 'd9000000-0000-4000-8000-000000000001', 'b2000000-0000-4000-8000-000000000001', '[["d5000000-0000-4000-8000-000000000001", 1], ["d5000000-0000-4000-8000-000000000003", 2]]', now() - interval '25 minutes', 'pending', null, 'ممكن أستلمها يوم الجمعة؟');
  perform pg_temp.seed_request('d9000000-0000-4000-8000-000000000012', 'd9000000-0000-4000-8000-000000000001', 'b2000000-0000-4000-8000-000000000009', '[["d5000000-0000-4000-8000-000000000002", 1]]', now() - interval '3 hours');
  -- approved after scanning the card → order d6…13 (source = request) + receipt in the child portal
  perform pg_temp.seed_request('d9000000-0000-4000-8000-000000000013', 'd9000000-0000-4000-8000-000000000001', 'b2000000-0000-4000-8000-000000000003', '[["d5000000-0000-4000-8000-000000000003", 4]]', now() - interval '2 days', 'approved', 'a0000000-0000-4000-8000-000000000005');
  -- rejected with a reason
  perform pg_temp.seed_request('d9000000-0000-4000-8000-000000000014', 'd9000000-0000-4000-8000-000000000001', 'b2000000-0000-4000-8000-000000000010', '[["d5000000-0000-4000-8000-000000000006", 1]]', now() - interval '6 days', 'rejected', 'a0000000-0000-4000-8000-000000000004', null, 'الشنطة محجوزة لجائزة نهاية السنة');
  -- cancelled by the child himself
  perform pg_temp.seed_request('d9000000-0000-4000-8000-000000000015', 'd9000000-0000-4000-8000-000000000001', 'b2000000-0000-4000-8000-000000000021', '[["d5000000-0000-4000-8000-000000000001", 2]]', now() - interval '1 day', 'cancelled');
end $$;
do $$ begin perform pg_temp.act('a0000000-0000-4000-8000-000000000004'); end $$;

-- ---------------------------------------------------------------------
-- 16. الامتحانات الإلكترونية (exams) — published · draft · closed + attempts
-- ---------------------------------------------------------------------
do $$ begin perform pg_temp.act('a0000000-0000-4000-8000-000000000003'); end $$;
insert into public.exams (id, church_id, service_id, class_id, title, description, status, opens_at, closes_at, default_seconds, default_points, pass_mode, pass_value, points_pass, points_full, question_mode, random_count, shuffle_questions, shuffle_options, max_attempts, show_result, show_answers, created_by, created_at) values
  ('e1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', null, 'مسابقة سفر التكوين', 'أسئلة على الإصحاحات 1–12 من سفر التكوين', 'published', now() - interval '3 days', now() + interval '10 days', 30, 2, 'percent', 60, 10, 25, 'all', 10, true, true, 2, true, true, 'a0000000-0000-4000-8000-000000000003', now() - interval '4 days'),
  ('e1000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000002', 'اختبار سريع — إعدادي', '5 أسئلة عشوائية من 8', 'published', now() - interval '1 day', now() + interval '3 days', 20, 1, 'score', 3, 5, 10, 'random', 5, true, false, 1, true, false, 'a0000000-0000-4000-8000-000000000004', now() - interval '2 days'),
  ('e1000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', null, 'امتحان الألحان (مسودة)', 'لم يُنشر بعد', 'draft', null, null, 45, 1, 'percent', 50, 0, 0, 'all', 10, false, false, 1, true, false, 'a0000000-0000-4000-8000-000000000003', now() - interval '1 day'),
  ('e1000000-0000-4000-8000-000000000004', 'a1000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', null, 'مسابقة الصوم الكبير', 'انتهى', 'closed', now() - interval '60 days', now() - interval '30 days', 30, 1, 'percent', 50, 5, 15, 'all', 10, true, true, 1, true, true, 'a0000000-0000-4000-8000-000000000003', now() - interval '61 days'),
  ('e1000000-0000-4000-8000-000000000005', 'a1000000-0000-4000-8000-000000000002', 'a2000000-0000-4000-8000-000000000003', null, 'مسابقة مارجرجس', 'أسئلة عن الشهيد مارجرجس', 'published', now() - interval '1 day', now() + interval '7 days', 30, 1, 'percent', 50, 5, 10, 'all', 10, true, true, 1, true, false, 'a0000000-0000-4000-8000-000000000006', now() - interval '1 day');

insert into public.exam_questions (id, exam_id, sort_order, text, options, correct_index, points, seconds) values
  ('e2000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 1, 'في أي يوم خلق الله الإنسان؟',           '["الخامس","السادس","السابع","الأول"]', 1, 2, 30),
  ('e2000000-0000-4000-8000-000000000002', 'e1000000-0000-4000-8000-000000000001', 2, 'ما اسم الجنة التي وضع فيها الله آدم؟',    '["عدن","كنعان","أورشليم","بابل"]', 0, 2, 30),
  ('e2000000-0000-4000-8000-000000000003', 'e1000000-0000-4000-8000-000000000001', 3, 'من هو أول من قتل أخاه؟',                 '["هابيل","قايين","شيث","لامك"]', 1, 2, 20),
  ('e2000000-0000-4000-8000-000000000004', 'e1000000-0000-4000-8000-000000000001', 4, 'كم يوماً استمر المطر في الطوفان؟',        '["7","30","40","150"]', 2, 3, 30),
  ('e2000000-0000-4000-8000-000000000005', 'e1000000-0000-4000-8000-000000000001', 5, 'ما هي علامة عهد الله مع نوح؟',           '["قوس قزح","النجوم","المن","الحمامة"]', 0, 2, 30),
  ('e2000000-0000-4000-8000-000000000006', 'e1000000-0000-4000-8000-000000000001', 6, 'ما اسم البرج الذي تشتتت عنده اللغات؟',   '["أريحا","بابل","نينوى","صور"]', 1, 2, 30),
  ('e2000000-0000-4000-8000-000000000007', 'e1000000-0000-4000-8000-000000000001', 7, 'من أين دعا الله إبراهيم؟',               '["مصر","أور الكلدانيين","حاران","بيت إيل"]', 1, 3, 45),
  ('e2000000-0000-4000-8000-000000000008', 'e1000000-0000-4000-8000-000000000001', 8, 'ما اسم ابن أخي إبراهيم؟',                '["لوط","إسحق","يعقوب","عيسو"]', 0, 2, 20),
  ('e2000000-0000-4000-8000-000000000011', 'e1000000-0000-4000-8000-000000000002', 1, 'كم عدد أسفار العهد الجديد؟',   '["27","39","66","73"]', 0, 1, 20),
  ('e2000000-0000-4000-8000-000000000012', 'e1000000-0000-4000-8000-000000000002', 2, 'من كتب سفر الأعمال؟',          '["بولس","لوقا","يوحنا","بطرس"]', 1, 1, 20),
  ('e2000000-0000-4000-8000-000000000013', 'e1000000-0000-4000-8000-000000000002', 3, 'أين وُلد السيد المسيح؟',       '["الناصرة","بيت لحم","أورشليم","كفر ناحوم"]', 1, 1, 15),
  ('e2000000-0000-4000-8000-000000000014', 'e1000000-0000-4000-8000-000000000002', 4, 'كم تلميذاً اختار المسيح؟',     '["7","10","12","70"]', 2, 1, 15),
  ('e2000000-0000-4000-8000-000000000015', 'e1000000-0000-4000-8000-000000000002', 5, 'من عمّد السيد المسيح؟',        '["يوحنا المعمدان","بطرس","أندراوس","يعقوب"]', 0, 1, 20),
  ('e2000000-0000-4000-8000-000000000016', 'e1000000-0000-4000-8000-000000000002', 6, 'أول معجزة للمسيح كانت في؟',    '["قانا الجليل","بيت عنيا","نايين","أريحا"]', 0, 1, 20),
  ('e2000000-0000-4000-8000-000000000017', 'e1000000-0000-4000-8000-000000000002', 7, 'من أنكر المسيح ثلاث مرات؟',    '["يهوذا","بطرس","توما","فيلبس"]', 1, 1, 20),
  ('e2000000-0000-4000-8000-000000000018', 'e1000000-0000-4000-8000-000000000002', 8, 'بعد كم يوماً من القيامة صعد المسيح؟','["3","7","40","50"]', 2, 2, 20),
  ('e2000000-0000-4000-8000-000000000021', 'e1000000-0000-4000-8000-000000000003', 1, 'لحن «إبؤرو» يُقال في؟', '["الصوم الكبير","عيد الميلاد","الخماسين","أسبوع الآلام"]', 2, 1, null),
  ('e2000000-0000-4000-8000-000000000022', 'e1000000-0000-4000-8000-000000000003', 2, 'لحن «غولغوثا» يُقال في؟', '["الجمعة العظيمة","أحد الشعانين","عيد الغطاس","عيد القيامة"]', 0, 1, null),
  ('e2000000-0000-4000-8000-000000000031', 'e1000000-0000-4000-8000-000000000004', 1, 'كم يوماً الصوم الكبير؟',     '["40","50","55","60"]', 2, 1, 30),
  ('e2000000-0000-4000-8000-000000000032', 'e1000000-0000-4000-8000-000000000004', 2, 'أحد الشعانين هو أحد؟',       '["الرفاع","الكنوز","السامرية","دخول المسيح أورشليم"]', 3, 1, 30),
  ('e2000000-0000-4000-8000-000000000033', 'e1000000-0000-4000-8000-000000000004', 3, 'خميس العهد فيه؟',            '["الشعانين","العشاء الأخير","الصلبوت","القيامة"]', 1, 1, 30),
  ('e2000000-0000-4000-8000-000000000041', 'e1000000-0000-4000-8000-000000000005', 1, 'مارجرجس كان؟',              '["راهباً","جندياً","كاهناً","تاجراً"]', 1, 1, 30),
  ('e2000000-0000-4000-8000-000000000042', 'e1000000-0000-4000-8000-000000000005', 2, 'تعيّد الكنيسة لمارجرجس في؟', '["٢٣ برمودة","٧ توت","٢٩ كيهك","١٠ بابه"]', 0, 1, 30);

-- Attempts: helper builds a realistic attempt (answers · score · pass ·
-- points_log) from the exam's questions; every p_wrong_every-th answer is
-- wrong so different children get different scores.
create or replace function pg_temp.seed_attempt(p_id uuid, p_exam uuid, p_enrollment uuid, p_wrong_every int, p_when timestamptz, p_status text default 'submitted')
returns void language plpgsql as $$
declare
  x public.exams; e public.enrollments; q record;
  i int := 0; n int; v_ok boolean; v_score numeric := 0; v_max numeric := 0; v_correct int := 0;
  v_pl uuid; v_pts int := 0; v_passed boolean; v_full boolean; v_order int[];
begin
  select * into x from public.exams where id = p_exam;
  select * into e from public.enrollments where id = p_enrollment;
  select count(*) into n from public.exam_questions where exam_id = p_exam;
  insert into public.exam_attempts (id, exam_id, enrollment_id, person_id, church_id, service_id, class_id, status, attempt_no, questions_count, current_index, started_at)
  values (p_id, p_exam, e.id, e.person_id, e.church_id, e.service_id, e.class_id, 'in_progress', 1, n, 0, p_when);
  for q in select * from public.exam_questions where exam_id = p_exam order by sort_order loop
    v_ok := (p_wrong_every = 0) or ((i + 1) % p_wrong_every <> 0);
    v_max := v_max + q.points;
    select array_agg(g) into v_order from generate_series(0, jsonb_array_length(q.options) - 1) g;
    if p_status = 'in_progress' and i >= 2 then
      insert into public.exam_answers (attempt_id, exam_id, question_id, position, question_text, image_url, options, option_order, correct_index, points, seconds, served_at, deadline_at)
      values (p_id, p_exam, q.id, i, q.text, q.image_url, q.options, v_order, q.correct_index, q.points, coalesce(q.seconds, x.default_seconds),
              case when i = 2 then now() end, case when i = 2 then now() + (coalesce(q.seconds, x.default_seconds) || ' seconds')::interval end);
    else
      insert into public.exam_answers (attempt_id, exam_id, question_id, position, question_text, image_url, options, option_order, correct_index, points, seconds, served_at, deadline_at, answered_at, selected_index, is_correct, points_earned, timed_out, time_spent_ms)
      values (p_id, p_exam, q.id, i, q.text, q.image_url, q.options, v_order, q.correct_index, q.points, coalesce(q.seconds, x.default_seconds),
              p_when + (i || ' minutes')::interval, p_when + (i || ' minutes')::interval + (coalesce(q.seconds, x.default_seconds) || ' seconds')::interval,
              p_when + (i || ' minutes')::interval + interval '12 seconds',
              case when v_ok then q.correct_index else (q.correct_index + 1) % jsonb_array_length(q.options) end,
              v_ok, case when v_ok then q.points else 0 end, false, 12000 + i * 700);
      if v_ok then v_score := v_score + q.points; v_correct := v_correct + 1; end if;
    end if;
    i := i + 1;
  end loop;
  if p_status = 'in_progress' then
    update public.exam_attempts set current_index = 2, answered_count = 2, max_score = v_max, score = v_score, correct_count = v_correct where id = p_id;
    return;
  end if;
  v_passed := case x.pass_mode when 'percent' then (v_score / nullif(v_max, 0) * 100) >= x.pass_value else v_score >= x.pass_value end;
  v_full := v_score = v_max;
  v_pts := case when v_full then x.points_full when v_passed then x.points_pass else 0 end;
  if v_pts > 0 then
    insert into public.points_log (enrollment_id, delta, recorded_by, created_at) values (e.id, v_pts, null, p_when + (n || ' minutes')::interval) returning id into v_pl;
  end if;
  update public.exam_attempts
     set status = 'submitted', finished_at = p_when + (n || ' minutes')::interval, current_index = n,
         score = v_score, max_score = v_max, percent = round(v_score / nullif(v_max, 0) * 100, 2),
         correct_count = v_correct, answered_count = n, timed_out_count = 0,
         passed = v_passed, full_mark = v_full, points_granted = v_pts, points_log_id = v_pl
   where id = p_id;
end $$;

do $$ begin
  -- exam 1 (published, open): finished attempts + 1 in progress
  perform pg_temp.seed_attempt('e3000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'b2000000-0000-4000-8000-000000000009', 0, now() - interval '2 days');            -- full mark
  perform pg_temp.seed_attempt('e3000000-0000-4000-8000-000000000002', 'e1000000-0000-4000-8000-000000000001', 'b2000000-0000-4000-8000-000000000010', 4, now() - interval '2 days 2 hours');    -- pass
  perform pg_temp.seed_attempt('e3000000-0000-4000-8000-000000000003', 'e1000000-0000-4000-8000-000000000001', 'b2000000-0000-4000-8000-000000000001', 2, now() - interval '1 day');             -- fail
  perform pg_temp.seed_attempt('e3000000-0000-4000-8000-000000000004', 'e1000000-0000-4000-8000-000000000001', 'b2000000-0000-4000-8000-000000000017', 3, now() - interval '20 hours');          -- pass
  perform pg_temp.seed_attempt('e3000000-0000-4000-8000-000000000005', 'e1000000-0000-4000-8000-000000000001', 'b2000000-0000-4000-8000-000000000005', 0, now() - interval '5 hours');           -- full
  perform pg_temp.seed_attempt('e3000000-0000-4000-8000-000000000006', 'e1000000-0000-4000-8000-000000000001', 'b2000000-0000-4000-8000-000000000012', 0, now() - interval '9 minutes', 'in_progress');
  -- exam 2 (إعدادي)
  perform pg_temp.seed_attempt('e3000000-0000-4000-8000-000000000011', 'e1000000-0000-4000-8000-000000000002', 'b2000000-0000-4000-8000-000000000011', 0, now() - interval '6 hours');
  perform pg_temp.seed_attempt('e3000000-0000-4000-8000-000000000012', 'e1000000-0000-4000-8000-000000000002', 'b2000000-0000-4000-8000-000000000014', 3, now() - interval '5 hours');
  perform pg_temp.seed_attempt('e3000000-0000-4000-8000-000000000013', 'e1000000-0000-4000-8000-000000000002', 'b2000000-0000-4000-8000-000000000016', 2, now() - interval '4 hours');
  -- exam 4 (closed): history
  perform pg_temp.seed_attempt('e3000000-0000-4000-8000-000000000021', 'e1000000-0000-4000-8000-000000000004', 'b2000000-0000-4000-8000-000000000009', 0, now() - interval '45 days');
  perform pg_temp.seed_attempt('e3000000-0000-4000-8000-000000000022', 'e1000000-0000-4000-8000-000000000004', 'b2000000-0000-4000-8000-000000000010', 3, now() - interval '45 days');
  perform pg_temp.seed_attempt('e3000000-0000-4000-8000-000000000023', 'e1000000-0000-4000-8000-000000000004', 'b2000000-0000-4000-8000-000000000002', 2, now() - interval '44 days');
  perform pg_temp.seed_attempt('e3000000-0000-4000-8000-000000000024', 'e1000000-0000-4000-8000-000000000004', 'b2000000-0000-4000-8000-000000000018', 0, now() - interval '43 days');
  -- exam 5 (church 2)
  perform pg_temp.seed_attempt('e3000000-0000-4000-8000-000000000031', 'e1000000-0000-4000-8000-000000000005', 'b2000000-0000-4000-8000-000000000024', 0, now() - interval '3 hours');
end $$;
-- a cancelled attempt (servant cancelled — no points)
insert into public.exam_attempts (id, exam_id, enrollment_id, person_id, church_id, service_id, class_id, status, attempt_no, questions_count, current_index, started_at, finished_at, cancelled_by, cancelled_at, cancel_note)
values ('e3000000-0000-4000-8000-000000000007', 'e1000000-0000-4000-8000-000000000001', 'b2000000-0000-4000-8000-000000000003', 'b1000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000001', 'cancelled', 1, 8, 3, now() - interval '3 hours', now() - interval '2 hours 50 minutes', 'a0000000-0000-4000-8000-000000000003', now() - interval '2 hours 50 minutes', 'انقطع الإنترنت — يعيد المحاولة');

-- ---------------------------------------------------------------------
-- 17. أعياد الميلاد — settings · card templates · greetings (call/whatsapp/gift)
-- ---------------------------------------------------------------------
do $$ begin perform pg_temp.act('a0000000-0000-4000-8000-000000000005'); end $$;
insert into public.birthday_settings (church_id, gift_points, message_template, edited_by) values
  (null, 10, 'كل سنة وأنت طيب يا [الاسم الأول] 🎂🎉 عيد ميلاد سعيد وربنا يفرّح قلبك — أسرة [اسم الفصل] · [اسم الكنيسة]', 'a0000000-0000-4000-8000-000000000001'),
  ('a1000000-0000-4000-8000-000000000001', 15, 'كل سنة وأنت طيب يا [الاسم الأول] 🎂 عيد ميلاد سعيد! ربنا يباركك ويكمّل [السن] سنة بالخير — [اسم الكنيسة]', 'a0000000-0000-4000-8000-000000000002');

insert into public.birthday_card_templates (id, church_id, service_id, class_id, name, design, print_settings, is_default, created_by) values
  ('d7000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', null, null, 'كارت عيد ميلاد — بالونات',
   pg_temp.design(100, 70, '#fdf2f8', '#db2777', jsonb_build_array(
     pg_temp.el('b_t', 'text', 5, 5, 90, 12, '{"text": "🎂 كل سنة وأنت طيب"}', '{"fontSize": 18, "color": "#be185d"}'),
     pg_temp.el('b_n', 'variable', 5, 20, 60, 12, '{"field": "first_name"}', '{"fontSize": 22}'),
     pg_temp.el('b_p', 'photo', 70, 20, 25, 30, '{"borderRadius": 12, "strokeEnabled": true, "strokeColor": "#db2777", "strokeWidth": 0.5}'),
     pg_temp.el('b_a', 'variable', 5, 34, 60, 10, '{"field": "turns_age", "label": "سنة"}', '{"fontSize": 14, "color": "#9d174d"}'),
     pg_temp.el('b_d', 'variable', 5, 46, 60, 8, '{"field": "birthday_date"}', '{"fontSize": 11, "color": "#64748b", "bold": false}'),
     pg_temp.el('b_c', 'constant', 5, 58, 90, 8, '{"field": "church_name"}', '{"fontSize": 9, "color": "#475569", "bold": false}'))),
   pg_temp.print_settings(), true, 'a0000000-0000-4000-8000-000000000002'),
  ('d7000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000001', 'كارت ابتدائي — ألوان',
   pg_temp.design(90, 60, '#ecfeff', '#0891b2', jsonb_build_array(
     pg_temp.el('c_t', 'text', 5, 4, 80, 10, '{"text": "عيد ميلاد سعيد 🎈"}', '{"fontSize": 16, "color": "#0e7490"}'),
     pg_temp.el('c_n', 'variable', 5, 18, 80, 12, '{"field": "name"}', '{"fontSize": 18}'),
     pg_temp.el('c_m', 'variable', 5, 34, 80, 8, '{"field": "birthday_month"}', '{"fontSize": 11, "color": "#64748b", "bold": false}'))),
   pg_temp.print_settings('landscape'), false, 'a0000000-0000-4000-8000-000000000005');

-- greetings: today's birthday child (يوسف) got a call + whatsapp + card + gift; history rows too
do $$
declare v_pl uuid; e uuid := 'b2000000-0000-4000-8000-000000000001'; y int := extract(year from current_date)::int;
begin
  insert into public.birthday_greetings (enrollment_id, year, kind, message, recorded_by, created_at) values
    (e, y, 'call', null, 'a0000000-0000-4000-8000-000000000005', now() - interval '2 hours'),
    (e, y, 'whatsapp', 'كل سنة وأنت طيب يا يوسف 🎂 عيد ميلاد سعيد! ربنا يباركك ويكمّل 9 سنة بالخير — كنيسة العذراء مريم — الأقصر', 'a0000000-0000-4000-8000-000000000005', now() - interval '2 hours'),
    (e, y, 'card_shared', null, 'a0000000-0000-4000-8000-000000000005', now() - interval '1 hour');
  insert into public.points_log (enrollment_id, delta, recorded_by, created_at) values (e, 15, 'a0000000-0000-4000-8000-000000000005', now() - interval '1 hour') returning id into v_pl;
  insert into public.birthday_greetings (enrollment_id, year, kind, message, points, points_log_id, recorded_by, created_at) values
    (e, y, 'gift', 'هدية عيد الميلاد 🎁', 15, v_pl, 'a0000000-0000-4000-8000-000000000005', now() - interval '1 hour');
  insert into public.birthday_greetings (enrollment_id, year, kind, message, recorded_by, created_at) values
    (e, y - 1, 'card_printed', null, 'a0000000-0000-4000-8000-000000000005', now() - interval '1 year'),
    ('b2000000-0000-4000-8000-000000000003', y, 'note', 'العائلة مسافرة في عيد ميلاده — نحتفل الجمعة القادمة', 'a0000000-0000-4000-8000-000000000005', now() - interval '12 days');
end $$;

-- ---------------------------------------------------------------------
-- 18. الرسائل (chat) — child threads · staff DMs · broadcasts · read state
-- ---------------------------------------------------------------------
insert into public.chat_messages (kind, enrollment_id, to_profile_id, church_id, service_id, class_id, sender_profile_id, sender_person_id, body, created_at) values
  -- servant ↔ child (يوسف) thread
  ('child', 'b2000000-0000-4000-8000-000000000001', null, 'a1000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000005', null, 'كل سنة وأنت طيب يا يوسف 🎂 منتظرينك الجمعة', now() - interval '3 hours'),
  ('child', 'b2000000-0000-4000-8000-000000000001', null, 'a1000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000001', null, 'b1000000-0000-4000-8000-000000000001', 'شكراً يا أبلة مارينا ❤️ هاجي أكيد', now() - interval '2 hours 50 minutes'),
  ('child', 'b2000000-0000-4000-8000-000000000001', null, 'a1000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000005', null, 'ولا تنسى تحفظ الآية 😊', now() - interval '2 hours 40 minutes'),
  -- child → servant (unread for the servant): أنطونيوس
  ('child', 'b2000000-0000-4000-8000-000000000013', null, 'a1000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000002', null, 'b1000000-0000-4000-8000-000000000013', 'أستاذ جورج أنا كنت تعبان الأسبوع ده، هاحضر الجمعة الجاية إن شاء الله', now() - interval '30 minutes'),
  -- إعدادي: مينا asks about the exam
  ('child', 'b2000000-0000-4000-8000-000000000009', null, 'a1000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000002', null, 'b1000000-0000-4000-8000-000000000009', 'امتحان التكوين ينفع أحله تاني؟', now() - interval '1 day'),
  ('child', 'b2000000-0000-4000-8000-000000000009', null, 'a1000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000004', null, 'أنت جبت الدرجة الكاملة يا مينا 🏆 مبروك — مش محتاج', now() - interval '23 hours'),
  -- staff DMs
  ('staff', null, 'a0000000-0000-4000-8000-000000000004', null, null, null, 'a0000000-0000-4000-8000-000000000003', null, 'جورج، محتاجين كشف حضور إعدادي قبل الاجتماع', now() - interval '5 hours'),
  ('staff', null, 'a0000000-0000-4000-8000-000000000003', null, null, null, 'a0000000-0000-4000-8000-000000000004', null, 'تمام يا مريم، هصدّره من الإحصائيات وأبعته', now() - interval '4 hours 50 minutes'),
  ('staff', null, 'a0000000-0000-4000-8000-000000000005', null, null, null, 'a0000000-0000-4000-8000-000000000002', null, 'مارينا، عيد ميلاد يوسف النهاردة — الهدية 15 نقطة', now() - interval '6 hours'),
  -- broadcasts
  ('broadcast_children', null, null, 'a1000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', null, 'a0000000-0000-4000-8000-000000000003', null, '📢 مسابقة الكتاب المقدس اليوم 4 عصراً — الحضور 15 نقطة!', now() - interval '8 hours'),
  ('broadcast_children', null, null, 'a1000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000004', null, 'فصل إعدادي: درس الكتاب الثلاثاء 5 مساءً — لا تنسوا الواجب', now() - interval '2 days'),
  ('broadcast_staff', null, null, 'a1000000-0000-4000-8000-000000000001', null, null, 'a0000000-0000-4000-8000-000000000002', null, 'اجتماع الخدام الأسبوع القادم بعد القداس — الحضور ضروري', now() - interval '1 day 3 hours'),
  ('broadcast_staff', null, null, null, null, null, 'a0000000-0000-4000-8000-000000000001', null, 'تم تفعيل وحدة المكتبة لكل الكنائس 📚', now() - interval '3 days');

insert into public.chat_read_state (reader_profile_id, reader_person_id, bucket, last_read_at) values
  ('a0000000-0000-4000-8000-000000000005', null, 'e:b2000000-0000-4000-8000-000000000001', now() - interval '2 hours 40 minutes'),
  ('a0000000-0000-4000-8000-000000000004', null, 'e:b2000000-0000-4000-8000-000000000009', now() - interval '23 hours'),
  ('a0000000-0000-4000-8000-000000000004', null, 's:a0000000-0000-4000-8000-000000000003', now() - interval '4 hours 50 minutes'),
  ('a0000000-0000-4000-8000-000000000003', null, 's:a0000000-0000-4000-8000-000000000004', now() - interval '4 hours 50 minutes'),
  ('a0000000-0000-4000-8000-000000000002', null, 'b', now() - interval '1 day 3 hours'),
  (null, 'b1000000-0000-4000-8000-000000000001', 'e:b2000000-0000-4000-8000-000000000001', now() - interval '2 hours 50 minutes'),
  (null, 'b1000000-0000-4000-8000-000000000009', 'e:b2000000-0000-4000-8000-000000000009', now() - interval '1 day');

-- ---------------------------------------------------------------------
-- 19. الفصول الأونلاين — ended (finalized) · live now · scheduled · cancelled
-- ---------------------------------------------------------------------
do $$ begin perform pg_temp.act('a0000000-0000-4000-8000-000000000004'); end $$;
insert into public.online_classes (id, church_id, service_id, class_id, title, description, starts_at, ends_at, platform, stream_url, status, started_at, ended_at, chat_enabled, exam_id, event_id, min_time_percent, checks_required, checks_min_success, min_answers, check_seconds, attendance_points, finalized_at, created_by) values
  ('f1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000002', 'درس أونلاين — مثل الابن الضال', 'شرح مثل الابن الضال (لوقا 15)', now() - interval '7 days 1 hour', now() - interval '7 days', 'youtube', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'ended', now() - interval '7 days 58 minutes', now() - interval '7 days 2 minutes', true, null, 'c1000000-0000-4000-8000-000000000003', 60, 3, 2, 1, 60, 5, now() - interval '7 days', 'a0000000-0000-4000-8000-000000000004'),
  ('f1000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', null, '🔴 لقاء مباشر — أسئلة وأجوبة', 'لقاء مفتوح مع أبونا — كل فصول مدارس الأحد', now() - interval '20 minutes', now() + interval '40 minutes', 'youtube', 'https://www.youtube.com/watch?v=jNQXAC9IVRw', 'live', now() - interval '18 minutes', null, true, null, 'c1000000-0000-4000-8000-000000000001', 50, 2, 1, 0, 90, 5, null, 'a0000000-0000-4000-8000-000000000003'),
  ('f1000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000003', 'ثانوي — الإيمان والعلم', 'محاضرة للمرحلة الثانوية', now() + interval '2 days', now() + interval '2 days 1 hour', 'zoom', 'https://zoom.us/j/000000000', 'scheduled', null, null, true, 'e1000000-0000-4000-8000-000000000001', null, 60, 3, 2, 0, 60, 8, null, 'a0000000-0000-4000-8000-000000000003'),
  ('f1000000-0000-4000-8000-000000000004', 'a1000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000002', null, 'اجتماع الشباب أونلاين (ملغي)', 'أُلغي بسبب انقطاع الكهرباء', now() - interval '3 days', now() - interval '3 days' + interval '1 hour', 'meet', 'https://meet.google.com/abc-defg-hij', 'cancelled', null, null, false, null, null, 60, 3, 2, 0, 60, 0, null, 'a0000000-0000-4000-8000-000000000002');

-- the ENDED class: participants · sessions · checks · questions · answers · messages · finalized attendance
insert into public.online_class_participants (id, class_id, enrollment_id, person_id, church_id, service_id, room_class_id, first_joined_at, last_seen_at, left_at, total_seconds, sessions_count, checks_ok, checks_late, answers_count, correct_count, messages_count, final_status, final_percent, final_checks_total, finalized_at)
select ('f2000000-0000-4000-8000-0000000000' || right(e.id::text, 2))::uuid, 'f1000000-0000-4000-8000-000000000001', e.id, e.person_id, e.church_id, e.service_id, e.class_id,
       now() - interval '7 days 57 minutes', now() - interval '7 days 3 minutes', now() - interval '7 days 2 minutes',
       case when n in (13, 16) then 1200 else 3200 end, 1,
       case when n in (13, 16) then 1 else 3 end, case when n in (13, 16) then 1 else 0 end,
       1, case when n % 2 = 0 then 1 else 0 end, case when n in (9, 10) then 2 else 0 end,
       case when n in (13, 16) then 'absent' else 'present' end, case when n in (13, 16) then 35 else 92 end, 3, now() - interval '7 days'
  from kids e, lateral (select right(e.id::text, 2)::int as n) x
 where e.class_id = 'a3000000-0000-4000-8000-000000000002' and n <> 15;

insert into public.online_class_sessions (participant_id, class_id, joined_at, last_seen_at, left_at)
select p.id, p.class_id, p.first_joined_at, p.last_seen_at, p.left_at from public.online_class_participants p where p.class_id = 'f1000000-0000-4000-8000-000000000001';

insert into public.online_class_checks (id, class_id, seq, prompt, sent_at, expires_at, sent_by) values
  ('f3000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 1, 'معايا؟ اضغط ✋', now() - interval '7 days 45 minutes', now() - interval '7 days 44 minutes', 'a0000000-0000-4000-8000-000000000004'),
  ('f3000000-0000-4000-8000-000000000002', 'f1000000-0000-4000-8000-000000000001', 2, 'لسه موجود؟', now() - interval '7 days 30 minutes', now() - interval '7 days 29 minutes', 'a0000000-0000-4000-8000-000000000004'),
  ('f3000000-0000-4000-8000-000000000003', 'f1000000-0000-4000-8000-000000000001', 3, 'آخر تأكيد حضور', now() - interval '7 days 10 minutes', now() - interval '7 days 9 minutes', 'a0000000-0000-4000-8000-000000000004');

insert into public.online_class_check_responses (check_id, class_id, participant_id, responded_at, ok, latency_ms)
select c.id, c.class_id, p.id, c.sent_at + interval '8 seconds', true, 8000
  from public.online_class_checks c join public.online_class_participants p on p.class_id = c.class_id
 where c.class_id = 'f1000000-0000-4000-8000-000000000001'
   and not (p.final_status = 'absent' and c.seq > 1);

insert into public.online_class_questions (id, class_id, sort_order, text, options, correct_index, points, status, opened_at, closed_at, created_by) values
  ('f4000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 1, 'ماذا فعل الأب عندما رأى ابنه راجعاً؟', '["عاقبه","ركض وعانقه","أغلق الباب","أرسله للحقل"]', 1, 2, 'closed', now() - interval '7 days 40 minutes', now() - interval '7 days 35 minutes', 'a0000000-0000-4000-8000-000000000004'),
  ('f4000000-0000-4000-8000-000000000002', 'f1000000-0000-4000-8000-000000000001', 2, 'ما الذي تعلمته من المثل؟ (إجابة حرة)', null, null, 0, 'closed', now() - interval '7 days 20 minutes', now() - interval '7 days 12 minutes', 'a0000000-0000-4000-8000-000000000004'),
  ('f4000000-0000-4000-8000-000000000003', 'f1000000-0000-4000-8000-000000000002', 1, 'أي سفر يبدأ بـ «في البدء خلق الله»؟', '["الخروج","التكوين","يوحنا","المزامير"]', 1, 1, 'open', now() - interval '5 minutes', null, 'a0000000-0000-4000-8000-000000000003'),
  ('f4000000-0000-4000-8000-000000000004', 'f1000000-0000-4000-8000-000000000002', 2, 'سؤال احتياطي (مسودة)', '["أ","ب","ج"]', 0, 1, 'draft', null, null, 'a0000000-0000-4000-8000-000000000003');

do $$
declare p record; v_pl uuid; ok boolean;
begin
  for p in select * from public.online_class_participants where class_id = 'f1000000-0000-4000-8000-000000000001' and final_status = 'present' loop
    ok := right(p.enrollment_id::text, 2)::int % 2 = 0;
    v_pl := null;
    if ok then
      insert into public.points_log (enrollment_id, delta, recorded_by, created_at) values (p.enrollment_id, 2, 'a0000000-0000-4000-8000-000000000004', now() - interval '7 days 38 minutes') returning id into v_pl;
    end if;
    insert into public.online_class_answers (question_id, class_id, participant_id, selected_index, is_correct, points_granted, points_log_id, answered_at)
    values ('f4000000-0000-4000-8000-000000000001', p.class_id, p.id, case when ok then 1 else 0 end, ok, case when ok then 2 else 0 end, v_pl, now() - interval '7 days 38 minutes');
  end loop;
end $$;
insert into public.online_class_answers (question_id, class_id, participant_id, answer_text, answered_at) values
  ('f4000000-0000-4000-8000-000000000002', 'f1000000-0000-4000-8000-000000000001', 'f2000000-0000-4000-8000-000000000009', 'إن الله يقبلنا مهما أخطأنا لو رجعنا له', now() - interval '7 days 18 minutes'),
  ('f4000000-0000-4000-8000-000000000002', 'f1000000-0000-4000-8000-000000000001', 'f2000000-0000-4000-8000-000000000010', 'محبة الأب أكبر من خطية الابن', now() - interval '7 days 17 minutes');

insert into public.online_class_messages (class_id, sender_profile_id, sender_participant_id, body, created_at) values
  ('f1000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000004', null, 'أهلاً بكم — هنبدأ بعد دقيقة 🙏', now() - interval '7 days 57 minutes'),
  ('f1000000-0000-4000-8000-000000000001', null, 'f2000000-0000-4000-8000-000000000009', 'الصوت واضح يا أستاذ', now() - interval '7 days 56 minutes'),
  ('f1000000-0000-4000-8000-000000000001', null, 'f2000000-0000-4000-8000-000000000010', 'ممكن تكرر الآية؟', now() - interval '7 days 30 minutes'),
  ('f1000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000004', null, 'لوقا 15: 20 — «وإذ كان لم يزل بعيداً رآه أبوه فتحنن»', now() - interval '7 days 29 minutes'),
  ('f1000000-0000-4000-8000-000000000001', null, 'f2000000-0000-4000-8000-000000000009', 'شكراً ❤️', now() - interval '7 days 28 minutes'),
  ('f1000000-0000-4000-8000-000000000001', null, 'f2000000-0000-4000-8000-000000000010', 'ربنا يعوض تعب محبتك', now() - interval '7 days 3 minutes');

-- finalized attendance for the present participants (one attendance_log each, tied back to the participant)
do $$
declare p record; v_al uuid; d date := (now() - interval '7 days')::date;
begin
  for p in select * from public.online_class_participants where class_id = 'f1000000-0000-4000-8000-000000000001' and final_status = 'present' loop
    if not exists (select 1 from public.attendance_log where enrollment_id = p.enrollment_id and event_id = 'c1000000-0000-4000-8000-000000000003' and attended_on = d) then
      insert into public.attendance_log (enrollment_id, event_id, points_delta, recorded_by, attended_on, created_at)
      values (p.enrollment_id, 'c1000000-0000-4000-8000-000000000003', 5, 'a0000000-0000-4000-8000-000000000004', d, now() - interval '7 days') returning id into v_al;
    else
      select id into v_al from public.attendance_log where enrollment_id = p.enrollment_id and event_id = 'c1000000-0000-4000-8000-000000000003' and attended_on = d limit 1;
    end if;
    update public.online_class_participants set attendance_log_id = v_al where id = p.id;
  end loop;
  -- one manual override: the servant marks an «absent» child present (bad connection)
  update public.online_class_participants set override_status = 'present', override_by = 'a0000000-0000-4000-8000-000000000004', override_at = now() - interval '6 days 23 hours'
   where id = 'f2000000-0000-4000-8000-000000000016';
end $$;

-- the LIVE class: participants currently in the room (open sessions) + live chat
insert into public.online_class_participants (id, class_id, enrollment_id, person_id, church_id, service_id, room_class_id, first_joined_at, last_seen_at, total_seconds, sessions_count, checks_ok, answers_count, correct_count, messages_count)
select ('f2000000-0000-4000-8000-0000000001' || right(e.id::text, 2))::uuid, 'f1000000-0000-4000-8000-000000000002', e.id, e.person_id, e.church_id, e.service_id, e.class_id,
       now() - interval '17 minutes', now() - interval '20 seconds', 1000, 1, 1, 0, 0, 0
  from kids e where e.service_id = 'a2000000-0000-4000-8000-000000000001' and right(e.id::text, 2)::int in (1, 2, 5, 9, 10, 11, 12, 17, 18);
insert into public.online_class_sessions (participant_id, class_id, joined_at, last_seen_at)
select p.id, p.class_id, p.first_joined_at, p.last_seen_at from public.online_class_participants p where p.class_id = 'f1000000-0000-4000-8000-000000000002';
insert into public.online_class_checks (id, class_id, seq, prompt, sent_at, expires_at, sent_by) values
  ('f3000000-0000-4000-8000-000000000011', 'f1000000-0000-4000-8000-000000000002', 1, 'معايا؟ ✋', now() - interval '10 minutes', now() - interval '8 minutes 30 seconds', 'a0000000-0000-4000-8000-000000000003');
insert into public.online_class_check_responses (check_id, class_id, participant_id, responded_at, ok, latency_ms)
select 'f3000000-0000-4000-8000-000000000011', p.class_id, p.id, now() - interval '9 minutes 50 seconds', true, 10000
  from public.online_class_participants p where p.class_id = 'f1000000-0000-4000-8000-000000000002';
insert into public.online_class_messages (class_id, sender_profile_id, sender_participant_id, body, created_at) values
  ('f1000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000003', null, 'أهلاً بالجميع — ابعتوا أسئلتكم هنا 👇', now() - interval '16 minutes'),
  ('f1000000-0000-4000-8000-000000000002', null, 'f2000000-0000-4000-8000-000000000109', 'ليه بنصوم الأربعاء والجمعة؟', now() - interval '12 minutes'),
  ('f1000000-0000-4000-8000-000000000002', null, 'f2000000-0000-4000-8000-000000000117', 'إزاي أعرف إرادة ربنا في حياتي؟', now() - interval '6 minutes');

-- ---------------------------------------------------------------------
-- 20. الفعاليات (occasions) — trip · conference · celebration · draft ·
--     completed — with registrations · checklist · notifications
-- ---------------------------------------------------------------------
insert into public.occasions (id, church_id, service_id, class_id, title, description, image_url, kind, starts_at, ends_at, location, location_url, organizer, organizer_phone, registration_deadline, capacity, auto_confirm, checkin_points, status, created_by) values
  ('f5000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', null, 'رحلة دير الأنبا بولا', 'رحلة يوم كامل لدير الأنبا بولا بالبحر الأحمر — الحضور 7 صباحاً أمام الكنيسة', null, 'trip', (current_date + 9)::timestamp + time '07:00', (current_date + 9)::timestamp + time '21:00', 'دير الأنبا بولا — البحر الأحمر', 'https://maps.google.com/?q=St+Paul+Monastery', 'مريم سامح', '+201000000003', (current_date + 6)::timestamp + time '23:59', 20, false, 10, 'published', 'a0000000-0000-4000-8000-000000000003'),
  ('f5000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001', null, null, 'مؤتمر الشباب السنوي', 'مؤتمر ٣ أيام — بيت الخلوة', null, 'conference', (current_date + 30)::timestamp + time '16:00', (current_date + 32)::timestamp + time '14:00', 'بيت خلوة الأنبا أنطونيوس', null, 'مينا عادل', '+201000000002', (current_date + 20)::timestamp + time '23:59', 60, true, 20, 'published', 'a0000000-0000-4000-8000-000000000002'),
  ('f5000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000001', 'حفلة نهاية العام — ابتدائي', 'حفلة وتوزيع جوائز لفصل الابتدائي', null, 'celebration', (current_date + 1)::timestamp + time '17:00', (current_date + 1)::timestamp + time '19:30', 'قاعة الكنيسة', null, 'مارينا نبيل', '+201000000005', null, null, true, 5, 'published', 'a0000000-0000-4000-8000-000000000005'),
  ('f5000000-0000-4000-8000-000000000004', 'a1000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', null, 'يوم خدمة اجتماعية (مسودة)', 'زيارة دار الأيتام — التفاصيل لاحقاً', null, 'activity', (current_date + 45)::timestamp + time '10:00', null, null, null, null, null, null, 15, false, 0, 'draft', 'a0000000-0000-4000-8000-000000000003'),
  ('f5000000-0000-4000-8000-000000000005', 'a1000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', null, 'رحلة الأقصر — البر الغربي', 'زيارة دير القديس توماس ووادي الملوك', null, 'trip', (current_date - 20)::timestamp + time '08:00', (current_date - 20)::timestamp + time '18:00', 'البر الغربي — الأقصر', null, 'مريم سامح', '+201000000003', (current_date - 23)::timestamp, 25, false, 10, 'completed', 'a0000000-0000-4000-8000-000000000003'),
  ('f5000000-0000-4000-8000-000000000006', 'a1000000-0000-4000-8000-000000000002', null, null, 'احتفال عيد مارجرجس', 'قداس واحتفال بعيد شفيع الكنيسة', null, 'celebration', (current_date + 14)::timestamp + time '18:00', (current_date + 14)::timestamp + time '21:00', 'كنيسة مارجرجس — إسنا', null, 'بيشوي رأفت', '+201000000006', null, null, true, 5, 'published', 'a0000000-0000-4000-8000-000000000006');

insert into public.occasion_checklist_items (id, occasion_id, label, required, sort_order, created_by) values
  ('f6000000-0000-4000-8000-000000000001', 'f5000000-0000-4000-8000-000000000001', 'دفع الاشتراك (150 ج)', true, 1, 'a0000000-0000-4000-8000-000000000003'),
  ('f6000000-0000-4000-8000-000000000002', 'f5000000-0000-4000-8000-000000000001', 'موافقة ولي الأمر', true, 2, 'a0000000-0000-4000-8000-000000000003'),
  ('f6000000-0000-4000-8000-000000000003', 'f5000000-0000-4000-8000-000000000001', 'صورة البطاقة / شهادة الميلاد', false, 3, 'a0000000-0000-4000-8000-000000000003'),
  ('f6000000-0000-4000-8000-000000000004', 'f5000000-0000-4000-8000-000000000002', 'دفع الاشتراك', true, 1, 'a0000000-0000-4000-8000-000000000002'),
  ('f6000000-0000-4000-8000-000000000005', 'f5000000-0000-4000-8000-000000000005', 'دفع الاشتراك', true, 1, 'a0000000-0000-4000-8000-000000000003');

-- registrations for the trip: mix of pending / confirmed / cancelled (ticket codes T-XXXXXXXXXX)
insert into public.occasion_registrations (id, occasion_id, enrollment_id, status, ticket_code, source, registered_at, registered_by, confirmed_at, cancelled_at, note)
select ('f7000000-0000-4000-8000-0000000000' || right(e.id::text, 2))::uuid, 'f5000000-0000-4000-8000-000000000001', e.id,
       case when n in (1, 2, 9, 10, 11, 17) then 'confirmed' when n = 13 then 'cancelled' else 'pending' end,
       'T-' || upper(substr(md5('trip' || e.id::text), 1, 10)),
       case when n in (9, 10, 11) then 'leader' else 'self' end,
       now() - (interval '1 day' * (n % 5)) - interval '2 hours',
       case when n in (9, 10, 11) then 'a0000000-0000-4000-8000-000000000004'::uuid end,
       case when n in (1, 2, 9, 10, 11, 17) then now() - (interval '1 day' * (n % 5)) end,
       case when n = 13 then now() - interval '1 day' end,
       case when n = 13 then 'اعتذر — ظرف عائلي' end
  from kids e, lateral (select right(e.id::text, 2)::int as n) x
 where e.service_id = 'a2000000-0000-4000-8000-000000000001' and n in (1, 2, 3, 5, 9, 10, 11, 12, 13, 14, 17, 18);

insert into public.occasion_checklist_marks (registration_id, item_id, marked_at, marked_by)
select r.id, i.id, r.confirmed_at, 'a0000000-0000-4000-8000-000000000003'
  from public.occasion_registrations r join public.occasion_checklist_items i on i.occasion_id = r.occasion_id
 where r.occasion_id = 'f5000000-0000-4000-8000-000000000001' and r.status = 'confirmed' and i.required;

-- celebration tomorrow (auto-confirm): the whole ابتدائي class registered
insert into public.occasion_registrations (occasion_id, enrollment_id, status, ticket_code, source, registered_at, confirmed_at)
select 'f5000000-0000-4000-8000-000000000003', e.id, 'confirmed', 'T-' || upper(substr(md5('party' || e.id::text), 1, 10)), 'self', now() - interval '2 days', now() - interval '2 days'
  from kids e where e.class_id = 'a3000000-0000-4000-8000-000000000001';

-- completed trip (20 days ago): checked-in participants with check-in points
do $$
declare e record; v_pl uuid; d timestamptz := (current_date - 20)::timestamp + time '07:45';
begin
  for e in select x.*, right(x.id::text, 2)::int as n from kids x where x.service_id = 'a2000000-0000-4000-8000-000000000001' and right(x.id::text, 2)::int in (2, 4, 6, 9, 10, 12, 14, 17, 19) loop
    v_pl := null;
    if e.n <> 4 then
      insert into public.points_log (enrollment_id, delta, recorded_by, created_at) values (e.id, 10, 'a0000000-0000-4000-8000-000000000003', d) returning id into v_pl;
    end if;
    insert into public.occasion_registrations (occasion_id, enrollment_id, status, ticket_code, source, registered_at, confirmed_at, checked_in_at, checked_in_by, points_log_id)
    values ('f5000000-0000-4000-8000-000000000005', e.id, case when e.n = 4 then 'confirmed' else 'checked_in' end, 'T-' || upper(substr(md5('old' || e.id::text), 1, 10)), 'self',
            d - interval '10 days', d - interval '9 days', case when e.n <> 4 then d end, case when e.n <> 4 then 'a0000000-0000-4000-8000-000000000003'::uuid end, v_pl);
  end loop;
end $$;

-- conference: a few registrations (auto_confirm) + church 2 celebration
insert into public.occasion_registrations (occasion_id, enrollment_id, status, ticket_code, source, registered_at, confirmed_at)
select 'f5000000-0000-4000-8000-000000000002'::uuid, e.id, 'confirmed', 'T-' || upper(substr(md5('conf' || e.id::text), 1, 10)), 'self', now() - interval '3 days', now() - interval '3 days'
  from kids e where right(e.id::text, 2)::int in (17, 18, 19, 20, 22, 23)
union all
select 'f5000000-0000-4000-8000-000000000006'::uuid, e.id, 'confirmed', 'T-' || upper(substr(md5('gg' || e.id::text), 1, 10)), 'self', now() - interval '1 day', now() - interval '1 day'
  from kids e where e.church_id = 'a1000000-0000-4000-8000-000000000002';

insert into public.occasion_notifications (occasion_id, registration_id, kind, body, created_at, created_by) values
  ('f5000000-0000-4000-8000-000000000001', null, 'announcement', 'تم فتح التسجيل لرحلة دير الأنبا بولا — الأماكن محدودة (20)', now() - interval '5 days', 'a0000000-0000-4000-8000-000000000003'),
  ('f5000000-0000-4000-8000-000000000001', null, 'reminder', 'تذكير: آخر موعد للتسجيل بعد 3 أيام — من لم يدفع الاشتراك لن يُثبَّت مكانه', now() - interval '1 day', 'a0000000-0000-4000-8000-000000000003'),
  ('f5000000-0000-4000-8000-000000000001', 'f7000000-0000-4000-8000-000000000001', 'status', 'تم تأكيد تسجيلك في رحلة دير الأنبا بولا ✅ تذكرتك في بوابتك', now() - interval '2 hours', 'a0000000-0000-4000-8000-000000000003'),
  ('f5000000-0000-4000-8000-000000000001', 'f7000000-0000-4000-8000-000000000013', 'status', 'تم إلغاء تسجيلك في رحلة دير الأنبا بولا', now() - interval '1 day', null),
  ('f5000000-0000-4000-8000-000000000003', null, 'announcement', 'حفلة نهاية العام غداً 5 مساءً — الحضور بالزي الموحد 🎉', now() - interval '6 hours', 'a0000000-0000-4000-8000-000000000005');

-- ---------------------------------------------------------------------
-- 21. الإشعارات — manual (sent · scheduled · cancelled) + recipients + push
do $$ begin perform pg_temp.act('a0000000-0000-4000-8000-000000000003'); end $$;
--     (automatic ones were already produced by the triggers above)
-- ---------------------------------------------------------------------
insert into public.notifications (id, church_id, service_id, class_id, title, body, image_url, link_url, target_kind, audience, target_servant_id, enrollment_ids, status, scheduled_at, sent_at, recipients_count, error, source, created_by, created_at) values
  ('f8000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', null, 'مسابقة الكتاب المقدس اليوم 📖', 'الحضور 4 عصراً — الحضور 15 نقطة والفائز له مفاجأة!', null, '/child', 'service', 'children', null, null, 'sent', null, now() - interval '9 hours', 0, null, 'manual', 'a0000000-0000-4000-8000-000000000003', now() - interval '9 hours'),
  ('f8000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000002', 'واجب درس الكتاب', 'لا تنسوا حل الواجب قبل الثلاثاء — 4 نقاط', null, null, 'class', 'children', null, null, 'sent', null, now() - interval '2 days', 0, null, 'manual', 'a0000000-0000-4000-8000-000000000004', now() - interval '2 days'),
  ('f8000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000001', null, null, 'اجتماع الخدام', 'اجتماع الخدام الأسبوع القادم بعد القداس — الحضور ضروري', null, null, 'church', 'staff', null, null, 'sent', null, now() - interval '1 day 3 hours', 0, null, 'manual', 'a0000000-0000-4000-8000-000000000002', now() - interval '1 day 3 hours'),
  ('f8000000-0000-4000-8000-000000000004', 'a1000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000002', 'مجموعة الافتقاد — جورج', 'أنا معاكم دايماً 🙏 لو محتاجين أي حاجة كلموني', null, null, 'group', 'children', 'a0000000-0000-4000-8000-000000000004', null, 'sent', null, now() - interval '4 days', 0, null, 'manual', 'a0000000-0000-4000-8000-000000000004', now() - interval '4 days'),
  ('f8000000-0000-4000-8000-000000000005', 'a1000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000002', 'مبروك مينا 🏆', 'الدرجة الكاملة في مسابقة سفر التكوين — فخورين بك', null, '/child/exams', 'person', 'children', null, array['b2000000-0000-4000-8000-000000000009']::uuid[], 'sent', null, now() - interval '1 day 20 hours', 0, null, 'manual', 'a0000000-0000-4000-8000-000000000004', now() - interval '1 day 20 hours'),
  ('f8000000-0000-4000-8000-000000000006', 'a1000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', null, 'تذكير رحلة الدير 🚌', 'الحضور 7 صباحاً أمام الكنيسة — لا تنسَ تذكرتك وموافقة ولي الأمر', null, '/child/occasions', 'service', 'children', null, null, 'scheduled', (current_date + 8)::timestamp + time '18:00', null, 0, null, 'manual', 'a0000000-0000-4000-8000-000000000003', now() - interval '1 hour'),
  ('f8000000-0000-4000-8000-000000000007', 'a1000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000002', null, 'اجتماع الشباب', 'الاجتماع الخميس 7 مساءً', null, null, 'service', 'children', null, null, 'scheduled', now() + interval '3 hours', null, 0, null, 'manual', 'a0000000-0000-4000-8000-000000000002', now() - interval '30 minutes'),
  ('f8000000-0000-4000-8000-000000000008', null, null, null, 'تحديث التطبيق 🚀', 'تم إضافة وحدة المكتبة — كتب ومحاضرات لكل الخدام', null, '/library', 'all', 'staff', null, null, 'sent', null, now() - interval '3 days', 0, null, 'manual', 'a0000000-0000-4000-8000-000000000001', now() - interval '3 days'),
  ('f8000000-0000-4000-8000-000000000009', 'a1000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000003', 'إشعار قديم ملغي', 'أُلغي قبل الإرسال', null, null, 'class', 'children', null, null, 'cancelled', now() - interval '5 days', null, 0, null, 'manual', 'a0000000-0000-4000-8000-000000000003', now() - interval '6 days'),
  ('f8000000-0000-4000-8000-000000000010', 'a1000000-0000-4000-8000-000000000002', 'a2000000-0000-4000-8000-000000000003', null, 'عيد مارجرجس 🎉', 'الاحتفال بعيد شفيع الكنيسة بعد أسبوعين — سجّل حضورك من الفعاليات', null, '/child/occasions', 'service', 'children', null, null, 'sent', null, now() - interval '1 day', 0, null, 'manual', 'a0000000-0000-4000-8000-000000000006', now() - interval '1 day');

-- materialize recipients of the sent manual notifications the same way notif_materialize does
do $$
declare n public.notifications; cnt int;
begin
  for n in select * from public.notifications where id::text like 'f8000000-%' and status = 'sent' loop
    if n.audience = 'staff' then
      insert into public.notification_recipients (notification_id, profile_id, title, body, image_url, link_url, read_at, push_status, created_at)
      select n.id, t.id, n.title, n.body, n.image_url, n.link_url,
             case when t.id in ('a0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000004') then n.sent_at + interval '20 minutes' end,
             'no_device', n.sent_at
        from public.servant_enrollments t
       where t.status = 'approved' and t.role <> 'owner' and t.id is distinct from n.created_by
         and (n.church_id is null or t.church_id = n.church_id);
    else
      insert into public.notification_recipients (notification_id, enrollment_id, person_id, title, body, image_url, link_url, read_at, push_status, created_at)
      select n.id, e.id, e.person_id, n.title, n.body, n.image_url, n.link_url,
             case when right(e.id::text, 2)::int % 3 = 0 then n.sent_at + interval '1 hour' end,
             'no_device', n.sent_at
        from kids e
       where e.status = 'active' and case n.target_kind
               when 'person' then e.id = any(coalesce(n.enrollment_ids, '{}'))
               when 'group'  then exists (select 1 from public.shepherd_groups g where g.enrollment_id = e.id and g.servant_id = n.target_servant_id)
               else (n.church_id is null or e.church_id = n.church_id)
                and (n.service_id is null or e.service_id = n.service_id)
                and (n.class_id is null or e.class_id = n.class_id)
             end;
    end if;
    get diagnostics cnt = row_count;
    update public.notifications set recipients_count = cnt where id = n.id;
  end loop;
  -- mark some automatic notifications as read too (child portal inbox)
  update public.notification_recipients set read_at = created_at + interval '2 hours'
   where person_id in ('b1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000009') and created_at < now() - interval '3 hours';
end $$;

-- push subscriptions: 2 servants + 2 children (demo endpoints); one failed device
insert into public.push_subscriptions (endpoint, p256dh, auth, profile_id, person_id, user_agent, created_at, last_seen_at, failed_at) values
  ('https://fcm.googleapis.com/fcm/send/demo-servant-0004', 'BDemoP256dhKey0004AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', 'demoAuth0004AAAAAAAAAA', 'a0000000-0000-4000-8000-000000000004', null, 'Mozilla/5.0 (Android 14; Mobile) Chrome/125', now() - interval '20 days', now() - interval '1 hour', null),
  ('https://fcm.googleapis.com/fcm/send/demo-servant-0005', 'BDemoP256dhKey0005AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', 'demoAuth0005AAAAAAAAAA', 'a0000000-0000-4000-8000-000000000005', null, 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5) Safari/604.1', now() - interval '15 days', now() - interval '3 hours', null),
  ('https://fcm.googleapis.com/fcm/send/demo-child-0001',   'BDemoP256dhKeyC001AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', 'demoAuthC001AAAAAAAAAA', null, 'b1000000-0000-4000-8000-000000000001', 'Mozilla/5.0 (Android 13; Mobile) Chrome/124', now() - interval '10 days', now() - interval '2 hours', null),
  ('https://fcm.googleapis.com/fcm/send/demo-child-0009',   'BDemoP256dhKeyC009AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', 'demoAuthC009AAAAAAAAAA', null, 'b1000000-0000-4000-8000-000000000009', 'Mozilla/5.0 (Android 14; Mobile) Chrome/125', now() - interval '8 days', now() - interval '1 day', null),
  ('https://fcm.googleapis.com/fcm/send/demo-child-0010-old', 'BDemoP256dhKeyC010AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', 'demoAuthC010AAAAAAAAAA', null, 'b1000000-0000-4000-8000-000000000010', 'Mozilla/5.0 (Android 12; Mobile) Chrome/110', now() - interval '60 days', now() - interval '30 days', now() - interval '30 days');
-- recipients with a device: mark as pushed / pending / failed for realism
update public.notification_recipients r set push_status = 'sent', pushed_at = r.created_at + interval '5 seconds'
 where (r.person_id in ('b1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000009') or r.profile_id in ('a0000000-0000-4000-8000-000000000004', 'a0000000-0000-4000-8000-000000000005'))
   and r.created_at < now() - interval '1 hour';
update public.notification_recipients r set push_status = 'pending', pushed_at = null
 where (r.person_id in ('b1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000009') or r.profile_id in ('a0000000-0000-4000-8000-000000000004', 'a0000000-0000-4000-8000-000000000005'))
   and r.created_at >= now() - interval '1 hour';
update public.notification_recipients r set push_status = 'failed', push_error = 'WebPushError: 410 Gone (subscription expired)', pushed_at = r.created_at + interval '5 seconds'
 where r.person_id = 'b1000000-0000-4000-8000-000000000010' and r.created_at < now() - interval '25 days';

-- ---------------------------------------------------------------------
-- 22. نتائج الامتحانات (results module) — grading systems · result exams ·
do $$ begin perform pg_temp.act('a0000000-0000-4000-8000-000000000005'); end $$;
--     subjects · results (completed / absent / excused / draft) · locked exam
-- ---------------------------------------------------------------------
insert into public.grading_systems (id, church_id, name, description, is_default, created_by) values
  ('f9000000-0000-4000-8000-000000000001', null, 'التقدير العام', 'ممتاز · جيد جداً · جيد · مقبول · ضعيف', true, 'a0000000-0000-4000-8000-000000000001'),
  ('f9000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001', 'نجوم مدارس الأحد', 'نظام النجوم ⭐ للأطفال', false, 'a0000000-0000-4000-8000-000000000002');
insert into public.grading_grades (grading_system_id, name, min_percent, max_percent, description, color, is_pass, sort_order) values
  ('f9000000-0000-4000-8000-000000000001', 'ممتاز',    90, 100, 'أداء متميز', '#16a34a', true, 1),
  ('f9000000-0000-4000-8000-000000000001', 'جيد جداً', 80, 89.99, null, '#0891b2', true, 2),
  ('f9000000-0000-4000-8000-000000000001', 'جيد',      65, 79.99, null, '#2563eb', true, 3),
  ('f9000000-0000-4000-8000-000000000001', 'مقبول',    50, 64.99, null, '#f59e0b', true, 4),
  ('f9000000-0000-4000-8000-000000000001', 'ضعيف',     0,  49.99, 'يحتاج متابعة', '#ef4444', false, 5),
  ('f9000000-0000-4000-8000-000000000002', '⭐⭐⭐', 85, 100, null, '#eab308', true, 1),
  ('f9000000-0000-4000-8000-000000000002', '⭐⭐',   60, 84.99, null, '#f97316', true, 2),
  ('f9000000-0000-4000-8000-000000000002', '⭐',     0,  59.99, null, '#94a3b8', false, 3);

insert into public.result_exams (id, church_id, service_id, class_id, name, exam_date, academic_year, description, status, grading_system_id, grade_overall, grade_subject, pass_rule, pass_percent, absent_as_zero, min_required_subjects, published_at, created_by) values
  ('fa000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000002', 'امتحان نصف العام — إعدادي', current_date - 30, '2025/2026', 'الكتاب المقدس · العقيدة · الألحان · الطقس', 'completed', 'f9000000-0000-4000-8000-000000000001', true, true, 'both', 50, false, 3, now() - interval '25 days', 'a0000000-0000-4000-8000-000000000003'),
  ('fa000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000001', 'مسابقة الابتدائي — الترم الأول', current_date - 5, '2025/2026', null, 'open', 'f9000000-0000-4000-8000-000000000002', true, false, 'overall', 50, true, null, null, 'a0000000-0000-4000-8000-000000000005'),
  ('fa000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', null, 'امتحان آخر العام (مسودة)', current_date + 40, '2025/2026', 'لكل فصول مدارس الأحد', 'draft', 'f9000000-0000-4000-8000-000000000001', true, true, 'overall', 50, false, null, null, 'a0000000-0000-4000-8000-000000000003'),
  ('fa000000-0000-4000-8000-000000000004', 'a1000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000002', 'امتحان العام السابق (أرشيف)', current_date - 400, '2024/2025', null, 'completed', 'f9000000-0000-4000-8000-000000000001', true, true, 'overall', 50, false, null, now() - interval '390 days', 'a0000000-0000-4000-8000-000000000003');

insert into public.result_subjects (id, exam_id, name, code, full_degree, pass_degree, weight, is_bonus, sort_order) values
  ('fb000000-0000-4000-8000-000000000001', 'fa000000-0000-4000-8000-000000000001', 'الكتاب المقدس', 'BIB', 50, 25, 2, false, 1),
  ('fb000000-0000-4000-8000-000000000002', 'fa000000-0000-4000-8000-000000000001', 'العقيدة',       'DOC', 30, 15, 1, false, 2),
  ('fb000000-0000-4000-8000-000000000003', 'fa000000-0000-4000-8000-000000000001', 'الألحان',       'HYM', 20, 10, 1, false, 3),
  ('fb000000-0000-4000-8000-000000000004', 'fa000000-0000-4000-8000-000000000001', 'الطقس',         'RIT', 20, 10, 1, false, 4),
  ('fb000000-0000-4000-8000-000000000005', 'fa000000-0000-4000-8000-000000000001', 'نشاط (إضافي)',  'BON', 10, 0,  null, true, 5),
  ('fb000000-0000-4000-8000-000000000011', 'fa000000-0000-4000-8000-000000000002', 'قصص الكتاب',    null, 20, 10, null, false, 1),
  ('fb000000-0000-4000-8000-000000000012', 'fa000000-0000-4000-8000-000000000002', 'الآيات',        null, 10, 5,  null, false, 2),
  ('fb000000-0000-4000-8000-000000000021', 'fa000000-0000-4000-8000-000000000003', 'الكتاب المقدس', 'BIB', 50, 25, null, false, 1),
  ('fb000000-0000-4000-8000-000000000022', 'fa000000-0000-4000-8000-000000000003', 'العقيدة',       'DOC', 50, 25, null, false, 2),
  ('fb000000-0000-4000-8000-000000000031', 'fa000000-0000-4000-8000-000000000004', 'الكتاب المقدس', 'BIB', 50, 25, null, false, 1),
  ('fb000000-0000-4000-8000-000000000032', 'fa000000-0000-4000-8000-000000000004', 'الألحان',       'HYM', 50, 25, null, false, 2);

-- results: the BEFORE-write trigger computes percent / passed / grade.
-- Exams are still unlocked / not archived here; we lock + archive AFTER the
-- rows exist (the lock flag is set through the same GUC the lock RPC uses).
do $$
declare e record; s record; sc numeric; st text;
begin
  -- completed إعدادي exam: 8 children × 5 subjects; child 13 absent, child 16 excused in الألحان
  for e in select x.*, right(x.id::text, 2)::int as n from kids x where x.class_id = 'a3000000-0000-4000-8000-000000000002' loop
    for s in select * from public.result_subjects where exam_id = 'fa000000-0000-4000-8000-000000000001' order by sort_order loop
      st := 'completed'; sc := null;
      if e.n = 13 then st := 'absent';
      elsif e.n = 16 and s.sort_order = 3 then st := 'excused';
      else
        -- deterministic score between ~45% and 100% of the full degree
        sc := round(s.full_degree * (0.45 + ((e.n * 7 + s.sort_order * 13) % 56) / 100.0), 1);
        if e.n = 9 then sc := s.full_degree; end if;          -- top student
        if e.n = 12 and s.sort_order = 2 then sc := 9; end if; -- one fail in العقيدة
      end if;
      insert into public.exam_results (exam_id, subject_id, enrollment_id, score, status, note, created_by, created_at)
      values ('fa000000-0000-4000-8000-000000000001', s.id, e.id, sc, st, case when st = 'excused' then 'عذر مرضي' end, 'a0000000-0000-4000-8000-000000000005', now() - interval '26 days');
    end loop;
  end loop;
  -- open ابتدائي exam: part of the class entered so far (one child still draft)
  for e in select x.*, right(x.id::text, 2)::int as n from kids x where x.class_id = 'a3000000-0000-4000-8000-000000000001' and right(x.id::text, 2)::int in (1, 2, 3, 4, 5) loop
    for s in select * from public.result_subjects where exam_id = 'fa000000-0000-4000-8000-000000000002' order by sort_order loop
      sc := round(s.full_degree * (0.5 + ((e.n * 11 + s.sort_order * 3) % 50) / 100.0), 1);
      insert into public.exam_results (exam_id, subject_id, enrollment_id, score, status, created_by, created_at)
      values ('fa000000-0000-4000-8000-000000000002', s.id, e.id, sc, case when e.n = 5 then 'draft' else 'completed' end, 'a0000000-0000-4000-8000-000000000005', now() - interval '2 days');
    end loop;
  end loop;
  -- archived exam: history for 3 children
  for e in select x.*, right(x.id::text, 2)::int as n from kids x where x.class_id = 'a3000000-0000-4000-8000-000000000002' and right(x.id::text, 2)::int in (9, 10, 11) loop
    for s in select * from public.result_subjects where exam_id = 'fa000000-0000-4000-8000-000000000004' order by sort_order loop
      insert into public.exam_results (exam_id, subject_id, enrollment_id, score, status, created_by, created_at)
      values ('fa000000-0000-4000-8000-000000000004', s.id, e.id, 30 + (e.n * 3 + s.sort_order * 5) % 20, 'completed', 'a0000000-0000-4000-8000-000000000003', now() - interval '395 days');
    end loop;
  end loop;
  -- now lock the completed exam and the archive (same GUC as result_exam_set_lock)
  perform set_config('results.lock_rpc', '1', true);
  update public.result_exams set locked = true, locked_at = now() - interval '24 days',  locked_by = 'a0000000-0000-4000-8000-000000000003' where id = 'fa000000-0000-4000-8000-000000000001';
  update public.result_exams set locked = true, locked_at = now() - interval '380 days', locked_by = 'a0000000-0000-4000-8000-000000000002', status = 'archived' where id = 'fa000000-0000-4000-8000-000000000004';
  perform set_config('results.lock_rpc', '', true);
end $$;

-- ---------------------------------------------------------------------
-- 23. المكتبة — subjects (everyone · servants · service · class) · books ·
--     lectures (video / voice) · favorites (servant + child)
-- ---------------------------------------------------------------------
insert into public.library_subjects (id, name, description, image_url, audience, church_id, service_id, class_id, sort_order, created_by) values
  ('fc000000-0000-4000-8000-000000000001', 'الكتاب المقدس',          'دراسات وشروحات أسفار الكتاب المقدس', null, 'everyone', null, null, null, 1, 'a0000000-0000-4000-8000-000000000001'),
  ('fc000000-0000-4000-8000-000000000002', 'سير القديسين',           'قصص وسير آباء وقديسي الكنيسة', null, 'everyone', null, null, null, 2, 'a0000000-0000-4000-8000-000000000001'),
  ('fc000000-0000-4000-8000-000000000003', 'إعداد الخدام',            'مواد تدريبية للخدام فقط', null, 'servants', null, null, null, 3, 'a0000000-0000-4000-8000-000000000001'),
  ('fc000000-0000-4000-8000-000000000004', 'منهج مدارس الأحد',        'دروس المنهج — خدمة مدارس الأحد بكنيسة العذراء', null, 'service', 'a1000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', null, 4, 'a0000000-0000-4000-8000-000000000003'),
  ('fc000000-0000-4000-8000-000000000005', 'مذكرات إعدادي',           'ملخصات دروس فصل إعدادي', null, 'class', 'a1000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000002', 5, 'a0000000-0000-4000-8000-000000000004');

insert into public.library_books (id, subject_id, title, author, description, cover_url, pdf_url, audience, church_id, service_id, class_id, sort_order, created_by) values
  ('fd000000-0000-4000-8000-000000000001', 'fc000000-0000-4000-8000-000000000001', 'تفسير سفر التكوين', 'القمص تادرس يعقوب ملطي', 'تفسير مبسط للإصحاحات', null, 'https://example.org/library/genesis-commentary.pdf', 'everyone', null, null, null, 1, 'a0000000-0000-4000-8000-000000000001'),
  ('fd000000-0000-4000-8000-000000000002', 'fc000000-0000-4000-8000-000000000001', 'قصص الكتاب المقدس للأطفال', null, 'قصص مصورة', null, 'https://example.org/library/bible-stories-kids.pdf', 'everyone', null, null, null, 2, 'a0000000-0000-4000-8000-000000000001'),
  ('fd000000-0000-4000-8000-000000000003', 'fc000000-0000-4000-8000-000000000002', 'حياة البابا كيرلس السادس', null, 'سيرة القديس البابا كيرلس', null, 'https://example.org/library/pope-kyrillos.pdf', 'everyone', null, null, null, 1, 'a0000000-0000-4000-8000-000000000002'),
  ('fd000000-0000-4000-8000-000000000004', 'fc000000-0000-4000-8000-000000000003', 'دليل خادم مدارس الأحد', 'أسقفية الشباب', 'أساسيات الخدمة والتعامل مع الأطفال', null, 'https://example.org/library/servant-guide.pdf', 'servants', null, null, null, 1, 'a0000000-0000-4000-8000-000000000001'),
  ('fd000000-0000-4000-8000-000000000005', 'fc000000-0000-4000-8000-000000000004', 'منهج الترم الأول — ابتدائي', null, 'دروس الترم الأول', null, 'https://example.org/library/curriculum-primary-t1.pdf', 'service', 'a1000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', null, 1, 'a0000000-0000-4000-8000-000000000003'),
  ('fd000000-0000-4000-8000-000000000006', 'fc000000-0000-4000-8000-000000000005', 'ملخص درس الابن الضال', 'جورج فايز', null, null, 'https://example.org/library/prodigal-summary.pdf', 'class', 'a1000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000002', 1, 'a0000000-0000-4000-8000-000000000004');

insert into public.library_lectures (id, subject_id, title, speaker, description, lecture_date, kind, media_url, thumbnail_url, audience, church_id, service_id, class_id, sort_order, created_by) values
  ('fe000000-0000-4000-8000-000000000001', 'fc000000-0000-4000-8000-000000000001', 'مقدمة في سفر التكوين', 'أبونا يوحنا', 'محاضرة تمهيدية', current_date - 40, 'video', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', null, 'everyone', null, null, null, 1, 'a0000000-0000-4000-8000-000000000001'),
  ('fe000000-0000-4000-8000-000000000002', 'fc000000-0000-4000-8000-000000000002', 'القديس مارجرجس — الشهيد', 'أبونا يوحنا', null, current_date - 20, 'voice', 'https://example.org/library/st-george.mp3', null, 'everyone', null, null, null, 1, 'a0000000-0000-4000-8000-000000000001'),
  ('fe000000-0000-4000-8000-000000000003', 'fc000000-0000-4000-8000-000000000003', 'كيف تعد درساً لمدارس الأحد', 'مريم سامح', 'ورشة عمل للخدام', current_date - 10, 'video', 'https://www.youtube.com/watch?v=jNQXAC9IVRw', null, 'servants', null, null, null, 1, 'a0000000-0000-4000-8000-000000000003'),
  ('fe000000-0000-4000-8000-000000000004', 'fc000000-0000-4000-8000-000000000004', 'درس: يوسف الصديق', 'مارينا نبيل', 'تسجيل درس الجمعة', current_date - 7, 'video', 'https://www.youtube.com/watch?v=aqz-KE-bpKQ', null, 'service', 'a1000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', null, 1, 'a0000000-0000-4000-8000-000000000005'),
  ('fe000000-0000-4000-8000-000000000005', 'fc000000-0000-4000-8000-000000000005', 'مراجعة قبل الامتحان (صوت)', 'جورج فايز', null, current_date - 3, 'voice', 'https://example.org/library/review-prep.mp3', null, 'class', 'a1000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000002', 1, 'a0000000-0000-4000-8000-000000000004');

insert into public.library_favorites (user_id, person_id, book_id, lecture_id, created_at) values
  ('a0000000-0000-4000-8000-000000000004', null, 'fd000000-0000-4000-8000-000000000004', null, now() - interval '5 days'),
  ('a0000000-0000-4000-8000-000000000004', null, null, 'fe000000-0000-4000-8000-000000000003', now() - interval '4 days'),
  ('a0000000-0000-4000-8000-000000000005', null, 'fd000000-0000-4000-8000-000000000002', null, now() - interval '2 days'),
  (null, 'b1000000-0000-4000-8000-000000000009', 'fd000000-0000-4000-8000-000000000006', null, now() - interval '1 day'),
  (null, 'b1000000-0000-4000-8000-000000000009', null, 'fe000000-0000-4000-8000-000000000005', now() - interval '1 day'),
  (null, 'b1000000-0000-4000-8000-000000000001', 'fd000000-0000-4000-8000-000000000002', null, now() - interval '3 hours');

-- ---------------------------------------------------------------------
-- 24. تخصيص التطبيق (app_settings) — home widgets · custom names · navigation
--     · نظام الأكواد (0040) · سجل النشاط (0047)
-- ---------------------------------------------------------------------
do $$ begin perform pg_temp.act('a0000000-0000-4000-8000-000000000001'); end $$;
insert into public.app_settings (key, value, updated_by) values
  ('widgets', '{"version": 1, "items": [
      {"key": "welcome"}, {"key": "today_pulse"}, {"key": "next_event"}, {"key": "counters"},
      {"key": "quick_actions"}, {"key": "pending_approvals"}, {"key": "birthdays"}, {"key": "follow_up"},
      {"key": "weekly_streak"}, {"key": "leaderboard", "title": "أبطال النقاط 🏆"},
      {"key": "attendance_trend"}, {"key": "online_live"}, {"key": "occasions"}, {"key": "exams_open"},
      {"key": "messages_inbox"}, {"key": "notifications"}, {"key": "store_recent"},
      {"key": "achievements_feed"}, {"key": "verse", "size": "half"}
    ]}'::jsonb, 'a0000000-0000-4000-8000-000000000001'),
  ('names', '{"children": "المخدومين", "store": "كانتين النقاط", "shepherds": "أسر الافتقاد", "occasions": "الرحلات"}'::jsonb, 'a0000000-0000-4000-8000-000000000001'),
  ('navigation', '{"version": 1, "taskbar": [{"key": "home"}, {"key": "children"}, {"key": "scanner"}, {"key": "stats"}, {"key": "settings"}], "header": [{"key": "date"}, {"key": "messages"}, {"key": "notifications"}]}'::jsonb, 'a0000000-0000-4000-8000-000000000001'),
  -- 0040 نظام الأكواد: generated person / servant codes = STM-C1-231215-4F7K style;
  -- store items keep the legacy code; occasion tickets = T-<date>-<random>
  ('codes', '{"version": 1,
      "default": {"parts": [{"type": "church", "fallback": "CH"}, {"type": "class", "fallback": "C"}, {"type": "date", "format": "YYMMDD"}, {"type": "random", "length": 4, "charset": "alnum"}], "separator": "-", "case": "upper"},
      "generators": {
        "person":     {"mode": "default"},
        "servant":    {"mode": "custom", "template": {"parts": [{"type": "text", "value": "S"}, {"type": "church", "fallback": "CH"}, {"type": "random", "length": 5, "charset": "digits"}], "separator": "-", "case": "upper"}},
        "store_item": {"mode": "legacy"},
        "ticket":     {"mode": "custom", "template": {"parts": [{"type": "text", "value": "T"}, {"type": "date", "format": "YYMMDD"}, {"type": "random", "length": 5, "charset": "alnum"}], "separator": "-", "case": "upper"}}
      },
      "scopes": {
        "churches": {"a1000000-0000-4000-8000-000000000001": "STM", "a1000000-0000-4000-8000-000000000002": "MGG"},
        "services": {"a2000000-0000-4000-8000-000000000001": "SS", "a2000000-0000-4000-8000-000000000002": "YM", "a2000000-0000-4000-8000-000000000003": "SS"},
        "classes":  {"a3000000-0000-4000-8000-000000000001": "P", "a3000000-0000-4000-8000-000000000002": "M", "a3000000-0000-4000-8000-000000000003": "H", "a3000000-0000-4000-8000-000000000004": "U", "a3000000-0000-4000-8000-000000000005": "P"}
      }}'::jsonb, 'a0000000-0000-4000-8000-000000000001'),
  -- 0047 سجل النشاط: retention
  ('activity', '{"keep_days": 180, "enabled": true}'::jsonb, 'a0000000-0000-4000-8000-000000000001');

-- ---------------------------------------------------------------------
-- 25. التقارير والجداول (report_templates, 0050) — saved report designs:
--     shared (owner) · church · service · class; one per data source.
--     Shape mirrors src/lib/reports/types.ts (ReportDefinition v1).
-- ---------------------------------------------------------------------
create or replace function pg_temp.rstyle(p_size numeric, p_bold boolean, p_color text, p_align text default 'right')
returns jsonb language sql immutable as $$
  select jsonb_build_object('fontSize', p_size, 'bold', p_bold, 'italic', false, 'color', p_color, 'align', p_align, 'bg', '', 'borderColor', '', 'radius', 0)
$$;
create or replace function pg_temp.rdesign(p_title text, p_orientation text, p_elements jsonb)
returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'paper', 'A4', 'orientation', p_orientation,
    'margins', jsonb_build_object('top', 12, 'right', 12, 'bottom', 12, 'left', 12),
    'header', jsonb_build_object('enabled', true, 'height', 14, 'text', '{church_name} — {service_name}', 'showLogo', true, 'showLine', true, 'style', pg_temp.rstyle(10, true, '#475569')),
    'footer', jsonb_build_object('enabled', true, 'height', 10, 'text', 'طُبع في {today} — {user_name}', 'showLine', true, 'style', pg_temp.rstyle(8, false, '#64748b')),
    'pageNumbers', jsonb_build_object('enabled', true, 'format', 'صفحة {page} من {pages}', 'align', 'center'),
    'fontFamily', 'Cairo', 'title', p_title,
    'pages', jsonb_build_array(jsonb_build_object('id', 'pg1', 'orientation', null, 'elements', p_elements)))
$$;
create or replace function pg_temp.rtable(p_y numeric, p_h numeric, p_w numeric default 186, p_totals boolean default false)
returns jsonb language sql immutable as $$
  select jsonb_build_object('id', 'tbl', 'type', 'table', 'x', 12, 'y', p_y, 'w', p_w, 'h', p_h,
           'table', jsonb_build_object('fontSize', 9, 'rowHeight', 7, 'headerHeight', 8, 'headerBg', '#4f46e5', 'headerColor', '#ffffff',
                                       'striped', true, 'borders', true, 'showIndex', true, 'showTotals', p_totals, 'flow', true, 'borderColor', '#cbd5e1'))
$$;
create or replace function pg_temp.rtitle(p_w numeric default 186)
returns jsonb language sql immutable as $$
  select jsonb_build_array(
    jsonb_build_object('id', 'ttl', 'type', 'title', 'x', 12, 'y', 30, 'w', p_w, 'h', 14, 'text', '{report_title}', 'style', pg_temp.rstyle(20, true, '#312e81', 'center')),
    jsonb_build_object('id', 'sub', 'type', 'text',  'x', 12, 'y', 46, 'w', p_w, 'h', 8,  'text', '{scope_label} · {period_label} · إجمالي السجلات: {count}', 'style', pg_temp.rstyle(10, false, '#64748b', 'center')))
$$;
create or replace function pg_temp.rfields(variadic p_keys text[])
returns jsonb language sql immutable as $$
  select coalesce(jsonb_agg(jsonb_build_object('key', k)), '[]'::jsonb) from unnest(p_keys) k
$$;
create or replace function pg_temp.rquery(p_source text, p_church text, p_service text, p_class text, p_filters jsonb, p_fields jsonb, p_sort jsonb default '[]')
returns jsonb language sql immutable as $$
  select jsonb_build_object('source', p_source,
           'scope', jsonb_build_object('church', coalesce(p_church, ''), 'service', coalesce(p_service, ''), 'class', coalesce(p_class, '')),
           'filters', p_filters, 'fields', p_fields, 'rowFilters', '[]'::jsonb, 'sort', p_sort, 'limit', 5000)
$$;

insert into public.report_templates (id, church_id, service_id, class_id, name, description, source, definition, is_default, created_by, edited_by, created_at, edited_at) values
  -- shared by the owner: the classic class list
  ('fb000000-0000-4000-8000-000000000001', null, null, null, 'كشف المخدومين — أساسي', 'اسم · كود · هاتف · فصل · إجمالي الحضور والنقاط — يصلح لأي فصل', 'enrollments',
   jsonb_build_object('version', 1,
     'query', pg_temp.rquery('enrollments', null, null, null, '{"kind": "child", "status": "active"}', pg_temp.rfields('name', 'code', 'phone', 'class', 'attendance_total', 'points_total'), '[{"field": "name", "dir": "asc"}]'),
     'design', pg_temp.rdesign('كشف المخدومين', 'portrait', pg_temp.rtitle() || pg_temp.rtable(58, 220, 186, true))),
   true, 'a0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', now() - interval '60 days', now() - interval '60 days'),
  -- shared: attendance sheet with a chart
  ('fb000000-0000-4000-8000-000000000002', null, null, null, 'سجل الحضور — فترة', 'حضور فترة مع رسم بياني بالمناسبة', 'attendance',
   jsonb_build_object('version', 1,
     'query', pg_temp.rquery('attendance', null, null, null, '{"kind": "child"}', pg_temp.rfields('name', 'code', 'class', 'attended_on', 'event', 'points_delta'), '[{"field": "attended_on", "dir": "desc"}]'),
     'design', pg_temp.rdesign('سجل الحضور', 'landscape', pg_temp.rtitle(273)
       || jsonb_build_object('id', 'cht', 'type', 'chart', 'x', 12, 'y', 58, 'w', 273, 'h', 60,
            'chart', jsonb_build_object('kind', 'column', 'categoryField', 'event', 'valueField', '', 'aggregate', 'count', 'topN', 8, 'showLegend', false, 'showValues', true, 'title', 'الحضور بالمناسبة'))
       || pg_temp.rtable(124, 70, 273, false))),
   false, 'a0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', now() - interval '60 days', now() - interval '12 days'),
  -- church 1: points statement
  ('fb000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000001', null, null, 'كشف النقاط — كنيسة العذراء', 'كل حركة نقاط في الفترة (إضافة / خصم) بالسبب', 'points',
   jsonb_build_object('version', 1,
     'query', pg_temp.rquery('points', 'a1000000-0000-4000-8000-000000000001', null, null, '{"kind": "child", "pointsSign": ""}', pg_temp.rfields('name', 'code', 'class', 'at', 'delta', 'cause', 'sign'), '[{"field": "at", "dir": "desc"}]'),
     'design', pg_temp.rdesign('كشف النقاط', 'portrait', pg_temp.rtitle() || pg_temp.rtable(58, 220, 186, true))),
   false, 'a0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000002', now() - interval '30 days', now() - interval '30 days'),
  -- مدارس الأحد: follow-up (contacts) report
  ('fb000000-0000-4000-8000-000000000004', 'a1000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', null, 'تقرير الافتقاد — مدارس الأحد', 'مكالمات ورسائل الافتقاد ونتائجها', 'contacts',
   jsonb_build_object('version', 1,
     'query', pg_temp.rquery('contacts', 'a1000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', null, '{"kind": "child", "contactKind": ""}', pg_temp.rfields('name', 'class', 'contacted_on', 'kind', 'feedback', 'event', 'message'), '[{"field": "contacted_on", "dir": "desc"}]'),
     'design', pg_temp.rdesign('تقرير الافتقاد', 'landscape', pg_temp.rtitle(273) || pg_temp.rtable(58, 130, 273, false))),
   false, 'a0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000003', now() - interval '14 days', now() - interval '2 days'),
  -- إعدادي: exam results sheet (bound to the completed result exam)
  ('fb000000-0000-4000-8000-000000000005', 'a1000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000002', 'نتائج إعدادي — امتحان نصف العام', 'كشف النتائج بالترتيب والتقدير', 'exam_results',
   jsonb_build_object('version', 1,
     'query', pg_temp.rquery('exam_results', 'a1000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000002', '{"exam": "fa000000-0000-4000-8000-000000000001"}', pg_temp.rfields('rank', 'name', 'code', 'total_score', 'total_full', 'percent', 'grade', 'result'), '[{"field": "rank", "dir": "asc"}]'),
     'design', pg_temp.rdesign('نتائج امتحان نصف العام — إعدادي', 'portrait', pg_temp.rtitle() || pg_temp.rtable(58, 220, 186, false))),
   false, 'a0000000-0000-4000-8000-000000000004', 'a0000000-0000-4000-8000-000000000004', now() - interval '20 days', now() - interval '20 days'),
  -- church 1: servants directory
  ('fb000000-0000-4000-8000-000000000006', 'a1000000-0000-4000-8000-000000000001', null, null, 'دليل الخدام', 'الخدام المعتمدون بالدور والهاتف', 'servants',
   jsonb_build_object('version', 1,
     'query', pg_temp.rquery('servants', 'a1000000-0000-4000-8000-000000000001', null, null, '{"servantStatus": "approved", "role": ""}', pg_temp.rfields('name', 'code', 'phone', 'role', 'class', 'joined_at'), '[{"field": "role", "dir": "asc"}, {"field": "name", "dir": "asc"}]'),
     'design', pg_temp.rdesign('دليل الخدام', 'portrait', pg_temp.rtitle() || pg_temp.rtable(58, 220, 186, false))),
   false, 'a0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000002', now() - interval '7 days', now() - interval '7 days'),
  -- church 2
  ('fb000000-0000-4000-8000-000000000007', 'a1000000-0000-4000-8000-000000000002', null, null, 'كشف مارجرجس', 'كشف المخدومين — كنيسة مارجرجس', 'enrollments',
   jsonb_build_object('version', 1,
     'query', pg_temp.rquery('enrollments', 'a1000000-0000-4000-8000-000000000002', null, null, '{"kind": "child", "status": "active"}', pg_temp.rfields('name', 'code', 'phone', 'birthdate', 'age', 'attendance_total'), '[{"field": "name", "dir": "asc"}]'),
     'design', pg_temp.rdesign('كشف المخدومين — مارجرجس', 'portrait', pg_temp.rtitle() || pg_temp.rtable(58, 220, 186, false))),
   true, 'a0000000-0000-4000-8000-000000000006', 'a0000000-0000-4000-8000-000000000006', now() - interval '5 days', now() - interval '5 days');

-- ---------------------------------------------------------------------
-- 26. النسخ الاحتياطي (0044) — schedules (daily · weekly) + run history
--     (manual · scheduled · restore · one failed). Owner only.
-- ---------------------------------------------------------------------
do $$ begin perform pg_temp.act('a0000000-0000-4000-8000-000000000001'); end $$;

insert into public.backup_schedules (id, name, enabled, frequency, weekday, day_of_month, hour, tables, include_auth, keep_last, last_run_at, last_status, next_run_at, created_by, created_at, updated_at) values
  ('fc000000-0000-4000-8000-000000000001', 'نسخة أسبوعية كاملة', true, 'weekly', 0, 1, 3, null, true, 8,
   (date_trunc('week', now() at time zone 'Africa/Cairo') - interval '1 day' + interval '3 hours') at time zone 'Africa/Cairo', 'done',
   (date_trunc('week', now() at time zone 'Africa/Cairo') + interval '6 days' + interval '3 hours') at time zone 'Africa/Cairo',
   'a0000000-0000-4000-8000-000000000001', now() - interval '70 days', now() - interval '70 days'),
  ('fc000000-0000-4000-8000-000000000002', 'حضور ونقاط — يومياً', true, 'daily', 0, 1, 2, array['attendance_log', 'points_log', 'contact_log', 'enrollments', 'persons'], false, 14,
   (current_date::timestamp + interval '2 hours') at time zone 'Africa/Cairo', 'done',
   ((current_date + 1)::timestamp + interval '2 hours') at time zone 'Africa/Cairo',
   'a0000000-0000-4000-8000-000000000001', now() - interval '30 days', now() - interval '30 days'),
  ('fc000000-0000-4000-8000-000000000003', 'أرشيف شهري (موقوف)', false, 'monthly', 0, 1, 4, null, true, 12, null, null, null,
   'a0000000-0000-4000-8000-000000000001', now() - interval '10 days', now() - interval '3 days');

insert into public.backup_runs (id, kind, schedule_id, status, mode, tables, include_auth, row_counts, size_bytes, file_name, storage_path, error, created_by, created_at, finished_at) values
  ('fc100000-0000-4000-8000-000000000001', 'manual', null, 'done', null, array['persons', 'enrollments', 'attendance_log', 'points_log', 'servant_enrollments'], true,
   '{"persons": 34, "enrollments": 31, "attendance_log": 620, "points_log": 140, "servant_enrollments": 8}', 812345, 'backup_manual_' || to_char(now() - interval '15 days', 'YYYY-MM-DD') || '.json', null, null,
   'a0000000-0000-4000-8000-000000000001', now() - interval '15 days', now() - interval '15 days' + interval '14 seconds'),
  ('fc100000-0000-4000-8000-000000000002', 'scheduled', 'fc000000-0000-4000-8000-000000000001', 'done', null, '{}', true,
   '{"persons": 34, "enrollments": 31, "attendance_log": 640, "points_log": 150, "chat_messages": 13, "notifications": 6}', 2231456, 'backup_weekly_' || to_char(now() - interval '8 days', 'YYYY-MM-DD') || '.json', 'scheduled/fc000000-0000-4000-8000-000000000001/' || to_char(now() - interval '8 days', 'YYYY-MM-DD') || '.json', null,
   null, now() - interval '8 days', now() - interval '8 days' + interval '21 seconds'),
  ('fc100000-0000-4000-8000-000000000003', 'scheduled', 'fc000000-0000-4000-8000-000000000001', 'done', null, '{}', true,
   '{"persons": 34, "enrollments": 31, "attendance_log": 700, "points_log": 165, "chat_messages": 13, "notifications": 6}', 2298771, 'backup_weekly_' || to_char(now() - interval '1 day', 'YYYY-MM-DD') || '.json', 'scheduled/fc000000-0000-4000-8000-000000000001/' || to_char(now() - interval '1 day', 'YYYY-MM-DD') || '.json', null,
   null, now() - interval '1 day', now() - interval '1 day' + interval '23 seconds'),
  ('fc100000-0000-4000-8000-000000000004', 'scheduled', 'fc000000-0000-4000-8000-000000000002', 'done', null, array['attendance_log', 'points_log', 'contact_log', 'enrollments', 'persons'], false,
   '{"attendance_log": 700, "points_log": 165, "contact_log": 9, "enrollments": 31, "persons": 34}', 401200, 'backup_daily_' || to_char(current_date, 'YYYY-MM-DD') || '.json', 'scheduled/fc000000-0000-4000-8000-000000000002/' || to_char(current_date, 'YYYY-MM-DD') || '.json', null,
   null, current_date::timestamp + interval '2 hours', current_date::timestamp + interval '2 hours 9 seconds'),
  ('fc100000-0000-4000-8000-000000000005', 'scheduled', 'fc000000-0000-4000-8000-000000000002', 'failed', null, array['attendance_log', 'points_log', 'contact_log', 'enrollments', 'persons'], false,
   '{}', null, null, null, 'StorageApiError: The object exceeded the maximum allowed size', null, now() - interval '3 days', now() - interval '3 days' + interval '6 seconds'),
  ('fc100000-0000-4000-8000-000000000006', 'restore', null, 'done', 'merge', array['card_templates', 'birthday_card_templates'], false,
   '{"card_templates": 2, "birthday_card_templates": 2}', 45120, 'backup_manual_' || to_char(now() - interval '15 days', 'YYYY-MM-DD') || '.json', null, null,
   'a0000000-0000-4000-8000-000000000001', now() - interval '12 days', now() - interval '12 days' + interval '4 seconds');

-- ---------------------------------------------------------------------
-- 27. سجل النشاط (0047) — the audit trigger already logged every row
--     written above (actor = the servant set through pg_temp.act). Add
--     the APP-LEVEL events the trigger cannot see: logins · scans ·
--     exports · prints · a failed login · a child login (portal).
--     Spread over the last days so the feed / by-day chart look real.
-- ---------------------------------------------------------------------
create or replace function pg_temp.ev(p_actor uuid, p_action text, p_when timestamptz, p_meta jsonb default '{}', p_person uuid default null, p_enrollment uuid default null)
returns void language plpgsql as $$
declare v_id uuid;
begin
  perform pg_temp.act(p_actor);
  v_id := public.log_activity(p_action, p_person, p_enrollment, p_meta);
  update public.activity_log set created_at = p_when where id = v_id;
end $$;

do $$
declare d int; s uuid; srv uuid[] := array['a0000000-0000-4000-8000-000000000002','a0000000-0000-4000-8000-000000000003','a0000000-0000-4000-8000-000000000004','a0000000-0000-4000-8000-000000000005','a0000000-0000-4000-8000-000000000006']::uuid[];
begin
  -- daily logins / logouts for the last 10 days
  for d in reverse 10..0 loop
    foreach s in array srv loop
      if (d + right(s::text, 1)::int) % 3 <> 0 then
        perform pg_temp.ev(s, 'auth.login',  (current_date - d)::timestamp + time '09:30' + (right(s::text, 1)::int * interval '7 minutes'), jsonb_build_object('device', case when right(s::text, 1)::int % 2 = 0 then 'android' else 'ios' end, 'pwa', true));
        perform pg_temp.ev(s, 'auth.logout', (current_date - d)::timestamp + time '13:10' + (right(s::text, 1)::int * interval '5 minutes'));
      end if;
    end loop;
  end loop;
  -- the owner logged in today
  perform pg_temp.ev('a0000000-0000-4000-8000-000000000001', 'auth.login', now() - interval '3 hours', '{"device": "desktop", "pwa": false}');
  -- QR scans during today's contest (scanner page)
  perform pg_temp.ev('a0000000-0000-4000-8000-000000000005', 'scan.qr', now() - interval '2 hours 5 minutes', '{"result": "attendance", "event": "مسابقة الكتاب المقدس"}', 'b1000000-0000-4000-8000-000000000001', 'b2000000-0000-4000-8000-000000000001');
  perform pg_temp.ev('a0000000-0000-4000-8000-000000000005', 'scan.qr', now() - interval '2 hours 1 minute', '{"result": "attendance", "event": "مسابقة الكتاب المقدس"}', 'b1000000-0000-4000-8000-000000000002', 'b2000000-0000-4000-8000-000000000002');
  perform pg_temp.ev('a0000000-0000-4000-8000-000000000004', 'scan.qr', now() - interval '1 hour 40 minutes', '{"result": "unknown_code", "code": "30101010199999"}');
  -- exports / prints
  perform pg_temp.ev('a0000000-0000-4000-8000-000000000003', 'export.excel', now() - interval '4 hours 40 minutes', '{"page": "stats", "rows": 27, "scope": "مدارس الأحد"}');
  perform pg_temp.ev('a0000000-0000-4000-8000-000000000005', 'print.cards', now() - interval '1 day 2 hours', '{"template": "كارت الكنيسة — أزرق", "count": 7, "profile": "مدارس الأحد — ورق لاصق A4"}');
  perform pg_temp.ev('a0000000-0000-4000-8000-000000000004', 'report.export', now() - interval '20 hours', '{"template": "نتائج إعدادي — امتحان نصف العام", "format": "pdf", "rows": 8}');
  perform pg_temp.ev('a0000000-0000-4000-8000-000000000001', 'backup.download', now() - interval '15 days' + interval '20 seconds', '{"file": "backup_manual.json", "size_bytes": 812345}');
  -- a wrong-password attempt on the servant login page (anonymous → system actor)
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', 'anon', true);
  perform public.log_activity('auth.login_failed', null, null, '{"login": "10000000000004", "reason": "wrong_password"}');
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform pg_temp.act('a0000000-0000-4000-8000-000000000001');
end $$;

-- child portal events (actor = the child): the trigger on child_sessions
-- already wrote auth.child_login for the 4 sessions above; add a few portal
-- actions through the same path the app uses (session token → person).
do $$ begin
  perform set_config('request.jwt.claim.sub', '', true);
  perform public.child_portal_log_activity('seed-token-01', 'portal.view_points', '{"page": "points"}');
  perform public.child_portal_log_activity('seed-token-09', 'portal.exam_start', '{"exam": "مسابقة سفر التكوين"}');
  perform public.child_portal_log_activity('seed-token-13', 'portal.message_sent', '{"to": "جورج فايز"}');
  perform pg_temp.act('a0000000-0000-4000-8000-000000000001');
end $$;

-- ---------------------------------------------------------------------
-- 28. Summary
-- ---------------------------------------------------------------------
set local client_min_messages = notice;
-- ---------------------------------------------------------------------
do $$
declare r record; msg text := E'\n=== SEED COMPLETE — بيانات تجريبية ===\n';
begin
  for r in
    select t, c from (values
      ('churches', (select count(*) from public.churches)), ('services', (select count(*) from public.services)), ('classes', (select count(*) from public.classes)),
      ('servant_enrollments', (select count(*) from public.servant_enrollments)), ('persons', (select count(*) from public.persons)), ('enrollments', (select count(*) from public.enrollments)),
      ('events', (select count(*) from public.events)), ('attendance_log', (select count(*) from public.attendance_log)), ('points_log', (select count(*) from public.points_log)),
      ('contact_log', (select count(*) from public.contact_log)), ('user_achievements', (select count(*) from public.user_achievements)),
      ('store_orders', (select count(*) from public.store_orders)), ('exam_attempts', (select count(*) from public.exam_attempts)), ('birthday_greetings', (select count(*) from public.birthday_greetings)),
      ('chat_messages', (select count(*) from public.chat_messages)), ('online_classes', (select count(*) from public.online_classes)), ('occasion_registrations', (select count(*) from public.occasion_registrations)),
      ('notifications', (select count(*) from public.notifications)), ('notification_recipients', (select count(*) from public.notification_recipients)),
      ('exam_results', (select count(*) from public.exam_results)), ('library_books', (select count(*) from public.library_books)), ('library_lectures', (select count(*) from public.library_lectures)),
      ('servant_scopes', (select count(*) from public.servant_scopes)), ('enrollments (servant mirrors)', (select count(*) from public.enrollments where kind = 'servant')),
      ('enrollments (stopped)', (select count(*) from public.enrollments where status = 'stopped')),
      ('person_credentials', (select count(*) from public.person_credentials)), ('child_sessions', (select count(*) from public.child_sessions)), ('child_join_requests', (select count(*) from public.child_join_requests)),
      ('card_print_profiles', (select count(*) from public.card_print_profiles)), ('report_templates', (select count(*) from public.report_templates)),
      ('backup_schedules', (select count(*) from public.backup_schedules)), ('backup_runs', (select count(*) from public.backup_runs)),
      ('activity_log', (select count(*) from public.activity_log)), ('app_settings', (select count(*) from public.app_settings))
    ) v(t, c)
  loop
    msg := msg || format('  %-30s %s', r.t, r.c) || E'\n';
  end loop;
  msg := msg || E'\nLogin: code 10000000000001 (owner) … 10000000000006 — password Test@1234 (08 = suspended, 07 = pending)\nChild portal: code + password — e.g. 30101010100001 / 123456 (30101010100005 / 000000 default · 30101010100021 stopped)\n';
  raise notice '%', msg;
end $$;

commit;


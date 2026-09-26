# إدارة الإيبارشية — Diocese Management PWA

## Project Overview
- **Name**: Diocese Management (إدارة الإيبارشية)
- **Goal**: Multi-tenant PWA to manage a diocese: churches → services → classes → children, with role-based access, attendance scanning and points.
- **Stack**: Next.js 14 (App Router) + TypeScript + Tailwind CSS + Lucide icons + Supabase (Auth, Postgres + RLS, Realtime, Storage)
- **Language/Direction**: Arabic, RTL
- **Deployment target**: Vercel (frontend) + Supabase (backend)

## URLs
- **GitHub**: https://github.com/stmaryluxorprim-hash/luxor-diocese-management-app
- **Sandbox preview (temporary)**: https://3000-iasoiimzq7wdii4b7vorc-583b4d74.sandbox.novita.ai
- **Production**: (deploy to Vercel — see below)

## Architecture — PERSON-CENTRIC (migration 0011)
The app is built on **persons**. Every person has one identity row; he can be
bound to many churches / services / classes through **enrollments**.

```
persons (الأشخاص — identity table)
  id (db id) · national_id (= QR code, unique) · name · birthdate
  gender (male/female) · phone · address · notes · image_url

enrollments (التسجيلات — person bound to a place)
  person_id → persons
  church_id → churches      (كنيسة)
  service_id → services     (خدمة — e.g. مدارس الأحد)
  class_id → classes        (فصل)
  attendance_count · points  (per-enrollment counters)
```

**One person → many enrollments.** Adding a person in any module (e.g. Sunday
school) sends his data to `persons` (upsert by `national_id`), then registers
him as an enrollment in that church + service + class — both steps are done by
the `add_person_and_enroll` RPC. Attendance (scanner / children page) resolves
the scanned **national id → person → enrollment** and logs against the
enrollment (`attendance`, `attendance_log`, `points_log` all use
`enrollment_id`).

### Scope hierarchy — church → service → class → **event** (migration 0022)
The **event (المناسبة)** is the 4th level of the scope hierarchy. On the
children page and the scanner the control panel has **four scope selectors**
(كنيسة · خدمة · فصل · مناسبة) and every operation is bound to the selected
event:
- **الحضور** — attendance is registered *for this event* (`attendance_log.event_id`).
- **النقاط** — points are given *in this event* (`points_log.event_id`, new in 0022;
  the manual points modal on the scanner too). A DB trigger rejects an event
  whose scope doesn't cover the enrollment.
- **مكالمة** — a call is a *follow-up for this event* (`contact_log`, kind `call`).
- **رسالة** — WhatsApp / SMS / internal messages are logged *in relation to this
  event* (`contact_log`, kind `whatsapp | sms | internal`, with the message text).
  The template supports `[اسم المناسبة]`.

In the settings hub **إدارة المناسبات** sits directly after **إدارة الفصول**.

### Roles (multi-tenant, enforced by RLS at DB level)
| Role | Scope |
|---|---|
| مالك التطبيق `owner` | everything |
| مدير كنيسة `church_manager` | own church |
| مسؤول خدمة `service_manager` | own service |
| خادم فصل `class_servant` | own class |

### Servants architecture — تسجيلات الخدام (migration 0037)
The servant is a **person first** (same `persons` table as the children —
his **code = `national_id` = QR**) and is then registered as a **servant
enrollment** (`servant_enrollments`, formerly `profiles`) bound to
church → service → class — exactly like a child's `enrollments` row.

```
persons (الأشخاص)                      servant_enrollments (تسجيلات الخدام)
  id · national_id (code / QR)   ◀──── person_id
  name · gender · birthdate            id = auth.users.id (login account)
  phone · address · notes              user_id = login name derived from the code
  image_url                            role · status · church_id · service_id · class_id
                                       full_name · phone · photo_url (mirrors, kept in sync by triggers)

permission_profiles (ملفات الصلاحيات)  permissions (الصلاحيات)
  name · color · permissions text[]  ◀── permission_profile_id
  (owner-made, /owner/permissions)       servant_id → servant_enrollments
```

**Signup (`/signup`, 4 steps):**
1. **مكان الخدمة** — church → service → class (pre-filled & locked from the invite link; each level optional, the approver can set it).
2. **الكود** — typed, **scanned (QR camera)** or generated. `signup_lookup_code` tells whether the code already belongs to a person (→ data pre-filled) or to an account (→ blocked).
3. **البيانات** — full name · gender · phone (`+2` + 11 digits) · birthdate (day/month/year) · address · notes · optional photo — **same rules as adding a child**.
4. **كلمة المرور** + confirmation.
→ `auth.signUp` (login name = the code, `code@diocese.app`) → RPC **`servant_signup`** upserts the person by code (fill-blanks only) and creates the **pending** servant enrollment. Login (`/login`) is **code + password**.

**Approval:** owner / church manager / service manager approves from **إدارة الخدام (`/servants`) → طلبات الانضمام** (sees the person data), assigns role + scope and may attach **permission profiles** right away. Realtime — the waiting servant is let in instantly.

**Permissions:** the owner builds **ملفات الصلاحيات** in the owner module (`/owner/permissions`) from the permission registry (`src/lib/permissions.ts` — keys like `children.attendance`, `servants.approve`…). Managers connect servants to profiles from **إدارة الخدام (`/servants`) → الخدام → الصلاحيات** (within their level; `can_manage_servant`). `my_permissions()` / `has_permission(key)` in SQL, `usePermissions().has(key)` in the app; the owner has everything. Realtime on both tables. **Activity items** (المناسبات · الأسباب · نتائج الافتقاد · طلبات البيانات) use fine keys `activity.<item>.<action>` resolved by `activity_item_can(key)` in SQL and `usePermissions().activityCan(item, action)` in the app — see § Activity item permissions.

**Compatibility:** `public.profiles` is now a `security_invoker` **view** over `servant_enrollments`, so every older function / policy / query keeps working; the app reads `servant_enrollments` directly. Audit FKs (`created_by`, `recorded_by`…) became `ON DELETE SET NULL` so deleting a servant never fails. `supabase/tests/servants_permissions_test.sql` covers the flow.

**إدارة الخدام module page (`/servants`)** — the servant pages live in ONE page with tabs: **الخدام** (manage + permissions, with an «إضافة» button) · **إضافة** (add servants directly — see below) · **الطلبات** (badge with the pending count) · **دعوة (QR)** (scoped invite link + QR). The old `/settings/servants|approvals|invite` paths redirect there.

### Add servants directly — إضافة خدام فردي / جماعي (migration 0041)
Besides the signup wizard, a manager can now **add servants himself** from **إدارة الخدام → إضافة** (`/servants?tab=add`). The servant is **approved immediately** and logs in with **code + password** — no join request.

- **إضافة فردية** — one form in 4 blocks: ١ الدور ومكان الخدمة (roles / scope locked to the approver's level exactly like the approval flow) · ٢ الكود (typed · **scanned QR** · **generated** by نظام الأكواد, live check via `admin_servant_code_lookup` — a code already bound to an account is refused, a code that belongs to a **person** offers «تعبئة بياناته») · ٣ البيانات (name · gender · phone · birthdate · address · notes · photo — same rules as a child) · ٤ كلمة المرور (generated 8-char password, editable) + **ملفات الصلاحيات**. On success a green card shows the credentials **once** with «نسخ».
- **إضافة جماعية** — same UX as bulk children: Excel / paste → column mapping (الاسم · الكود · كلمة المرور · النوع · الهاتف · الميلاد · العنوان · ملاحظات — only the name is required) → options (default gender, **auto codes**, **auto passwords**, date order, permission profiles for all rows) → live preview (per-row gender toggle, validation flags) → import in chunks of 25 with a progress bar → **تصدير بيانات الدخول (Excel)** — a sheet with name · code · password to hand out.
- **Bulk import is forgiving (children + servants)** — nothing stops mid-way and no row is lost to a single bad cell: **تعديل الصف** (pencil / tap the name) opens `src/components/BulkRowEditModal.tsx` where EVERY value (name · gender · code · password · birthdate · phone · address · notes · points) can be corrected or cleared before the import; an **invalid phone** or an **unparsed birthdate** is highlighted in the preview (tap to fix) and otherwise the row is saved **without that value** (never the whole child / servant); a **duplicated code** (repeated in the file — first row wins — or already taken / already enrolled in the DB) is **skipped**, not errored. After the run a summary lists: added · **لم يُضف** (skipped, with the reason) · failed · added-with-note. Shared helpers `findRepeatedCodes` / `phoneToLocalDigits` / `BulkRowEdits` / `BulkRowStatus` in `src/lib/bulk-import.ts`. The final preview shows **every** row (no 100-row cap) so the whole file can be reviewed before the import.
- **Every management page is a church → service → class tree** (`src/components/ScopeGroups.tsx`) — the same organized look as إدارة المخدومين / إدارة الخدام, now also on: **إدارة الخدمات** (grouped by church), **إدارة الفصول** (church → service), **إدارة المناسبات**, **إدارة أسباب النقاط**, **إدارة نتائج الافتقاد**, **قوالب الكروت**, **طلبات انضمام المخدومين** (pending + history) and **طلبات انضمام الخدام**. `ScopeGroupFilters` = search + كنيسة → خدمة → فصل selects (the church select is hidden when there is one church; levels below the records' own level are hidden via `deepest`); `ScopeGroups` = collapsible headers with counts. A record bound to a whole church / service (`service_id` / `class_id` null) sits directly under that node in a **«على مستوى الكنيسة (كل الخدمات)»** bucket instead of a fake class; a single church for the whole list skips the church header. `useScopeGroups(rows, matches?)` gives scope + search state and the filtered rows (`filterByScope` keeps wide-scope records when a narrower filter is chosen). `itemName={null}` keeps the caller's order (manual `sort_order` of call feedbacks, newest-first requests).
- **How it works** — the browser calls **`POST /api/servants/create`** (`src/app/api/servants/create/route.ts`) with `{ items: AddServantInput[] }`. The route reads the caller's session, requires an approved owner / church manager / service manager, then per item: `auth.admin.createUser` (login = the code, e-mail confirmed) → RPC **`admin_add_servant(actor, account, …)`** (SECURITY DEFINER, **service_role only**) which re-validates the actor's role + scope, upserts the person by code (typed data wins, blanks keep old values), inserts the **approved** `servant_enrollments` row (`approved_by` = actor) and grants the profiles. If the RPC fails the auth account is deleted again (no orphans). One outcome per item, so a bad row never stops a batch. Needs **`SUPABASE_SERVICE_ROLE_KEY`** on the server (already required by the notifications dispatcher) — without it the route answers 503 and the UI explains.
- Permission key `servants.add`; shared parsing helpers moved to `src/lib/bulk-import.ts` (used by both children and servants bulk import). Test: `supabase/tests/admin_add_servants_test.sql`.

### Child accounts, unified login & servant mirror — حسابات المخدومين (migration 0042)
`supabase/migrations/0042_child_accounts_servant_mirror.sql` · test `supabase/tests/child_accounts_test.sql`

**Unified login (`/login`)** — one page with a **دخول الخادم | دخول المخدوم** switch (`?as=child` pre-selects the child tab). Both entries: the **code** (typed, or **scanned** with the camera / picked from the gallery via `QrScanner`), the **password**, a **«تذكرني»** switch, «تسجيل الدخول» and «إنشاء حساب» (→ `/signup` for servants, `/child/signup` for children).
- Servant → Supabase Auth as before (`code@diocese.app`). «تذكرني» off = tab-only session: `src/lib/session.ts` keeps a sessionStorage marker and `AuthProvider` signs out on the next cold start.
- Child → RPC **`child_login(code, password, remember)`** → a random **session token** (sha256-hashed in `child_sessions`, 12 h or 90 d with «تذكرني»). The token — never the raw code — is what every `child_portal_*` RPC now receives (`child_portal_person` resolves it; expired → `session_expired`). `child_session_touch` validates/extends on boot & tab focus, `child_logout` deletes the session, `child_change_password` (Options → الحساب) kills the other sessions. `/child/login` just redirects to `/login?as=child`.
- Passwords live in **`person_credentials`** (bcrypt via pgcrypto), never readable by any client role.

**Child signup (`/child/signup`)** — same 4-step wizard as the servants (الفصل — required, locked from an invite link → الكود typed/scanned/generated with a live `child_signup_lookup_code` check → البيانات + photo → كلمة المرور). Submit → RPC **`child_signup`** creates a **pending `child_join_requests` row** (password hash stored, hidden by column-level grants). The page then polls `child_signup_status` and offers the login button once approved (request id kept in localStorage so the child can come back).

**إدارة المخدومين (`/children/manage`)** — new Settings link (الإدارة for managers, النشاط for class servants; badge = pending child requests via `pending_child_join_requests_count`). Tabs mirror إدارة الخدام:
- **إضافة** — the former `/children/add` (single + bulk) moved here (`src/components/children/AddChildrenPanel.tsx`; the old URL redirects). Both forms gained an optional **كلمة مرور البوابة** (`add_person_and_enroll … p_password`, result carries `has_password`; for an existing person it is set only if he has none yet).
- **الطلبات** — `ChildRequestsPanel`: pending signups (scoped by RLS to whoever can access the requested class) with correctable church/service/class → RPC **`review_child_join_request(approve, note, scope)`**: approve = upsert person by code + enrollment + credentials; reject = note shown to the child. A **السجل** view lists decided requests.
- **دعوة (QR)** — `ChildInvitePanel`: scoped link/QR to `/child/signup?church=…&service=…&class=…`.
- The **«إضافة»** button left the children page (an empty class now links to «إدارة المخدومين»).

**Servants as classes on the children page** — `enrollments.kind` (`'child' | 'servant'`) + `servant_id`. Trigger `sync_servant_mirror_enrollment` keeps **one mirror enrollment per approved/suspended servant with a full scope** (created / moved / removed as his `servant_enrollments` row changes; re-reads the live row so `auto_person_for_servant`'s nested update can't leave a stale NEW). The children page has a **المخدومين | الخدام** switch (`fetchEnrollmentsPage(…, { kind })`) — servants are grouped by class with **every job** (attendance, points, call, message, data, card printing, achievements…). Everything that enumerates a scope (stats `p_kind` default `'child'` — pass `'servant'` / `'all'`, dashboard counts, leaderboard, birthdays, chat/notification audiences, exam candidates, online-class eligibility) counts **children only**, so mirrors never inflate numbers. Deleting a servant mirror from البيانات is refused (managed from إدارة الخدام).

**Password reset & code edit** — `ResetPasswordSection` (generate / show / confirm):
- Child (EditPersonModal) → RPC **`admin_set_child_password`** (owner / whoever can access the person; closes all his sessions).
- Servant (EditPersonModal on a mirror row, and **إدارة الخدام → تعديل**) → **`POST /api/servants/account`** (`src/app/api/servants/account/route.ts`, service role): `reset_password` → `auth.admin.updateUserById`; `change_code` → new login e-mail + `servant_enrollments.user_id` + `persons.national_id` (uniqueness checked). Scope rule = who may edit the servant; a servant may reset **his own** password. The servant edit modal now has the same **confirmed code-edit flow** as children (`EditCodeModal` with `codeKind="servant"`), and «تعديل بياناتي» in Settings has **تغيير كلمة المرور** (`supabase.auth.updateUser`).

### Stop (إيقاف) · إدارة المخدومين → المخدومين · default password — migration 0043
`supabase/migrations/0043_stop_enrollments_default_password.sql` · test `supabase/tests/stop_default_password_test.sql`

**The children page and the scanner only VIEW data now.** The «البيانات» job kept «عرض» only; the «تعديل» and «حذف» modes are gone and a «تعديل · حذف · إيقاف» shortcut leads to the new tab.

**إدارة المخدومين → المخدومين** (`/children/manage`, default tab, `?tab=people`) — `src/components/children/ManagePeoplePanel.tsx` — the ONE place to **edit · move · stop · delete CHILDREN**. Servants are managed in their twin, **إدارة الخدام → الخدام** (`src/components/servants/ServantsPanel.tsx`). Both are built from the SAME shared pieces in **`src/components/ScopeTree.tsx`** so the two pages look and behave alike:
- **`ScopeFilters`** — search · **كنيسة → خدمة → فصل** selects · **الكل / يعمل / موقوف** tabs (with counters).
- **`buildScopeTree` + `ScopeTreeView`** — the list is ALWAYS grouped **الكنيسة → الخدمة → الفصل** (nested, collapsible sticky headers; each header shows a count and a **⏸ إيقاف الكل / ▶ تفعيل الكل** button for THAT church / service / class). The old «ترتيب حسب» toolbar (`ScopeOrganizer`) is gone.
- **`PersonCard`** — one card per person + the action row. Children: **تعديل · إيقاف/تفعيل · حذف**. Servants: **تعديل · الصلاحيات · إيقاف/تفعيل · حذف** (scoped by `canManageServant`; «هذا حسابك» / «خارج نطاق إدارتك» otherwise).
- **`BulkScopeStatusCard`** — «إيقاف / تفعيل نطاق كامل»: pick a **church**, a **service** or a **class** → RPC **`set_enrollments_status(status, church → service → class, kind)`** (`kind = 'child'` on the children page, `'servant'` on the servants page; SECURITY DEFINER, `can_access` on the scope; servants are suspended / re-approved through `can_manage_servant`).
- **تعديل المخدوم** (`EditPersonModal`) now has the **same form as تعديل الخادم** (code with confirmed edit · name · ذكر/أنثى · phone with `+2` prefix · birthdate · address · notes · **الكنيسة → الخدمة → الفصل** · photo · reset password). Changing the scope **moves THIS enrollment** (`enrollments.church_id/service_id/class_id` — attendance and points follow; the `(person_id, class_id)` unique key refuses a class he is already in). The servant modal already had the scope selects (church locked for non-owners, service locked for service managers).
- Per child: **حذف** → `DeletePersonModal` (this enrollment or the whole person). Per servant: delete the account (`servant_enrollments`).
- The children page's **المخدومين | الخدام** switch is unchanged; the management page has no such switch any more, and the «المخدومين» shortcut button next to its title was removed. The «إضافة» button next to the servants search is gone too (the **إضافة** tab does it).

**What «موقوف» means** — `enrollments.status` (`active` | `stopped`): data, enrollments and history stay; a BEFORE INSERT guard on `attendance_log` / `points_log` raises `enrollment_stopped` (children page + scanner show "موقوف، لا يمكن…"); `child_login` / `child_session_touch` raise `account_stopped` while every child enrollment of the person is stopped; the children page greys the card out with a «موقوف» badge and disables attendance / points / card / achievements (view, call and message keep working). A suspended servant's mirror row is `stopped` automatically (`sync_servant_mirror_enrollment`).

**Passwords**
- **Default password = `000000`** (`default_password()` in SQL, `DEFAULT_PASSWORD` in `src/lib/types.ts`). A child who never had a password logs in with it (`child_login` returns `default_password: true`); the add-child forms say so when the field is empty. New servant accounts default to it in **إدارة الخدام → إضافة** (single: prefilled, editable / generate; bulk: «الافتراضية 000000 | عشوائية»).
- **A servant changes HIS OWN password** from **الإعدادات → تعديل بياتي → تغيير كلمة المرور** with **old + new + confirm** (`ResetPasswordSection requireCurrent` — the old one is verified by re-signing-in, then `auth.updateUser`).
- **A superior resets without the old password** — **إدارة الخدام → تعديل** / **إدارة المخدومين → المخدومين → تعديل** → «إعادة تعيين كلمة المرور» (new only: generate · **الافتراضية 000000** · typed). `POST /api/servants/account` now **refuses self** (`canManage` returns false for `actor.id === target.id`), so only owner / church manager / service manager within scope can do it. Children: `admin_set_child_password` as before; `child_change_password` accepts `000000` as the old one while no password was ever set.
- `lookup_enrollments_by_national_id` (scanner) now returns `kind`, `servant_id`, `status`.

### Backup & Restore — النسخ الاحتياطي والاسترجاع — migration 0044
`supabase/migrations/0044_backup_restore.sql` + `20260922120000_backup_restore_fk_order.sql` (FK cycles / deferred references) · tests `supabase/tests/backup_restore_test.sql` · `backup_restore_e2e_test.sql` (after the seed) · **الإعدادات → النشاط → النسخ الاحتياطي والاسترجاع** (`/settings/backup`, **owner only**).

**Backup (نسخة احتياطية)** — the button asks **what to back up**: `TableSelector` lists **every public table of the database** (read live from `pg_class` by `backup_tables()`, so new tables are picked up automatically) grouped in Arabic — الهيكل · الأشخاص والتسجيلات · الخدام والصلاحيات · الحضور والنقاط والافتقاد · الرسائل والإشعارات · الوحدات · الكروت · الإعدادات — with row counts, per-group toggles and **«الكل»** (default). **حسابات دخول الخدام** (`auth.users` of the servants: id · e-mail · **bcrypt hash** · metadata, via `backup_dump_auth_users()`) is a pseudo-row so passwords survive a restore. Rows are pulled page by page (`backup_dump_table(t, offset, limit)`, PK order) and the result is **one JSON file downloaded to the device** (`dma-backup_manual_<date>.json`, format `dma-backup` v1: `tables{name:{columns,rows}}`, `auth_users`, `counts`). A row is written to `backup_runs`.

**Restore (استرجاع)** — pick the file from the device → parsed & validated → asks **what to restore** (the tables IN the file, «الكل» default; tables unknown to the DB are flagged and skipped) and the **mode**: **دمج** (upsert by primary key, nothing deleted) or **استبدال** (additionally deletes the rows the backup does not contain — type «استبدال» to confirm). Engine (`src/lib/backup.ts → restoreBackup`): **login accounts first** (`POST /api/backup/auth-restore` — `servant_enrollments.id → auth.users`) → `backup_restore_begin(mode, tables, meta)` creates a staging job (tables re-ordered **parents first** from the FK graph, `backup_topo_order` — **cycle-aware**: `persons ⇄ servant_enrollments` is handled by deferring the nullable side) → chunks of 500 rows are staged (`backup_restore_stage`) → replace mode runs `backup_restore_delete_missing` **children first** → `backup_restore_apply_chunk` upserts each chunk with the **user triggers disabled** (counters / mirrors / guards do not fire on restored history) using only the columns that exist both in the file and in the table; a **nullable FK whose parent row is not there yet is written as NULL and remembered** (`backup_restore_fixups`), a row whose login account is missing is skipped and reported → **`backup_restore_fixup`** re-attaches the deferred references → `backup_restore_finish`. Login accounts go through **`POST /api/backup/auth-restore`** (service role: `auth.admin.createUser({ id, email, password_hash })` / `updateUserById`). Progress bar per phase; result per table (upserted / deleted / deferred → resolved / unresolved / skipped) — anything left NULL is listed as a warning and the run is marked `partial`.

**Scheduled backups (نسخ مجدولة)** — `backup_schedules`: name · **يوميًا / أسبوعيًا (يوم) / شهريًا (يوم الشهر)** · hour (Africa/Cairo) · الكل or a selection (+ login accounts) · keep last N. `next_run_at` is computed by trigger (`backup_next_run`). **`GET /api/backup/cron`** (Vercel Cron **daily** at 02:30 UTC — the Hobby plan **refuses to deploy** crons more frequent than once a day; a due schedule runs at the first tick after its `next_run_at`; `vercel.json`; `CRON_SECRET` optional) runs `backup_schedules_due()`, exports with the service role, stores the file in the **private bucket `backups/<schedule>/<file>.json`**, prunes to `keep_last`, stamps the schedule (`backup_schedule_ran`). **تشغيل الآن** = `POST /api/backup/cron {schedule_id}`. The history (**السجل**, `backup_runs`, realtime) lists manual / scheduled / restore runs with status, counts, size; scheduled files have a **⬇ download-to-device** button (`GET /api/backup/file?run=<id>`) and can be deleted (`DELETE`).

Server helpers live in `src/lib/server/backup-admin.ts` (`requireOwner`, `runSchedule`, `restoreAuthUsers`). Everything needs `SUPABASE_SERVICE_ROLE_KEY` only for the scheduled/auth parts — the manual backup & table restore run entirely from the browser through the owner-checked security-definer RPCs (`backup_allowed()` = owner or service role).

### إدارة الأفراد — owner persons management — migration 20260923120000
`supabase/migrations/20260923120000_owner_persons_management.sql` · test `supabase/tests/owner_persons_test.sql` · **وحدة المالك → إدارة الأفراد** (`/owner/persons`, **owner only**).

ONE page with **every person in the system** (the `persons` table — children **and** servants) together with **all his data and all his enrollments**:
- **Card per person**: photo · name · مخدوم / خادم (role) · gender · age · code (tap to copy) · phone · every enrollment (كنيسة ← خدمة ← فصل · موقوف · كخادم · حضور · نقاط) · expandable details (birthdate, address, notes, portal-password state, added / edited dates, totals, the servant account with its places).
- **Filters (server-side)**: search (name / phone / code) · الكل / مخدومون / خدام · **كنيسة → خدمة → فصل** (persons with ≥ 1 enrollment inside the scope) · **بدون تسجيلات** (persons in **no** enrollment at all) · النوع. Header counters (الكل · مخدومون · خدام · بدون تسجيل) double as quick filters. Paginated (100 / page, `total_count`).
- **Per person**: **تعديل** (shared `EditPersonModal` — data applies to all enrollments) · **الفصول** (`PersonClassesModal` with `allowLast` — add to more classes / remove any, even the last one) · **حذف** (cascade).
- **Multi-select**: per card, «تحديد الصفحة», «تحديد كل النتائج» (bounded 5000). A dark **bulk bar** above the taskbar offers **إضافة إلى فصول** (ScopePicker, many classes at once) · **حذف من نطاق** (church / service / class — child rows only) · **حذف نهائي** (cascade; ≥ 5 persons require typing «حذف»; servant accounts are skipped and must be deleted from إدارة الخدام).
- **RPCs (all `security definer`, owner-checked)**: `owner_persons_page(search, scope_mode all|scope|none, church, service, class, gender, kind all|child|servant, limit, offset)` → rows with `enrollments` / `servant` jsonb + `has_password` + `total_count` · `owner_persons_counts()` · `owner_bulk_enroll(person_ids, scopes jsonb)` (skips existing `(person, class)` pairs; validates class ∈ service ∈ church) · `owner_bulk_unenroll(person_ids, church, service, class)` · `owner_bulk_delete_persons(person_ids)`. Realtime on `persons` · `enrollments` · `servant_enrollments`. Client: `src/lib/owner-persons.ts`, `src/components/owner/*`.

### One person → many places — نطاقات متعددة للخادم · فصول متعددة للمخدوم — migration 0045
`supabase/migrations/0045_multi_scope_servants.sql` · test `supabase/tests/multi_scope_test.sql`

**The servant or the child is ONE person** (one `persons` row, one code / QR) and can now be bound to **several churches / services / classes at once** — easily, from every screen that assigns a place.

**Servants — `servant_scopes` (نطاقات الخادم الإضافية)**
```
servant_enrollments  role · status · church_id · service_id · class_id   ← the PRIMARY place (unchanged)
servant_scopes       servant_id → servant_enrollments · church_id · service_id · class_id   ← the OTHER places
```
- The **role is one** per servant and applies to every place. A place goes as deep as the role: church manager → church · service manager → church → service · class servant → church → service → class (or a whole service / church when the class is left empty).
- **`my_scopes()`** = primary ∪ extras of the caller. **`can_access` / `scope_overlaps` / `scope_contains` / `enrollment_visible`** are true when **ANY** of the caller's places matches (`enrollment_visible` keeps its 7-argument signature — the ~30 policies and ~15 RPCs that inline it need no change — and falls back to `extra_scope_visible()` only when the primary check fails). The **churches / services / classes / servant_enrollments / persons** policies read `my_scopes()`; **`can_manage_servant`** / **`servant_in_my_scope(id)`** consider every place of the manager AND of the servant.
- **Mirror rows** (`enrollments.kind = 'servant'`, 0042): now **one row per class he serves in** (`sync_servant_mirrors(servant)`, fired from both tables) — so on the children page's «الخدام» switch he appears in each of his classes. `uq_enrollments_servant` (one mirror per servant) is gone.
- **`set_servant_scopes(servant, [{church_id, service_id, class_id}, …])`** — the ONE write path: the first place becomes the primary (columns), the rest → `servant_scopes`. Owner: replaces everything. Church / service manager: replaces the servant's places **inside his own area** and keeps the ones outside untouched; a place he may not grant (`scope_grantable`) → `scope_not_allowed`.
- **`servant_signup(…, p_scopes)`** and **`admin_add_servant(…, p_scopes)`** accept the whole list (the legacy single `p_church/p_service/p_class` still works). `set_enrollments_status(kind = servant)` on a scope also suspends servants whose **extra** place lies inside it.
- Housekeeping: the ambiguous 12-argument overload of `add_person_and_enroll` (left by 0042) is dropped.

**UI — `src/components/ScopePicker.tsx`** — one component everywhere: the list of chosen places (★ primary, ✕ remove, «اجعله الأساسي»), and an «إضافة مكان آخر» chooser church → service → class (`depth` by role, `requireLeaf` for children, `lockChurch` / `lockService` / `allowedChurches` mirror the SQL grant rules). `useAuth()` exposes **`scopes`** (all places of the signed-in servant) and **`multiScope`**; `scopeFilter(profile, scopes)` (realtime) narrows to the common church / service or drops the filter for a servant in several places.
- **`/signup` step 1 «مكان الخدمة»** — the servant adds **every class he serves in** (even in other churches); the invite link pre-fills the first one and locks its church / service. Step 4 lists them all.
- **إدارة الخدام → الطلبات** — the card lists the requested places; the approver edits the list (role decides the depth) → approve updates the row and calls `set_servant_scopes`.
- **إدارة الخدام → الخدام → تعديل** — «أماكن الخدمة» picker replaces the three selects (saved through `set_servant_scopes`). A multi-place servant appears **under each of his classes** in the tree with a **«N أماكن»** badge; the كنيسة → خدمة → فصل filters match ANY of his places.
- **إدارة الخدام → إضافة (فردي / جماعي)** — «أماكن خدمة إضافية» under the role / place selects → `AddServantInput.scopes` → `POST /api/servants/create` → `admin_add_servant(p_scopes)`. In bulk the extra places apply to every row.
- **Children** — **إدارة المخدومين → المخدومين** gets a **«الفصول»** action (`src/components/children/PersonClassesModal.tsx`): every class the child is in (across churches), **add him to several more at once** (`add_person_and_enroll` per class — same person by code, own attendance / points per class) or **remove one** (never the last — use «حذف»). Cards show a **«N فصول»** badge. The single **إضافة** form has **«فصول إضافية»** to enroll a new child in several classes in one go. Servant mirror rows are listed read-only there.

## Currently Completed Features
- ✅ **صلاحيات عناصر النشاط + وحدات لأشخاص محددين (20260925130000)**: (a) the four coarse keys of the «activity» group in permission profiles became **fine-grained, RLS-enforced keys** — المناسبات · أسباب النقاط · نتائج الافتقاد · طلبات تعديل البيانات each with `view · add · edit · delete` plus `set_default` (events, causes), `reorder` (feedbacks) and `approve · reject` (data requests). Managers keep everything; a **class servant views by default** and needs a profile for every write. The settings pages hide the buttons he lacks and lock the «افتراضية» flag; the DB refuses the rest (`activity_item_can`, guards on `is_default` / `sort_order`, `review_data_change_request`). Old profiles keep working: `activity.events` ⇒ all `activity.events.*` (expanded when the owner opens the profile). (b) **وحدة المالك → صلاحيات الوحدات → «أشخاص محددون»**: the owner picks servants by name and the module appears for **them only**, wherever they are (`module_access.servant_id`; scope grants unchanged). See § Activity item permissions.
- ✅ **التحكم في الدخول (20260925120000)**: access-control module — `/access`. **بوابات دخول** (a party · trip bus · hall…) each with a **rule tree** and an **allowed list**. At the door (البوابة tab) the servant picks the gate, **scans the QR / types the code / searches by name** and gets a big **مسموح بالدخول / مرفوض** card with the person's **name · photo · points · attendance count · last attendance · attendance history (event · day · time) · previous passes through this gate**, and **every rule with مستوفى / غير مستوفى + the actual value**. Rules: points (≥ ≤ = ≠ between) · attendance count (total, in a period, or of one event) · attended specific events (all / any) · not entered before (today / ever) · gender · age · enrolled in church/service/class · person field present / absent / contains · passed an exam · earned an achievement · registered in an occasion — combined with **AND / OR at the top level and nested groups** (each group AND / OR), each rule **enable / disable**. Allowed list: **persons (search or scan) · a class · a service · a whole church · any mix**; a person outside the list is **denied even when all rules pass** (unless the gate is «مفتوحة للجميع»). Admin (الإعداد tab): create · edit · start/stop · delete gates, rules, groups, allowed entries, per-gate log, and «الإعداد الكامل» showing the whole configuration. Permissions `access.check` (default) · `access.manage` (managers or via profile). See § Access module.
- ✅ **العائلات (20260924120000 + 130000)**: family module — `/family`. Create the family with **its own code** (typed · **scanned** · **generated** by نظام الأكواد, generator `family`; live check — a code that belongs to a person or another family is refused) + name · phone · address · notes; its QR can be copied / shared. Then **إضافة أفراد** in three ways with a pre-selected relation (أب · أم · ابن · ابنة …): **مسح كود** (scan card after card or type the code) · **بحث** (existing persons by name / phone / code, same search as everywhere, with their current family and places) · **فرد جديد** (create the person here — code typed / scanned / generated, data, photo, optional church → service → class — and add him in one transaction). A person belongs to ONE family; someone already in another family asks «نقل؟» in every mode. On the **scanner**, when the scanned code belongs to a person WITH a family (or is a family code) the **family picker** opens: **all codes / persons of the family** with their relation, «الممسوح» badge, in-scope services and **«حضر اليوم: …»**; tapping a person sends **that person's code / enrollment to the selected job** (attendance · points · data). When the person is enrolled in **2+ services / classes** a second step asks **which service**; the service he already attended today is highlighted («حضر اليوم هنا») and with **«التعرف على الخدمة تلقائياً»** on (default) it is chosen without asking. A «العائلات» switch in the scanner control panel turns the behaviour off. Permissions `family.view` (default) · `family.manage` (managers, or via a profile); RLS = module grant + a family is visible when the caller created it or ≥ 1 member is enrolled in his scope. See § Family module.
- ✅ **تقارير وجداول (0050)**: report builder module — pick a data source (المخدومون · سجل الحضور · سجل النقاط · الافتقاد · نتائج الامتحانات · الخدام), scope + filters, then EXACTLY the fields to export (select · reorder · rename · width · align · row filters · sort) with a live preview; a mm-exact page designer (title · text · logo · image · table that flows over pages · SVG charts · lines · boxes · header / footer · page numbers · portrait / landscape per page); export PDF (rasterized pages, perfect Arabic RTL) · Excel (the chosen columns only) · print; save the design as a template (`report_templates`, scoped) and re-run it with a new church / service / class / period
- ✅ **شخص واحد في أماكن متعددة (0045)**: الخادم يخدم في عدة كنائس / خدمات / فصول (`servant_scopes` + `my_scopes()` + `set_servant_scopes`) — يختارها في التسجيل ويعدّلها المدير من الطلبات / تعديل / إضافة عبر `ScopePicker`; المخدوم يُسجَّل في عدة فصول من «الفصول» أو من نموذج الإضافة
- ✅ **النسخ الاحتياطي والاسترجاع (0044)**: owner-only page under الإعدادات → النشاط — backup asks what to back up (every DB table grouped in Arabic + servants' login accounts, «الكل» default) and downloads ONE JSON to the device; restore from a device file asks what to restore + دمج / استبدال, FK-ordered staged upsert with triggers off; scheduled backups (daily / weekly / monthly, Cairo hour, keep last N) run by Vercel Cron into the private `backups` bucket and are downloadable from the history
- ✅ PWA: manifest (RTL/Arabic), service worker, installable, app icons — **name / icon / diocese name & logo configurable through Vercel env vars** (see Setup Guide § 4)
- ✅ Multi-tenant Postgres schema with **full RLS** (`supabase/migrations/0001_schema.sql`)
- ✅ Realtime enabled on all tables (dashboard, lists, approvals auto-update)
- ✅ Login / Signup (name, user id, phone, password) + approval workflow
- ✅ App shell: header (uploaded church logo + church name + service name) & bottom bar: الرئيسية، المخدومين، الماسح، الإحصائيات، الإعدادات
- ✅ الرئيسية: role-aware stat cards + quick actions
- ✅ **Person-centric core (0011)**: `persons` (national_id = QR) + `enrollments`; one person in many churches/services/classes; existing children data migrated automatically
- ✅ المخدومين: realtime list on enrollments+persons, search by name/phone/national id, add person (single & bulk) via `add_person_and_enroll` RPC with duplicate-person detection by national id
- ✅ الماسح: **same system as المخدومين** — church → service → class scope selectors, job selector (الحضور / النقاط / البيانات) with the same mode buttons; the chosen job runs on the person the moment his QR (national id) is scanned. QR camera (native BarcodeDetector) + scoped manual search; multi-enrollment picker; **archive of scan operations** below (timestamped list of every attendance / points / data action with delta & balance — no child cards)
  - الحضور: event dropdown + تسجيل / إزالة + event points badge (numpad for editable/open), day/time window enforced
  - النقاط: cause dropdown + إضافة / خصم + **يدوي (new)** — scanning opens a modal with the child's name & **live balance** (realtime subscription on the enrollment row), a tappable number that opens the same **NumPad**, a cause dropdown and إضافة / خصم buttons that apply the number — the modal **stays open** after each operation so the servant can keep adjusting
  - البيانات: عرض / تعديل / حذف — scanning opens the matching person modal
- ✅ **الإحصائيات (rebuilt, 0020)**: church → service → class cascading selectors (each with "كل الـ…"), working-day picker, totals (المخدومين / النقاط / الحضور / الفصول), gender split, day summary, attendance of the day **by event**, points of the day **by cause**, per-class breakdown, attendance-over-time chart **stacked by event** (7d–365d presets or custom range; day/week/month buckets), points-over-time by cause, weekday profile, points/attendance leaderboard, one-click **Excel export** (8 sheets) — all realtime
- ✅ الإعدادات: profile (self-edit + photo), approvals, churches (with logo upload), services & classes (photos, church→service cascade), servants management
- ✅ دعوة خادم جديد: scoped invite link + QR per manager level (`/settings/invite`)
- ✅ إدارة الخدام: edit / suspend / delete scoped per level (`/servants`), servant photos, **كنيسة → خدمة → فصل filters · الكل / يعمل / موقوف · grouped church → service → class with إيقاف الكل per node · إيقاف نطاق كامل** — same UI as إدارة المخدومين (`ScopeTree.tsx`)
- ✅ **إدارة المخدومين → المخدومين (0043)**: edit (incl. **moving a child to another church / service / class**) · stop · delete children, grouped church → service → class, stop a whole class / service / church; children page & scanner are view-only for data; default password `000000`; servant password change = old + new + confirm, superiors reset without the old one
- ✅ Null scope = "كل الـ...": manager with empty service/class scope covers everything under his parent scope (migration 0006)
- ✅ **بوابة المخدوم / Child Portal (0021)**: "دخول المخدوم" button on `/login` → `/child/login` scans the child's QR (camera, **gallery image**, or typed code) → portal with the **same header style** (church logo / service · class) and a **bottom bar**: الرئيسية، الحضور، النقاط، البيانات، الخيارات. Main page shows name, picture, attendance & points; الحضور lists every attendance by day with event, registration date & time and points; النقاط shows balance + every addition/deduction by cause or attendance; البيانات shows the child's data, QR (downloadable) and picture — the child can **upload a new picture** or **request data changes** (name / birthdate / gender / phone / address) which go to the managers as *change requests* to be **approved or denied**; الخيارات: profile, refresh, install hint, logout
- ✅ **المناسبة = المستوى الرابع (0022)**: 4th scope selector (كنيسة → خدمة → فصل → مناسبة) on the children page & scanner; attendance / points / calls / messages are all bound to the selected event (`points_log.event_id`, new `contact_log`); **status badge** (حاضر / لم يُسجّل / غائب) placed **before** the attendance & points badges, computed for the working day/time and recurring-event windows; status filter in الفلاتر; إدارة المناسبات moved right after إدارة الفصول in الإعدادات
- ✅ **نتيجة الافتقاد (0023)**: a **call-feedback badge right after the status badge** on every child card (children page + scanner). Two clocks: the **working (frozen) date picks the occurrence**, the **real date decides whether its follow-up cycle is still open**. Default **لم يُفتقد بعد** while the cycle is open (real time between the occurrence start and the next occurrence start); if the cycle has **closed in real time** (e.g. the working date is frozen before the last occurrence) and no feedback was recorded it shows **لم يُفتقد** and is read-only. Clicking it opens a modal with the **colored feedback buttons** (+ اتصال, history, undo); picking one makes it the badge. Feedbacks are managed in **إدارة نتائج الافتقاد** (`/settings/call-feedbacks`) with a **name, color and icon**, bound to **church → service → class → event** (null = all). A **نتيجة الافتقاد filter** (الكل / لم يُفتقد بعد / لم يُفتقد / each feedback) lives in الفلاتر
- ✅ **وحدة المالك + صلاحيات الوحدات (0024)**: modules registry (`src/lib/modules.ts`) — the side menu section under the 5 main pages shows **modules only**, the settings hub has a separate **الوحدات** group; the **owner module** (`/owner`, owner-only) hosts owner controls built step by step, starting with **صلاحيات الوحدات** (`/owner/modules`): per module, grant visibility to church → service → class (any level «الكل»), show for everyone / hide from everyone — enforced by RLS (`module_visible`) on the card tables and realtime everywhere
- ✅ **وحدة الأشابين (0025)**: every servant (أشبين) is bound to **his own group of children** — in `/shepherds` he picks children from his scope (مجموعتي / اختيار tabs, search + church → service → class selectors); **a child can be in one group only** (children already chosen by another servant show «في مجموعة فلان» and are locked; managers can free them). On the children page a **«مجموعتي» button under the church / service / class selectors** narrows the list to the group — attendance, calls, messages, points, data, badges, filters and sort all work exactly the same. Visible only where the owner granted the `shepherds` module; realtime
- ✅ **وحدة إستبدال النقاط (0026)**: نقطة بيع بالنقاط (`/store`) — **المخزون** (`/store/inventory`: كود = ملصق QR، اسم، صورة، السعر بالنقاط، الكمية، متاح/غير متاح، نطاق كنيسة → خدمة → فصل، +/− كمية سريع، **طباعة ملصقات QR** بثلاث مقاسات وعدد نسخ), **الكاشير** (`/store/pos`: مسح كارت المخدوم أو البحث عنه → سلة باسمه وصورته و**رصيده الحي** → مسح ملصقات الأصناف أو اختيارها من الشبكة مع الكمية → مجموع لحظي والمتبقي بعد الشراء — **لا يمكن إضافة صنف يتجاوز الرصيد أو الكمية المتاحة** → «إتمام العملية» مع تأكيد → الفاتورة تُحفظ ويُخصم الرصيد), **الأرشيف** (`/store/archive`: كل الفواتير مع البنود والرصيد قبل/بعد والكاشير؛ المسؤولون يلغون فاتورة فتُستردّ النقاط والكمية). العملية تظهر للمخدوم في **صفحة النقاط ببوابة المخدوم** (مصدر «إستبدال النقاط» + فاتورة قابلة للفتح). مُقيَّدة بصلاحيات الوحدات (`module_visible('store')`) وواقعية
- ✅ **وحدة الامتحانات (0027)**: امتحانات اختيار من متعدد (`/exams`) — الخادم ينشئ الامتحان (عنوان · نطاق كنيسة → خدمة → فصل · فترة إتاحة · وقت افتراضي ودرجة افتراضية للسؤال · **شرط النجاح** نسبة ٪ أو درجة · **نقاط النجاح ونقاط الدرجة الكاملة** · **كل الأسئلة أو عدد عشوائي** (مثلاً 10 من 20 لكل مخدوم) · ترتيب عشوائي للأسئلة والاختيارات · عدد المحاولات · ما يراه المخدوم بعد الانتهاء)، يضيف الأسئلة (نص · صورة · 2–6 اختيارات · الإجابة الصحيحة · الدرجة · الوقت لكل سؤال) ثم **ينشر**. تبويب **النتائج**: كل مخدوم حل الامتحان مع الدرجة والنسبة و**فلتر ناجح / لم ينجح** و**ترتيب بالدرجة أو الاسم أو التاريخ**، تفاصيل كل سؤال بإجابته، إلغاء محاولة (استرداد النقاط + إعادة)، تصدير Excel. في **بوابة المخدوم** يظهر «الامتحانات» في القائمة الجانبية والرئيسية: **سؤال واحد كل مرة مع عدّاد مرتبط بوقت السيرفر**، ينتقل تلقائياً عند انتهاء الوقت أو بالضغط على «التالي»، **لا يمكن الرجوع**، المتابعة من حيث توقف عند إغلاق التطبيق، شاشة نتيجة، والنقاط تُضاف لرصيده فوراً وتظهر في صفحة النقاط. مُقيَّدة بصلاحيات الوحدات (`module_visible('exams')`) وواقعية
- ✅ **وحدة أعياد الميلاد (0028)**: `/birthdays` — **من عيد ميلاده هذا الشهر يوماً بيوم** مع ◀ ▶ لتغيير الشهر (والسنة) وشريط الشهور، ونطاق كنيسة → خدمة → فصل، واليوم الحالي مُضاء. لكل مخدوم: **اتصال** · **واتساب / SMS** بنص تهنئة فيه متغيرات ([الاسم الأول] · [السن] · [تاريخ العيد] · [اسم الفصل] …) · **هدية نقاط** (مرة واحدة في السنة، NumPad، تُسجَّل في سجل النقاط وتظهر للمخدوم) · **كارت تهنئة** (معاينة → **إرسال كصورة** عبر قائمة المشاركة/واتساب · تنزيل PNG بدقة 300dpi · طباعة) · **سجل التهاني** (مكالمة / واتساب / SMS / كارت مطبوع / كارت مُرسَل / هدية / ملاحظة — مع تراجع). جماعياً: **تهنئة الجميع** (يفتح محادثة كل مخدوم بدوره بالنص المكتوب مع تخطّي)، **هدية للجميع**، **طباعة كروت الشهر**، تصدير **تقويم ICS** (تذكير سنوي) و**Excel**، فلاتر (لم يُهنَّأ / هُنِّئ / بلا هدية / بلا هاتف) وبحث. **كروت التهنئة** (`/birthdays/cards`): قوالب بنفس محرك تصميم الكروت + بيانات عيد الميلاد (الاسم الأول · السن الجديدة · يوم وشهر العيد · نقاط الهدية)، افتراضي لكل نطاق، وتبويب طباعة مصدره مواليد الشهر. **الإعدادات** (`/birthdays/settings`): نقاط الهدية ونص التهنئة الافتراضي لكل كنيسة / عام. **الرئيسية**: بطاقة «أعياد الميلاد» بمواليد اليوم والأسبوع القادم. **بوابة المخدوم**: يوم عيد ميلاده يرى تهنئة وكارته (يحفظه كصورة) وهديته، وقبله بأسبوع عدّاد. مُقيَّدة بصلاحيات الوحدات (`module_visible('birthdays')`) وواقعية
- ✅ **وحدة الرسائل (0029)**: محادثات داخل التطبيق. **المخدوم** يكتب من بوابته (`/child/messages`) في محادثة فصله فتظهر لكل الخدام المسموح لهم على هذا الفصل / الخدمة / الكنيسة، ويردّون عليه هناك. **الخادم** (`/messages`) يرسل لمخدوم أو لمخدومين محددين، أو **إعلاناً** لفصل / خدمة / كنيسة / كل الكنائس (كل واحد في حدود صلاحيته — «كل الكنائس» للمالك فقط)، وللخدام **التابعين له في التسلسل** (خادم / خدام محددون أو كل خدام فصل / خدمة / كنيسة) — ومن راسلك يمكنك الرد عليه دائماً. صندوق وارد بالمحادثات وعدد غير المقروء، دلو **الإعلانات**، محادثة بصور وتجميع بالأيام وتحميل أقدم، حذف (المرسل أو المسؤول)، **جرس في الهيدر** بعدد غير المقروء (الخادم والمخدوم)، وقناة **«رسالة داخلية»** في صفحة المخدومين ترسل نص القالب إلى محادثة المخدوم. مُقيَّدة بصلاحيات الوحدات (`module_visible('messages')`) وواقعية
- ✅ **وحدة الفصول الأونلاين (0030)**: فصول مباشرة عبر يوتيوب / فيسبوك / زووم / جوجل ميت / رابط آخر. **الخادم** (`/online`) ينشئ الفصل (التاريخ، من–إلى، الخدمة، الكنيسة، الفصل / الفئة، رابط البث، امتحان مربوط، مناسبة، تشغيل الدردشة) ويحدد **قواعد الحضور** لكل فصل (نسبة الوقت، عدد فحوص الانتباه المطلوبة والحد الأدنى للنجاح، مدة الفحص، حد أدنى للإجابات، نقاط الحضور)؛ ثم من **غرفة التحكم** (`/online/[id]`) يبدأ / ينهي الفصل، يشاهد البث ومن دخل الآن، يرسل **فحص انتباه** (نافذة لدى المخدوم بعدّاد)، يطرح **أسئلة مباشرة** (اختيار من متعدد مُصحَّح آلياً بنقاط أو نص حر) ويرى الإجابات لحظياً، يتابع الدردشة، ويرى إحصاءات الحضور/الانتباه لحظياً. **المخدوم** (`/child/online`) يرى الفصول القادمة والمباشرة والسابقة بنتيجته، و«ادخل الفصل» (`/child/online/[id]`) يسجّل وقت الدخول ويُبقي جلسة بنبض 30 ث، مع البث والفحوص والأسئلة والدردشة ورابط الامتحان. **الحضور لا يُحسب بالدخول فقط**: عند الإنهاء تُطبَّق القاعدة `نسبة الوقت ≥ الحد` **و** `الفحوص الناجحة ≥ الحد الأدنى` (**و** الإجابات ≥ الحد إن وُجد) → حاضر / غائب، ويُكتب سطر حضور + نقاط في `attendance_log` (يظهر في سجل الحضور والنقاط بالبوابة)، مع إمكانية **تعديل يدوي** لحالة أي مخدوم وإعادة فتح الفصل. مقيدة بصلاحيات الوحدات (`module_visible('online')`).
- ✅ **وحدة الإنجازات (0031)**: إنجازات بسيطة بشارة وصورة ونقاط. **الخادم** (`/achievements`) ينشئ الإنجاز (الاسم، الوصف، الصورة، النقاط، النطاق: الكنيسة / الخدمة / الفصل / المناسبة — كلها اختيارية عدا الكنيسة، مفعّل / موقوف)، ويحدد **طريقة المنح** (مرة واحدة أو عدة مرات مع حد أقصى وفاصل زمني بالأيام) و**النوع**: عادي (يُمنح يدوياً من صفحة المخدومين → مهمة «الإنجازات») أو **حضور** (قاعدة «عدد حضور» N أو «حضور متتالٍ» N على التوالي) يُمنح **آلياً** عند تسجيل أي حضور (سكانر / حضور المناسبات / الفصول الأونلاين). النقاط تُضاف عبر `points_log` الحالي (وتُخصم عند الإلغاء). قائمة الحاصلين مع إمكانية الإلغاء. **المخدوم** (`/child/achievements`) يرى كروت إنجازاته 🏆 وشرائط تقدّم «3 / 5» لإنجازات الحضور، وتظهر نقاط الإنجازات بمصدرها في سجل النقاط. مقيدة بصلاحيات الوحدات (`module_visible('achievements')`) وبالنطاق (RLS).
- ✅ **وحدة الفعاليات (0032)**: رحلات · مؤتمرات · احتفالات · أنشطة. **الخادم** (`/occasions`) يرى **لوحة الفعاليات** (صورة، عنوان، نوع، موعد، مكان، منظّم، آخر موعد للتسجيل، الأماكن المتاحة، عدّادات) وينشئ الفعالية بنطاق كنيسة → خدمة → فصل، سعة (أو بلا حد)، **تأكيد تلقائي أو مراجعة**، نقاط عند تسجيل الدخول، وقائمة تحقق أولية. صفحة الفعالية (`/occasions/[id]`): **لوحة معلومات** (مسجّل · قيد المراجعة · مؤكد · سجّل الدخول · ملغي · متاح)، **المشاركون** (بحث وفلاتر، إضافة من مخدومي نطاقه، ورقة المشارك: تغيير الحالة قيد المراجعة → مؤكد → سجّل الدخول → ملغي، **قائمة التحقق** ✓ لكل مشارك — الدفع، إذن ولي الأمر، المواصلات…، عرض تذكرته، ملاحظة، حذف، تصدير CSV)، **تسجيل الدخول** بمسح QR التذكرة **أو كارت المخدوم** (أو كود يدوي / بحث بالاسم) مع كارت نتيجة أخضر / كهرماني ونقاط الدخول، **قائمة التحقق** (تعريف العناصر وترتيبها ونسبة إنجاز كل عنصر)، **الإعلانات والتذكيرات** + سجل تلقائي لحالات المشاركين. **المخدوم** (`/child/occasions`) يرى الفعاليات القادمة لفصله / خدمته / كنيسته مع حالته على كل كارت، يفتح الفعالية ويضغط **«أنا مشارك!»** (أو يلغي مشاركته قبل البدء)، وعند التأكيد تظهر **تذكرته الإلكترونية** (QR فريد `T-XXXXXXXXXX` قابل للحفظ كصورة)، وقائمة التحقق الخاصة به، والإعلانات وإشعارات حالته. الحالات: قيد المراجعة → مؤكد → سجّل الدخول → ملغي. مقيدة بصلاحيات الوحدات (`module_visible('occasions')`) وبالنطاق (RLS): الخادم يدير مخدومي نطاقه فقط حتى على فعالية أوسع.
- ✅ **وحدة نتائج الامتحانات (0038)**: `/results` — الخادم ينشئ **الامتحان** (الاسم · التاريخ · العام الدراسي · النطاق كنيسة → خدمة؟ → فصل؟ · الوصف · الحالة مسودة / مفتوح / مكتمل / مؤرشف · نظام التقدير · قاعدة النجاح) ويضيف **المواد** (اسم · كود · الدرجة الكاملة · درجة النجاح · الوزن · الترتيب · مادة إضافية). **أنظمة التقدير** (`/results/grading`) عامة أو لكل كنيسة بشرائح (اسم · من٪ · إلى٪ · لون · ناجح) مع تحقق من التداخل والفجوات. **الإدخال الجماعي** (`/results/bulk`) جدول مخدومين × مواد بلوحة المفاتيح (Enter/↓ التالي، Alt+A غائب، لصق عمود من Excel) مع تحقق فوري (> الدرجة الكاملة / سالب / غير رقمي)، تقدير مباشر، مسودة تلقائية في الجهاز، حفظ الكل بشريط تقدّم وإعادة المحاولة للفاشلة. **الاستيراد من Excel** (`/results/import`) قالب جاهز بأكواد المخدومين، معاينة، مطابقة بالكود ثم بالاسم، اكتشاف غير المعروف / المكرر / غير الصالح مع التصحيح قبل الاستيراد. صفحة الامتحان: لوحة (عدد · مكتمل · ناجح · راسب · نسبة النجاح · متوسط · أعلى · أقل · توزيع التقديرات)، قائمة النتائج، **الترتيب مع التعادل (1,2,2,4)** بالنسبة أو بالمجموع، بطاقة نتيجة المخدوم (عرض / تعديل / طباعة)، **قفل النتائج** بعد الاعتماد، نسخ النتائج من امتحان آخر، مسح، تكرار الامتحان، نشر للبوابة. **التقارير** (`/results/reports`) نتائج امتحان · ترتيب · أداء المواد · أداء الفصول والخدمات · توزيع التقديرات · النجاح والرسوب مع فلاتر النطاق / العام / الفترة وتصدير Excel وطباعة. **نتائج المخدومين** (`/results/students`) بحث + سجل كل امتحانات المخدوم مع تطور النسبة. كل الحسابات (النسبة · التقدير · النجاح · المجموع · الترتيب) تُجرى في قاعدة البيانات؛ الصلاحيات `results.view / enter / edit / import / export / manage_exams / manage_subjects / manage_grading / lock / stats` عبر نظام الصلاحيات الحالي، والمديرون يملكون كل الصلاحيات في نطاقهم.
- ✅ **وحدة المكتبة (0039)**: `/library` — مكتبة بروابط فقط (لا رفع ملفات) منظمة بـ **مواضيع** (اسم · وصف · صورة غلاف). كل موضوع فيه تبويبان: **📚 الكتب** (عنوان · مؤلف · وصف · غلاف · رابط PDF — Google Drive أو رابط مباشر) و**🎓 المحاضرات** (عنوان · متحدث · وصف · تاريخ · 🎥 فيديو أو 🎙️ صوت · رابط YouTube / Drive / MP3 / MP4 · صورة مصغرة تلقائية من YouTube / Drive). الرئيسية تعرض المواضيع ككروت (صورة · اسم · عدد الكتب · عدد المحاضرات) مع **بحث** في المواضيع والكتب والمحاضرات والمؤلفين والمتحدثين، وتبويب **⭐ المفضلة** لكل خادم. المحاضرات تُشغَّل داخل التطبيق (YouTube / Drive embed · `<audio>` · `<video>`). **الجمهور** لكل موضوع / كتاب / محاضرة: الجميع · الخدام فقط · خدمة محددة · فصل محدد (بنفس نظام النطاق). **المخدوم** (`/child/library`) يتصفح المتاح له ويحفظ مفضلته. الصلاحيات: `library.view` (افتراضي لكل خادم في نطاق مفعّل) · `library.manage` (المديرون، أو عبر ملف صلاحيات). مقيدة بصلاحيات الوحدات (`module_visible('library')`) وواقعية.
- ✅ **الافتراضي لكل مستوى (0048)**: the default event (المناسبة الافتراضية) and default points cause (السبب الافتراضي) are now **per scope, not global** — one default may be marked for the **church** (كل الخدمات), another for a **service** (كل الفصول) and another for a **class**. The children page and the scanner resolve the preselection **most-specific first: class → service → church** — if the service has a default it wins over the church's; if the service has none, the church's is used; a class default beats both. Re-resolved every time the scope selectors change (a manual pick is kept while it stays valid for the scope). The resolver works on the **effective** scope (`effectiveScope` in `src/lib/defaults.ts`): a level with a single option is shown as a disabled selector that still holds «كل …», so a servant bound to one church → one service → one class gets his **class default preselected on page load** — same result as if he had picked them by hand (a service manager with one service gets the service default; when several churches / services are visible nothing is guessed). The DB trigger keeps **one default per exact scope** (marking a new one switches off only its scope-mate) and `default_event_for()` / `default_cause_for()` expose the same chain to SQL; `src/lib/defaults.ts` (`pickScopedDefault`) mirrors it in the app. The events / causes forms say which level the default applies to and list badges read «افتراضي الكنيسة / الخدمة / الفصل».
- ✅ **وحدة سجل النشاط (0047)**: `/activity` — **كل ما يحدث في التطبيق، كل عملية**: حضور · نقاط · مكالمات · رسائل · بيانات الأشخاص · تسجيلات · خدام · صلاحيات · بنية · مناسبات · متجر · امتحانات · فعاليات · إشعارات · مكتبة · نسخ احتياطي · دخول / خروج — تُسجَّل **تلقائيًا من قاعدة البيانات** (مشغّل عام على كل جدول أعمال) فلا تفلت أي عملية حتى لو جاءت من RPC أو من مشغّل آخر أو من بوابة المخدوم. كل سطر: **مَن** (خادم بدوره · مخدوم من بوابته · النظام) · **ماذا** (مفتاح ثابت مثل `attendance.add` · `person.update` · `servant.approve` مترجم لجملة عربية) · **على مَن** (اسم المخدوم / الخادم / الكنيسة…) · **أين** (كنيسة → خدمة → فصل) · **الفرق** قبل ← بعد (التعديل يحفظ الأعمدة المتغيرة فقط) · **العملية الجماعية** (استيراد 300 مخدوم = دفعة واحدة برقم مشترك). أربعة تبويبات: **السجل** (خط زمني مباشر مجمّع باليوم، بحث، فترة اليوم / ٧ / ٣٠ / الكل، نوع الفاعل، النطاق، نوع العملية — يحمّل **10 أو 100 أو 1000** عملية ثم «**تعمّق أكثر**» يجلب الأقدم بلا تكرار عبر keyset pagination) · **بالمستخدم** (كل فاعل بعدد عملياته وآخرها → عملياته) · **بالعملية** (مجمّعة حسب الوحدة مع العدّادات → عملياتها) · **نظرة عامة** (KPIs · آخر ٣٠ يومًا · ساعات النشاط · الأكثر نشاطًا · وللمالك مدة الاحتفاظ + تنظيف). كل سطر يفتح **ورقة تفاصيل** بجدول قبل / بعد وأزرار «كل عملياته» · «كل ما حدث له» · «مثلها» · «عرض الدفعة». تصدير Excel للمُحمَّل. الصلاحيات: المالك ومديرو الكنائس يرون كل شيء في نطاقهم افتراضيًا، مسؤول الخدمة يرى خدمته، خادم الفصل يحتاج `activity.view` (فصله) و`activity.view_all` لكل الكنيسة. مقيدة بصلاحيات الوحدات (`module_visible('activity')`)، لا أحد يكتب فيها من التطبيق مباشرة.
- ✅ **تخصيص التطبيق (0035)**: from **وحدة المالك → تخصيص التطبيق** the owner controls the app shell for everyone — **شريط المهام**: the **5 bottom-bar slots** (`/owner/customize/taskbar`), each slot = any destination (a core page, any module, or the owner module) with an optional custom icon (190+ icon library) and label, re-orderable, with a live preview; everything NOT in the bar is listed in the **side menu under the 5** (core pages moved out, the owner module, the modules granted to the user's scope). **أيقونات الهيدر** (`/owner/customize/header`): choose which icons sit in the header and their order — تاريخ العمل · جرس الرسائل · جرس الإشعارات · **quick links** to any page / module, each with an optional icon; the menu button is fixed. Stored in `app_settings.navigation` (owner-write, all-read, realtime → every device re-lays instantly). Resolution is per user: a slot pointing at a module hidden from a servant falls back to a default core page; module-bound header widgets vanish when the module isn't granted
- ✅ **نظام الأكواد (0040)**: from **تخصيص التطبيق → نظام الأكواد** (`/owner/customize/codes`) the owner designs how every code the app generates looks. A code is a **template = ordered parts joined by a separator** (dash by default): `نص ثابت` (prefix) · `الوقت` (generation moment in ms → `1702655732293`) · `التاريخ` (YYYYMMDD · YYMMDD · YYYY …) · `عشوائي` (N chars — alnum / digits / letters / hex) · `اختصار الكنيسة` / `الخدمة` / `الفصل` (abbreviations the owner gives each scope in the same page, with a fallback text) + letter case. Example: `P-1702655732293` or `STM-C1-231215-4F7K`. **One default system** is followed by every generator, and each **generator** — كود المخدوم · كود الخادم · كود منتج المتجر · كود تذكرة المناسبة — can pick **النظام الافتراضي** / **تصميم خاص** (its own template) / **الطريقة الأصلية** (the app's built-in `P-XXXXXXXX` …), with «الكل» shortcuts. Live colored preview + ready presets. Applied in: إضافة مخدوم (single + bulk `AUTO`, monotonic clock so timestamp codes never collide), تعديل كود المخدوم, signup code generation (anon reads via `code_settings()`), store item code, and — **in the database** — `add_person_and_enroll` fallback code (`new_person_code`) and occasion ticket codes (`render_code`, SQL mirror of `renderTemplate`). Stored in `app_settings.codes` (validated by trigger, realtime). Existing codes never change. `src/lib/code-templates.ts` · `useCodeGenerator(kind)`
- ✅ **إضافة خدام فردي / جماعي (0041)**: managers add servants directly from **إدارة الخدام → إضافة** — single form (scope · code typed/scanned/generated · data · password · permission profiles) or bulk Excel / paste import with column mapping, auto codes + passwords, preview and a credentials Excel export. Servants are approved instantly. Server route `/api/servants/create` + RPC `admin_add_servant` (service_role only). See § Add servants directly.
- ✅ **ودجات الرئيسية + أسماء الصفحات (0036)**: the home page is now a **grid of owner-configured widgets** (`src/lib/widgets.ts`, 19 widgets: ترحيب · النبض اليومي · العدّادات · إجراءات سريعة · الحدث القادم (countdown + live attendance + scanner shortcut) · اتجاه الحضور (7-occurrence bars) · مواظبة الأسبوع · لوحة الشرف · المتابعة (absentees of the last occurrence without a follow-up call) · طلبات الموافقة · أعياد الميلاد · الفعاليات · الفصول الأونلاين · الامتحانات المفتوحة · الرسائل · الإشعارات · حركة المتجر · آخر الإنجازات · آية اليوم with the Coptic date). **ودجات الرئيسية** (`/owner/customize/widgets`): add / remove / reorder widgets, half-or-full width, optional custom heading, live miniature preview. Module widgets vanish for servants whose scope lacks the module; role-bound widgets (approvals) only show to managers. **أسماء الصفحات والوحدات** (`/owner/customize/names`): rename **any** core page, module or the owner module — the new name is applied **everywhere**: the page's own title, taskbar, side menu, header links, settings list, gates and home widgets. Typing a label on a taskbar slot writes the same global name. Stored in `app_settings.widgets` / `app_settings.names` (realtime → every device)
- ✅ **طلبات تعديل البيانات** (`/settings/data-requests`): class servant, service manager, church manager or owner of the child's scope reviews pending requests (photo before/after or field diff), approves (applied to `persons`) or rejects with a note — realtime, with a pending-count badge on الإعدادات and in the side menu

## Functional Entry Points
| Path | Description |
|---|---|
| `/login`, `/signup` | Auth (public) |
| `/` | الرئيسية — owner-configured widgets grid (0036) |
| `/children` | المخدومين — list/search/add |
| `/scanner` | الماسح — scope + job (attendance / points / data) applied on scan; live manual points modal (NumPad, stays open); scan-operations archive |
| `/stats` | الإحصائيات — scoped KPIs, by-event / by-cause breakdowns, timelines, leaderboard, Excel export |
| `/settings` | الإعدادات hub |
| `/settings/approvals` | approve/reject servant requests (scope defaults from request) |
| `/settings/invite` | invite link + QR scoped to manager level |
| `/settings/servants` | manage servants: edit/suspend/delete per level |
| `/settings/churches` | owner + church manager: manage churches + logos |
| `/settings/services` | manage services (photo, church select) |
| `/settings/classes` | manage classes (photo, church→service cascade) |
| `/signup?church=..&service=..&class=..` | invite-scoped signup (locked pre-fill) |
| `/login?as=child` | **دخول المخدوم** (0042) — code (scan / type) + password + تذكرني; `/child/login` redirects here |
| `/child/signup?church=..&service=..&class=..` | child signup wizard → pending join request (0042), public |
| `/children/manage?tab=add\|requests\|invite` | **إدارة المخدومين** (0042): add single/bulk (+ portal password) · join requests · invite QR; `/children/add` redirects |
| `POST /api/servants/account` | service-role: reset a servant's password / change his code (0042) |
| `/child` | child main page: name, picture, attendance & points, enrollments, latest activity |
| `/child/attendance` | child attendance: by day, event filter, registration date/time, points |
| `/child/points` | child points: balance, added/removed, by cause / attendance |
| `/child/data` | child data + QR + picture; upload picture / request data change; request history & cancel |
| `/child/options` | child options: profile, refresh, install, logout |
| `/settings/data-requests` | managers: approve / reject children's photo & data change requests |
| `/settings/call-feedbacks` | **إدارة نتائج الافتقاد** — call-feedback presets (name, color, icon) scoped church → service → class → event, reorderable |
| `/owner` | **وحدة المالك (Owner module)** — hub of owner-only controls, visible to `role = owner` only |
| `/owner/modules` | **صلاحيات الوحدات** — per module: which church → service → class can see it (grants, "all" at any level, show/hide for everyone) |
| `/owner/customize` | **تخصيص التطبيق** — hub: شريط المهام · أيقونات الهيدر · ودجات الرئيسية · أسماء الصفحات · نظام الأكواد |
| `/owner/customize/taskbar`, `/owner/customize/header` | 5 bottom-bar slots (destination · icon · name) / header icons & quick links (0035) |
| `/owner/customize/widgets` | **ودجات الرئيسية** — pick, order, resize and title the home-page widgets (0036) |
| `/owner/customize/names` | **أسماء الصفحات والوحدات** — rename any page / module everywhere (0036) |
| `/owner/customize/codes` | **نظام الأكواد** — design generated codes: parts · separator · per-generator mode · scope abbreviations (0040) |
| `/shepherds` | **وحدة الأشابين** — my group: pick / remove children (only unclaimed children are pickable), managers' overview of all groups in scope; module-gated |
| `/store` | **وحدة إستبدال النقاط** — hub (stats + links); module-gated (`store`) |
| `/store/inventory` | المخزون — items CRUD (code / name / picture / price in points / stock / active / scope), quick ± stock, select → **print QR labels** |
| `/store/pos` | الكاشير — scan or search child → basket with live balance → scan / pick items with qty → live total & remaining, balance + stock guard → confirm → `store_checkout` → receipt |
| `/exams` | **وحدة الامتحانات** — hub: every exam in scope (status, questions, attempts, pass rate), filters, create, duplicate; module-gated (`exams`) |
| `/exams/[id]` | exam page — الأسئلة (add / edit / reorder / duplicate / delete, publish · close · reopen) · النتائج (filter pass/fail, sort by degree/name/date, detail with every answer, cancel attempt, Excel) · الإعدادات |
| `/child/exams` | child portal — open exams (rules, attempts left, last result) + past ones |
| `/child/exams/[id]` | child exam player — intro → one question at a time with server-anchored countdown → auto / manual next (no going back) → result (score, pass, points, review if allowed) |
| `/store/archive` | أرشيف الفواتير — bills by day, search, scope & status filters, bill detail, managers cancel (`store_cancel_order` refunds points + restocks) |
| `/birthdays` | **وحدة أعياد الميلاد** — month view day by day (◀ ▶ month / year, scope), per-child call / WhatsApp-SMS / gift / card / log, greet-all stepper, gift-all, ICS + Excel; module-gated (`birthdays`) |
| `/birthdays/cards` | birthday card templates (scoped, default per scope) → `/birthdays/cards/[id]` design (birthday variables) + print the month's children |
| `/birthdays/settings` | default gift points + greeting template per church / global |
| `/messages` | **وحدة الرسائل** — inbox: children + staff conversations with unread counts, announcements bucket, filters; module-gated (`messages`) |
| `/messages/new` | compose: المخدومين / الخدام → selected recipients or a scope announcement (class / service / church / all — within the sender's scope) with audience preview |
| `/messages/[bucket]` | thread — `e:<enrollment>` child conversation (child + every servant of the tenant + announcements he received), `s:<profile>` direct staff chat, `b` announcements |
| `/child/messages` | child portal — one conversation per enrollment with unread counts |
| `/child/messages/[enrollment]` | child portal — the conversation: write to the servants, read replies + announcements |
| `/online` | servants — الفصول الأونلاين hub: KPIs, search, scope filter, status filter, create / edit classes |
| `/online/[id]` | control room — start / end / reopen, stream preview, send attention check, participants (live %, checks, answers, override), live questions & answers, chat, settings |
| `/child/online` | child portal — live / upcoming / past online classes with my result |
| `/child/online/[id]` | child portal — the live room: join (timestamp), 30 s heartbeat, attention-check popup, live questions, chat, exam link, final result |
| `/achievements` | achievements module — list (picture, name, type, points, scope, award mode, status), add / edit, activate / deactivate, delete, earners (+ revoke) |
| `/child/achievements` | child portal — earned achievement cards + progress bars for attendance achievements |
| `/results` | exam results module — exams list (scope selectors, search, status filter, KPIs), add / duplicate / delete |
| `/results/[id]` | exam page — dashboard (KPIs + grade distribution), subjects (add / edit / reorder / duplicate / remove), results list + student result card (view / edit / print), ranking with ties (by percent / total), settings (lock / unlock, publish, copy from exam, clear, duplicate, delete, audit) |
| `/results/bulk` | bulk results entry — students × subjects grid, keyboard navigation, paste from Excel, live validation & grade, local autosave draft, save-all with progress and retry failed |
| `/results/import` | Excel import — template download, drag & drop, preview, match by code / name, unknown / duplicate / invalid detection, inline fixes, import with progress |
| `/results/reports` | reports — exam results, ranking, subject performance, class / service performance, grade distribution, pass / fail; scope / year / date filters; Excel export; print |
| `/results/grading` | grading systems — list (global / per church, default), bands editor (name, min %, max %, description, color, pass) with overlap / gap validation, percent tester, duplicate / delete |
| `/results/students` | student results — scoped search, exam history with trend, KPIs, open result card |
| `/library` | library module — subject cards (cover · name · books · lectures), global search, ⭐ favorites tab, add / edit / delete subjects |
| `/library/[id]` | subject page — banner, 📚 الكتب \| 🎓 المحاضرات tabs, search, kind filter, inline player, add / edit / delete books & lectures |
| `/child/library` | child portal — library subjects + search + my ⭐ favorites |
| `/child/library/[id]` | child portal — subject books & lectures with player and ⭐ |
| `/occasions` | occasions module — board (cover, title, kind, date, place, organizer, seats, counters), scope selectors, phase filters, add |
| `/occasions/[id]` | occasion detail — stats, participants (add / status / checklist / ticket / remove / CSV), QR check-in, checklist editor, announcements |
| `/child/occasions` | child portal — occasions board with my registration status |
| `/activity` | activity log module — tabs السجل (live timeline, 10/100/1000 per dig, keyset «تعمّق أكثر») · بالمستخدم · بالعملية · نظرة عامة (+ owner retention / prune); `?tab=&actor=&kind=&action=&group=&person=&batch=` |
| `/reports` | reports & tables module — 4-step wizard (البيانات → الحقول والمعاينة → التصميم → التصدير PDF / Excel / طباعة) · `?tab=templates` saved templates · `?template=<id>` opens a template |
| `/access` | access-control module — `?tab=door&event=<id>` the gate: scan / code / search → مسموح / مرفوض with rules status · `?tab=admin[&event=<id>&sub=rules|allowed|log|all]` gates list, rule tree (AND / OR groups), allowed list (persons · class · service · church), log, full config |
| `/family` | family module — العائلات list (search by family / code / member), members with relation, create (code typed / scanned / generated) · edit · delete, family QR · `?tab=qr&family=<id>` add members: scan code · search existing · new person |
| `/child/occasions/[id]` | child portal — occasion detail: «أنا مشارك», cancel, e-ticket QR, my checklist, notifications |

## Data Models & Storage
- **Tables**: `churches`, `services`, `classes`, `profiles`, `children`, `attendance` — all with RLS + realtime
- **Storage**: `church-logos` public bucket · `photos` public bucket · `backups` **private** bucket (scheduled backup files, 0044)
- **Helper functions**: `my_role()`, `my_church()`, `can_access()` etc. (security-definer, no RLS recursion)
- **Triggers**: attendance insert/delete auto-updates child's `attendance_count` and `points`; profile guard prevents self-approval

## Setup Guide

### 1. Supabase
1. Create a project at supabase.com
2. **Preferred (CLI / CI):** `supabase link --project-ref <ref>` then `supabase db push` — applies every file in `supabase/migrations/` in version order and records it in `supabase_migrations.schema_migrations`, so later pushes only apply new files. See **Database migrations — automatic deploy (CI)** below.
   **Manual fallback:** SQL Editor → run `supabase/full_schema.sql` once — it is every migration combined into one file, verified to produce a schema identical to running the files one by one. Regenerate it after adding a migration with `supabase/build_full_schema.sh`. If you go this way, also run `supabase/scripts/baseline_migration_history.sql` so CI knows those files are already applied.
   `0002_bootstrap_owner.sql` creates the **default owner** (`supabase/migrations/0002_bootstrap_owner.sql`, self-contained — no UUID to paste): login code **`000000`** · password **`000000`**. It is idempotent (does nothing if `000000@diocese.app` exists) and works both on a fresh 0001 schema (CI order) and on a fully migrated database (run by hand).
   ⚠️ In `0005` the `alter type ... add value 'suspended'` must run in its own query before the rest of the file
   ⚠️ `0019_performance_rls_indexes_rpc.sql` is **required** by the current frontend (home / scanner call its RPCs). It is safe to re-run (idempotent).
   ⚠️ `0020_statistics_rpcs.sql` is **required** by the الإحصائيات tab (all `stats_*` RPCs). Idempotent; depends on 0019 (`my_scope()`, `enrollment_visible()`).
   ⚠️ `0021_child_portal.sql` is **required** by بوابة المخدوم (`/child/*`) and `/settings/data-requests`. Creates `data_change_requests`, the `child_portal_*` RPCs (SECURITY DEFINER, granted to `anon`, keyed by the scanned national id), `review_data_change_request` / `pending_data_requests_count` (authenticated) and a storage policy letting the portal upload into `photos/child-requests/`. Idempotent; run after 0020.
   ⚠️ `0022_event_bound_operations.sql` is **required** by the current children page & scanner (points inserts send `event_id`; calls / messages insert into `contact_log`). Adds `points_log.event_id`, the `contact_log` table (RLS + realtime), scope-check triggers and an `event_name` column on `child_portal_points`. Idempotent; run after 0021.
   ⚠️ `0023_call_feedbacks.sql` is **required** for the call-feedback badge / modal / filter and `/settings/call-feedbacks`. Adds the `call_feedbacks` table (scope church/service/class/event, `color`, `icon`, `sort_order`, RLS, realtime) and `contact_log.feedback_id` + `contact_log.occurrence_on`. Idempotent; run after 0022. Without it the badge stays on «لم يُفتقد بعد» and the modal shows a migration hint.
   ⚠️ `0024_owner_module_access.sql` is **required** by وحدة المالك (`/owner/*`) and by the module sections of the side menu / settings. Adds `module_access` (owner-written grants: module → church/service/class, null = all), `module_visible(key)`, re-creates the card-module policies so `card_templates` / `card_print_requests` require `module_visible('cards')`, and **seeds one global grant for `cards`** so nothing disappears for existing users. Idempotent; run after 0023. Without it non-owners see no modules.
   ⚠️ `0025_shepherd_groups.sql` is **required** by وحدة الأشابين (`/shepherds`) and the «مجموعتي» button on the children page. Adds `shepherd_groups` (servant ↔ enrollment, **unique per enrollment**, scope filled by trigger), RLS gated by `module_visible('shepherds')`, the `shepherd_claims` / `shepherd_group_summary` RPCs and realtime. **No grant is seeded** — the owner enables the module per scope in وحدة المالك → صلاحيات الوحدات. Idempotent; run after 0024.
   ⚠️ `0026_points_store.sql` is **required** by وحدة إستبدال النقاط (`/store/*`) and by the store rows in the child portal points page. Adds `store_items`, `store_orders`, `store_order_items` (RLS gated by `module_visible('store')`), the `store_checkout` / `store_cancel_order` / `store_lookup_item` RPCs, replaces `child_portal_points` (new `source = 'store'` + `order_id` columns) and adds `child_portal_store_orders`. **No grant is seeded** — enable the module per scope in وحدة المالك → صلاحيات الوحدات. Idempotent; run after 0025.
   ⚠️ `0027_exams.sql` is **required** by وحدة الامتحانات (`/exams/*`, `/child/exams/*`) and by the exam rows in the points pages. Adds `exams`, `exam_questions`, `exam_attempts`, `exam_answers` (RLS gated by `module_visible('exams')`; attempts / answers are read-only through the API), the anon child RPCs `child_portal_exams` / `child_exam_start` / `child_exam_current` / `child_exam_answer` / `child_exam_result`, the servant RPCs `exam_attempt_detail` / `exam_cancel_attempt` / `exam_duplicate`, the helper `module_granted_for`, and replaces `child_portal_points` (new `source = 'exam'` + `attempt_id`). **No grant is seeded** — enable the module per scope in وحدة المالك → صلاحيات الوحدات. Idempotent; run after 0026.
   ⚠️ `0028_birthdays.sql` is **required** by وحدة أعياد الميلاد (`/birthdays/*`), the home birthdays widget and the birthday banner in the child portal. Adds `birthday_greetings` (person × year × kind, RLS gated by `module_visible('birthdays')`, scope filled by trigger, one gift per person per year), `birthday_card_templates` (same JSON design engine, scoped, one default per scope), `birthday_settings` (per church / global), the RPCs `birthdays_in_month` / `birthdays_upcoming` (security invoker → RLS) and `birthday_gift` / `birthday_gift_cancel` (SECURITY DEFINER; the gift is ONE `points_log` row), `next_birthday()` (Feb 29 → Feb 28), the anon `child_portal_birthday`, replaces `child_portal_points` (new `source = 'birthday'`) and an expression index on `persons(month, day)`. **No grant is seeded** — enable the module per scope in وحدة المالك → صلاحيات الوحدات. Idempotent; run after 0027.
   ⚠️ `0029_chat_messages.sql` is **required** by وحدة الرسائل (`/messages/*`, `/child/messages/*`, the header bells and the «رسالة داخلية» channel on the children page). Adds `chat_messages` (kinds `child | staff | broadcast_children | broadcast_staff`, scope denormalized, RLS gated by `module_visible('messages')`, writes only through RPCs) and `chat_read_state` (per reader × bucket), the servant RPCs `chat_send` / `chat_inbox` / `chat_thread` / `chat_mark_read` / `chat_staff_recipients` / `chat_audience_count` / `chat_unread_total`, the anon child RPCs `child_chat_overview` / `child_chat_messages` / `child_chat_send` / `child_chat_mark_read` / `child_chat_unread`, a storage policy for `photos/child-messages/`, realtime. **No grant is seeded** — enable the module per scope in وحدة المالك → صلاحيات الوحدات. Idempotent; run after 0028. (This replaces the reverted PR #51 module; it does **not** depend on it — if the old `0029_messaging.sql` was applied, run `supabase/rollbacks/0029_messaging_rollback.sql` first.)
   ⚠️ `0030_online_classes.sql` is **required** by وحدة الفصول الأونلاين (`/online/*`, `/child/online/*`, the child home card and side-menu entry). Adds `online_classes` (+ per-class attendance rules), `online_class_participants`, `online_class_sessions`, `online_class_checks`, `online_class_check_responses`, `online_class_questions`, `online_class_answers`, `online_class_messages` — RLS gated by `module_visible('online')`; the servant RPCs `online_class_start` / `online_class_end` / `online_class_finalize` / `online_class_reopen` / `online_class_send_check` / `online_class_set_override` / `online_class_live_stats` / `online_class_messages_list`; the anon child RPCs `child_online_classes` / `child_online_class` / `child_online_join` / `child_online_heartbeat` / `child_online_leave` / `child_online_check_respond` / `child_online_answer` / `child_online_messages` / `child_online_chat_send`; recreates `child_portal_points` (new source `online`) and `child_portal_attendance` (labels online rows); realtime. **No grant is seeded** — enable the module per scope in وحدة المالك → صلاحيات الوحدات. Idempotent; run after 0029.
   ⚠️ `0031_achievements.sql` is **required** by وحدة الإنجازات (`/achievements`, `/child/achievements`, the «الإنجازات» job on the children page, the child home card and side-menu entry). Adds `achievements` (scope church → service? → class? → event?, `kind` `normal | attendance`, `award_mode` `once | multiple` + `max_awards` / `min_interval_days`, `attendance_rule` `count | streak` + `attendance_target`) and `user_achievements` (per enrollment: points, date, `awarded_by`, `source` `manual | attendance`, linked `attendance_log_id` / `event_id` / `points_log_id`) — RLS gated by `module_visible('achievements')`; the RPCs `achievement_permissions` / `achievement_progress` / `achievement_enrollment_progress` / `achievement_award` / `achievement_revoke` / `achievement_earners`; the **auto-award trigger** `zz_trg_achievements_on_attendance` on `attendance_log`; the anon child RPC `child_portal_achievements`; recreates `child_portal_points` (new source `achievement`); realtime. **No grant is seeded** — enable the module per scope in وحدة المالك → صلاحيات الوحدات. Idempotent; run after 0030.
   ⚠️ `0038_exam_results.sql` is **required** by وحدة نتائج الامتحانات (`/results/*`). Adds `grading_systems` + `grading_grades` (percent bands), `result_exams` (scope church → service? → class?, status, grading system, `grade_overall` / `grade_subject`, `pass_rule` overall | subjects | both, `pass_percent`, `absent_as_zero`, `min_required_subjects`, `locked` + audit, `published_at`), `result_subjects` (full / pass degree, weight, order, bonus) and `exam_results` (one row per enrollment × subject: score, status draft | completed | absent | excused, note, computed `percent` / `grade_id` / `passed`, created / edited by). All computation happens in triggers + `result_summary_core` / `result_exam_summary` (totals, weighted percent, overall grade, pass / fail, competition ranking `rank` by percent and `rank_score` by total). RPCs: `result_permissions`, `result_save_bulk`, `result_copy_from_exam`, `result_clear`, `result_exam_set_lock` (only path to lock / unlock), `result_exam_duplicate`, `grading_system_duplicate`, `result_student_history`, anon `child_portal_results`. RLS gated by `module_visible('results')` + `result_can(key)` (managers of the scope get everything; class servants need permission profiles for `results.enter / edit / import / export / manage_* / lock`); scope enforced with `scope_overlaps` / `scope_contains` / `enrollment_visible`. Seeds a global default grading system (Grade 1..5). Idempotent; run after 0037. Test: `supabase/tests/exam_results_test.sql`.
   ⚠️ `0040_code_system.sql` is **required** by نظام الأكواد (`/owner/customize/codes`). Extends `validate_app_settings()` for the `codes` key; adds `render_code(template, scopes, church, service, class, now)` (SQL mirror of `renderTemplate`), `code_template_for(kind)`, `new_person_code(...)` (used by `add_person_and_enroll` when no code is given), `occasion_new_ticket_code(church, service, class)` (replaces the zero-arg version — ticket codes follow the owner's design) and the anon-safe `code_settings()` RPC used by the signup page. Idempotent; run after 0037.
   ⚠️ `0039_library.sql` is **required** by وحدة المكتبة (`/library/*`, `/child/library/*`). Adds `library_subjects`, `library_books` (pdf_url), `library_lectures` (kind video | voice, media_url, thumbnail_url, lecture_date) and `library_favorites` (servant `user_id` or child `person_id` × book | lecture). Each content row carries an **audience** (`everyone | servants | service | class` + church / service / class ids) checked with `scope_overlaps` (read) / `scope_contains` (write). Helpers: `library_can(key)`, `library_permissions()`, `library_audience_visible / _writable`, `library_subject_visible`; anon RPCs `child_portal_library(nid)` and `child_portal_library_favorite(nid, book, lecture, on)` (module must be granted for the child's enrollment). Links only — no storage. Idempotent; run after 0037. Test: `supabase/tests/library_module_test.sql`.
   ⚠️ `20260923120000_owner_persons_management.sql` is **required** by **وحدة المالك → إدارة الأفراد** (`/owner/persons`). Adds the owner-only RPCs `owner_persons_page`, `owner_persons_counts`, `owner_bulk_enroll`, `owner_bulk_unenroll`, `owner_bulk_delete_persons` (see the section above). Without it the page shows a «تحديث قاعدة البيانات مطلوب» notice. Idempotent; run after 20260922120000.
   ⚠️ `20260925130000_activity_permissions_and_person_modules.sql` is **required** by the fine-grained activity keys in ملفات الصلاحيات and by «أشخاص محددون» in صلاحيات الوحدات. Adds `activity_item_can(key)` / `activity_item_permissions()`, re-creates the RLS of `events` · `causes` · `call_feedbacks` · `data_change_requests` (scope **and** key), BEFORE-trigger guards for `is_default` (`*.set_default`; the 0048 cascade marks itself with `app.default_cascade`) and `call_feedbacks.sort_order` (`feedbacks.reorder` vs `feedbacks.edit`), `review_data_change_request` checks `approve` / `reject`; adds `module_access.servant_id` (person grant, null scope, unique per module × servant; the scope-unique index now ignores person grants), updates `module_visible`, the `module_access` select policy and the child-portal helpers `module_granted_for` / `notif_module_covers` (person grants are not «all churches»). Without it class servants without profiles can still write events / causes (old behaviour) and the person picker fails with «تعذر الحفظ». Idempotent; run after 20260925120000. Test: `supabase/tests/activity_permissions_test.sql`.
   ⚠️ `20260922120000_backup_restore_fk_order.sql` — **bug fix: restoring a backup failed with `insert or update on table "app_settings" violates foreign key constraint "app_settings_updated_by_fkey"`.** The schema has an FK **cycle** (`persons.created_by / edited_by → servant_enrollments`, `servant_enrollments.person_id → persons`, `servant_enrollments.approved_by → servant_enrollments`); 0044's `backup_topo_order()` stopped at the first cycle and appended the **whole remainder alphabetically**, so `app_settings` (and ~55 other tables with `*_by` columns) were applied **before the servants**. Fix: cycle-aware order (when stuck, take the table whose **NOT NULL** parents are all done — its nullable references are deferred); `backup_restore_apply_chunk` is now **two-phase** — a nullable FK whose parent is not there yet is inserted as **NULL** and remembered in `backup_restore_fixups`, then **`backup_restore_fixup(job)`** re-attaches them once every table is in; a row whose NOT NULL parent lives outside `public` (`servant_enrollments.id → auth.users`) and is missing is **skipped and reported** instead of aborting; replace mode detaches nullable NO ACTION references before deleting so a cycle cannot block the delete. Result per table: `upserted · deleted · detached · deferred · resolved · unresolved (+samples) · skipped (+samples)`. The client (`src/lib/backup.ts`) now restores **login accounts FIRST**, calls `backup_restore_fixup` before `finish`, translates FK / unique / not-null errors to Arabic, marks a run `partial` with the warnings when something was left `NULL`. Tests: `backup_restore_test.sql` (sections H · I reproduce the cycle) + new **`backup_restore_e2e_test.sql`** (dump every table of the seeded DB → wipe → restore → identical counts). Idempotent; run after 0051.
   ⚠️ `0051_fix_app_settings_names_validation.sql` — **bug fix: saving «الأسماء المخصصة» failed since 0040.** `validate_app_settings()` (rewritten by 0040) declared a PL/pgSQL loop record `kv` that shadowed the SQL alias `kv` used by the older `names` check, so every write of `app_settings.names` raised `record "kv" is not assigned yet` (تخصيص التطبيق → الأسماء could not save; the seed script hit it too). Recreates the function with the loop record renamed; all checks unchanged. Idempotent; run after 0050.
   ⚠️ `0049_card_print_profiles.sql` — **ملفات الطباعة + service / class logos on cards**. Adds `card_print_profiles` (name · `settings` jsonb · scope church → service → class, `church_id NULL` = shared; RLS gated by `module_visible('cards')`, read by `scope_overlaps`, write by `can_access`; `touch_edited` trigger; realtime; activity-log audit + registered in `activity_audited_tables()`), and re-creates `child_portal_birthday()` so `constants` carries `service_logo_url` / `class_logo_url` (needed by the new «شعار الخدمة» / «شعار الفصل» card elements in the child portal). The staff screens read `services.photo_url` / `classes.photo_url` directly — the logo elements work without this migration; only the saved-profiles bar needs it (it hides itself until then). Idempotent; run after 0048. Test: `supabase/tests/card_print_profiles_test.sql`.
   ⚠️ `0048_scoped_defaults.sql` — **defaults per scope** (church → service → class) for `events` / `causes`. Adds the triggers `trg_events_default_scope` / `trg_causes_default_scope` (one `is_default` per exact church / service / class; other levels untouched), a one-off cleanup of legacy duplicates (latest edited wins), partial indexes `idx_events_default_scope` / `idx_causes_default_scope`, and the resolvers `default_event_for(church, service, class)` / `default_cause_for(...)` (security invoker, most specific first). The app no longer clears every other default before saving. Idempotent; run after 0047. Test: `supabase/tests/scoped_defaults_test.sql`.
   ⚠️ `0047_activity_log.sql` is **required** by وحدة سجل النشاط (`/activity`). Adds `activity_log` (actor kind / id / name / role · table · op INSERT | UPDATE | DELETE | EVENT · `action` key · `changed[]` · row / target person / target name / enrollment · church / service / class · `old_data` / `new_data` (trimmed, secrets stripped) · `meta` · `batch_id` / `batch_size` · source) and a **generic statement-level audit trigger** (`activity_audit`, transition tables → one call per statement) attached by `activity_audit_attach(table)` to every business table listed in `activity_audited_tables()` (skips staging / heartbeat / token tables). Actor resolution: `auth.uid()` → servant; `child_portal_person()` now stamps `app.child_actor` on the transaction → child; otherwise system. `activity_action_key()` maps table + op (+ status flips) to stable keys (`attendance.add`, `points.deduct`, `servant.approve`, `enrollment.stop`, `result_exam.lock` …). RPCs: `log_activity(action, person, enrollment, meta, scope)` for app events (anon may log `auth.*` only), `child_portal_log_activity(token, …)`, `activity_feed(filters, limit ≤ 1000, before, before_id)` keyset page, `activity_summary(filters)`, `activity_actors(filters)`, `activity_person_history(person)`, `activity_permissions()`, `activity_settings()` / `activity_settings_set()` (`app_settings.activity.keep_days`), `activity_prune(days)`. RLS: `activity_row_visible` (owner all · church manager / `activity.view_all` whole church · `activity.view` own scope). Realtime: joins the 0046 bus, throttled to one message per 3 s (`rt_gates`). `set_config('app.audit_off','1')` silences the trigger inside a transaction. Idempotent; run after 0046. Test: `supabase/tests/activity_log_test.sql`.
   ⚠️ `0046_realtime_broadcast_scale.sql` is **REQUIRED by the current frontend for live updates at scale** (fixes the lag / failures seen with 60–80 concurrent servants). Moves the hot tables (`attendance_log`, `points_log`, `contact_log`, `enrollments`, `persons`, `notification_recipients`, `chat_messages`, `chat_read_state`, `store_orders`, `card_print_requests`, `user_achievements`, `servant_enrollments`, `servant_scopes`) OUT of the `supabase_realtime` publication and adds statement-level triggers that `realtime.send()` **one broadcast message per statement** on `scope:all` / `scope:church:<id>` / `user:<uid>` topics (RLS policy on `realtime.messages` via `rt_topic_allowed`). Also: `pg_trgm` GIN indexes on `persons(name / phone / national_id)` for the search box, composite indexes for the list/badge queries, `notif_dispatch_gate()` + `rt_gates` so the push dispatcher runs at most once per 45 s across all devices. Idempotent; run after 0045. **Until it is applied the app still works**: hot-table screens fall back to a 45 s poll + refresh on focus. Test: `supabase/tests/realtime_broadcast_test.sql`.
3. **Authentication → Providers → Email**: disable "Confirm email"
4. Login in the app with code `000000` + password `000000`
5. ⚠️ **Immediately** change both in **الإعدادات → تعديل بياناتي** (the e-mail `<code>@diocese.app` follows the code automatically)

   **Who can change a login code** (`/api/servants/account` · `change_code`):
   | Actor | Own code | Another servant's code |
   |---|---|---|
   | owner | ✅ **تعديل بياناتي** — pencil button → generate / scan / type → confirm → save (the only self-service code change in the app) | ✅ إدارة الخدام |
   | church / service manager | ❌ read-only | ✅ within his scope (never the owner's) |
   | class servant | ❌ read-only | ❌ |
   Passwords are unchanged: everyone changes his **own** password (old + new) in تعديل بياناتي; a superior resets a forgotten one from إدارة الخدام.

### 1a. Database migrations — automatic deploy (CI)
`supabase/config.toml` · `.github/workflows/supabase-migrations.yml` (shipped as `supabase/scripts/github-workflow-supabase-migrations.yml` — move it there, see one-time setup) · `supabase/scripts/`

Migrations are deployed by **GitHub Actions** — nothing is pasted into the SQL editor any more.

| Event | What runs |
|---|---|
| Pull request → `main` touching `supabase/migrations/**` | `check_migration_names.sh` (file-name lint) → `supabase db push --dry-run` against production — the job log lists exactly which files **would** be applied |
| Push / merge to `main` | `supabase db push --linked --yes` — applies **only** the files not yet in `supabase_migrations.schema_migrations`, in version order. Runs in the `production` environment (add required reviewers there if you want a manual approval gate). |
| `workflow_dispatch` | same as push — re-run the deploy by hand |

**One-time setup**
1. Move the workflow into place (the PR bot could not write to `.github/`): `git mv supabase/scripts/github-workflow-supabase-migrations.yml .github/workflows/supabase-migrations.yml` and commit.
2. Repository → Settings → Secrets and variables → Actions → add:
   - `SUPABASE_ACCESS_TOKEN` — https://supabase.com/dashboard/account/tokens
   - `SUPABASE_PROJECT_ID` — the 20-character project ref (dashboard URL / Project Settings → General)
   - `SUPABASE_DB_PASSWORD` — Project Settings → Database
3. **Existing database (set up through the SQL editor):** run `supabase/scripts/baseline_migration_history.sql` once in the SQL editor. It only inserts the versions `0001 … 0051` into the history table — no schema change — so the first CI push does not try to re-apply them (including `0002`, so no second owner `000000` is created on a database that already has its owner). (`supabase migration list --linked` should then show every file on both sides.)
4. Optional: Settings → Environments → `production` → *Required reviewers* for a click-to-approve before each deploy.

**File-name rules (the CLI enforces the first, CI enforces all)**
- Only `<version>_<name>.sql` is a migration: `^[0-9]+_.*\.sql$`. Anything else in `supabase/migrations/` is **silently skipped** by the CLI — the lint step turns that into a failure.
- The digits before the first `_` are the **version** = primary key of the history table and the **sort key**. Files are applied in **string order** of the version. Because `"0051" < "20260921120000"` the old 4-digit files always sort before the new timestamped ones — no renaming of the existing 0001…0051 files was needed (and renaming an applied file would break the history).
- **New migrations must be timestamped** — `YYYYMMDDHHMMSS_snake_case_name.sql` (UTC). Always create them with the CLI so the timestamp is correct:
  ```bash
  npx supabase migration new add_something      # → supabase/migrations/20260921153012_add_something.sql
  ```
  A new file whose version is **lower** than one already applied is refused by `db push` ("Found local migration files to be inserted before the last migration on remote database") — regenerate the timestamp if a PR sat open while another migration was merged.
- **Never edit, rename or delete an applied migration.** The CLI will not re-run it; write a new migration instead. CI prints a warning when it sees this.
- Keep migrations **idempotent** (`if not exists`, `create or replace`, `drop … if exists`) as every file in this repo already is — a failed push can then simply be re-run.
- `db push` runs each file as one batch on one connection and records the version at the end of that batch. Enum values added with `alter type … add value` cannot be *used* in the **same** file (the `0005` note above) — put the usage in the next migration.
- Scripts that are **not** migrations (`baseline_migration_history.sql`, the seed / wipe / reset files, `tests/`, `rollbacks/`) live outside `supabase/migrations/` on purpose.

**Day-to-day**
```bash
npx supabase migration new <name>             # create the file, write SQL in it
npx supabase db push --dry-run --linked       # optional local preview (needs `supabase link` once)
git add supabase/migrations && git commit && git push   # open PR → dry-run job → merge → deploy job
bash supabase/build_full_schema.sh            # optional: refresh full_schema.sql for manual installs
```
If a push fails half-way: fix the SQL (files are idempotent), re-run the workflow (`workflow_dispatch`). To skip a file that was applied by hand: `supabase migration repair --status applied <version> --linked`.

### 1b. Demo / test data — `seed_test_data.sql` & `wipe_test_data.sql`
Two one-file scripts to **fill the whole database with realistic Arabic demo data** (every table, every module) and to **wipe it back to a clean install**. Run them in the SQL Editor after `full_schema.sql` (steps 3–5 are **not** needed — the seed creates its own login accounts).

| Script | What it does |
|---|---|
| `supabase/seed_test_data.sql` | **Up to date with migration 0051.** 2 churches · 3 services · 5 classes · 8 servant accounts (owner → pending request → **suspended**) · **extra servant scopes** (a servant in two classes, 0045) with their **mirror enrollments** (`kind = servant`, created by the trigger) · 26 children / 27 child enrollments (one in two classes, **one stopped** — 0043) · **child portal accounts** (bcrypt passwords, one on the default `000000`, live / «تذكرني» / expired sessions with known test tokens, pending / rejected / approved **join requests** — 0042) · 8 events incl. **scoped defaults** per church / service / class (0048) · 8 weeks of attendance · points / deductions · calls & messages with feedback · data-change requests · card templates + print queue · shepherd groups · store items + completed / cancelled orders · online exams (published / draft / closed) with attempts · birthdays (today / +2d / +6d) with gift · chat (child · staff · broadcasts) · online classes (ended & finalized · **live now** · scheduled · cancelled) · occasions (trip · conference · celebration tomorrow · completed) with tickets & checklist · manual + automatic notifications, push subscriptions · results module (grading systems, locked exam, open exam, archive) · library (subjects / books / lectures / favorites) · **card print profiles** (shared / church / service / class — 0049) · **report templates** for every data source (0050) · **backup schedules + run history** incl. a failed run and a restore (0044) · **activity log**: every seeded row is audited under the servant who «did it» (the script switches `auth.uid()` per section) plus app-level events — logins / logouts over 10 days, QR scans, exports, prints, a failed login, child-portal events (0047) · module grants (incl. `activity`, `reports`) · permission profiles · home widgets / names / navigation / **code system** (0040) / activity retention. Ends with a row-count summary. **Run once** (fixed UUIDs). |
| `delete_database.sql` (repo root — **outside** `supabase/`, never picked up by the CLI / migrations) | **Delete the whole database** — `DROP SCHEMA public CASCADE` (every table + data, view, function, trigger, enum, sequence, policy) then re-creates `public` empty with the standard Supabase grants; truncates `auth.users` (→ identities / sessions), deletes every storage object **and the buckets** + the app's `storage.objects` / `realtime.messages` policies, unschedules pg_cron jobs, and empties `supabase_migrations.schema_migrations` so `supabase db push` re-installs from 0001. Leaves the project as if the app was never installed. Idempotent; prints a report (all 0). Run by hand only: SQL Editor → paste → Run. ⚠️ irreversible — back up first. |
| `supabase/reset_system.sql` | **Factory reset** — `TRUNCATE … CASCADE` every public table, deletes **every** login account (auth.users + identities + sessions), clears **every** uploaded file (photos · logos · backups; buckets stay), restores the `cards` module grant, and **optionally re-creates the owner** in the same run (edit `owner_code` / `owner_password` / `owner_name` at the top; `owner_code = ''` → no owner, use `supabase/migrations/0002_bootstrap_owner.sql` instead). Schema / functions / policies stay — no re-migration needed. Prints what is left. |
| `supabase/wipe_test_data.sql` | `TRUNCATE … CASCADE` every public table (catalogue-driven — new tables such as `activity_log`, `child_sessions`, `backup_*`, `report_templates` are picked up automatically; runs with `app.audit_off` so the wipe leaves no activity rows), deletes the seeded auth users (and, by default, every auth user left without a servant row — flip `seed_only` inside to keep real accounts), clears storage objects, restores the `cards` module grant that `0024` seeds, prints what is left (should be 0). Schema / functions / policies stay. |

**Demo logins** (password `Test@1234` for all — the login name is the code):

| الدور | الكود | النطاق |
|---|---|---|
| مالك التطبيق | `10000000000001` | everything |
| مدير كنيسة | `10000000000002` | كنيسة العذراء — الأقصر |
| مسؤول خدمة | `10000000000003` | مدارس الأحد |
| خادم فصل | `10000000000004` | إعدادي |
| خادم فصل | `10000000000005` | ابتدائي |
| خادم فصل | `10000000000006` | كنيسة مارجرجس |
| طلب معلق | `10000000000007` | shows in طلبات الانضمام |
| خادم موقوف | `10000000000008` | suspended — login refused, mirror enrollment «موقوف» |

`10000000000004` (جورج) also serves in فصل ثانوي through `servant_scopes`; `10000000000005` (مارينا) has a service-level extra scope on اجتماع الشباب.

**Child portal** (`/child` — code **+ password** since 0042): every child `30101010100001 … 30201010100026` → password `123456`, except `30101010100005` (أبانوب) who never had one set → default `000000`. `30101010100021` (بيتر) is **stopped** → `account_stopped`. `30101010100001` (birthday today) · `30101010100009` (top student) · `30101010100013` (needs follow-up). Pending join requests: `30101010100099`, `30101010100098`. Known live session tokens for calling `child_portal_*` RPCs directly: `seed-token-01` (يوسف, remember-me) · `seed-token-09` (مينا) · `seed-token-13` (أنطونيوس).
Both scripts also run on the local shim: `psql -d app -f supabase/seed_test_data.sql` / `… wipe_test_data.sql`.

### 2. Local dev
```bash
cp .env.example .env.local   # fill in Supabase URL + anon key
npm install
npm run dev
```

### 3. Deploy to Vercel
1. vercel.com → New Project → import this GitHub repo
2. Add env vars: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
3. (Optional) add the **PWA branding** variables below
4. Deploy — done. PWA is installable from the browser.

### 3a. Deploy to Cloudflare Workers (in parallel with Vercel)

The same repo can be deployed to **both** Vercel and Cloudflare at the same
time — every push to `main` builds on both platforms. Vercel keeps using the
plain `next build`; Cloudflare uses the **OpenNext Cloudflare adapter**
(`@opennextjs/cloudflare`) which converts the Next.js build into a Worker.

**Why the first attempt failed.** Cloudflare *Pages* with framework preset
"Next.js" uses `@cloudflare/next-on-pages`, which only supports the *Edge*
runtime — this app's API routes (`web-push`, `sharp`, the Supabase service
role) run on the Node runtime, and a Next.js 14 app with middleware + route
handlers does not build there. The supported path today is **Cloudflare
Workers + OpenNext** (Pages is not needed).

Files that make it work (all ignored by Vercel):

| File | Purpose |
|---|---|
| `wrangler.jsonc` | Worker config: name, `nodejs_compat`, static assets, the two daily **crons** (no service/R2/KV/D1 bindings — nothing to create before the first deploy) |
| `open-next.config.ts` | OpenNext adapter config (default no-op cache — the app is fully dynamic, no ISR, so no R2/KV/D1 bindings are needed) |
| `cloudflare/worker.ts` | Thin custom Worker: re-uses the generated `fetch` handler and adds a `scheduled` handler that calls `/api/backup/cron` and `/api/notifications/dispatch` on the cron ticks (same schedule as `vercel.json`) |
| `public/_headers` | Immutable cache headers for `/_next/static/*` |
| `.dev.vars.example` | Template for local `wrangler` preview variables |
| `src/app/branding/[kind]/[size]/route.ts` | `sharp` is loaded lazily — on Workers (no native addons) the icon route redirects to the source image instead of resizing it |

npm scripts: `cf:build` (build only) · `cf:preview` (build + run locally in
workerd) · `cf:deploy` (build + deploy) · `cf:upload` (build + upload a
version without activating it).

#### Option A — Git-connected (automatic, like Vercel)
1. Cloudflare dashboard → **Workers & Pages → Create → Workers → Import a repository** → pick this GitHub repo.
2. Build settings:
   - **Build command**: `npm run cf:build`
   - **Deploy command**: `npx wrangler deploy`
   - Root directory: `/` · Node version: 20+ (default is fine)
3. **Build variables** (Settings → Build → Variables and Secrets) — needed because `NEXT_PUBLIC_*` are inlined at build time:
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_VAPID_PUBLIC_KEY` and the optional `NEXT_PUBLIC_*` branding variables (§ 4).
4. **Runtime variables & secrets** (Settings → Variables and Secrets): the same `NEXT_PUBLIC_*` again plus the server secrets
   `SUPABASE_SERVICE_ROLE_KEY`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `CRON_SECRET` (optional, protects the cron routes — the scheduled handler sends it as `Authorization: Bearer`).
5. Save & deploy. The Worker is served at `https://diocese-management.<account>.workers.dev`; add a custom domain under Settings → Domains & Routes.
6. Production branch = `main` → both Vercel and Cloudflare redeploy on every merge. (Use only one of them for the crons if you don't want the daily jobs to run twice — remove `triggers.crons` from `wrangler.jsonc` or the `crons` from `vercel.json`. Both jobs are idempotent, so running twice is harmless, just redundant.)

#### Troubleshooting the Cloudflare build
| Symptom in the build log | Cause | Fix |
|---|---|---|
| `Executing user build command: npm run build` (instead of `npm run cf:build`) | Build command not changed from Cloudflare's default | Settings → Build → **Build command** = `npm run cf:build`, **Deploy command** = `npx wrangler deploy` |
| `Error: @supabase/ssr: Your project's URL and API key are required to create a Supabase client!` repeated for every page, then `Export encountered errors on following paths` | `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` are not set as **build** variables (they are inlined by `next build`; runtime variables alone are not enough) | Settings → **Build → Variables and secrets** → add both (copy the values from Vercel). `npm run cf:build` now runs `cloudflare/preflight.mjs` first and fails immediately with this exact instruction instead of 2 minutes later |
| `Missing entry-point` / `wrangler deploy` can't find `.open-next/worker.js` | Build ran `next build` only | Same as the first row — the OpenNext step is part of `cf:build` |
| `Service binding 'WORKER_SELF_REFERENCE' references Worker '…' which was not found [code: 10143]` | A `services` self-binding pointed at a Worker name that doesn't exist yet (first deploy) or differs from `name` (after a rename) | Removed — the app has no ISR so the binding isn't needed. If you re-add it, `service` must equal `name` exactly and the Worker must already exist |
| `Total Upload: … / gzip: 2435 KiB` then a size error | Free plan allows 3 MiB compressed; the server bundle is ~2.4 MiB today, so there is headroom but not much | Workers Paid plan ($5/mo → 10 MiB) if it grows past the limit |

#### Option B — from your machine / CI
```bash
cp .dev.vars.example .dev.vars       # runtime vars for local preview
npm run cf:preview                   # runs the Worker locally in workerd (http://localhost:8787)
npx wrangler login
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY   # repeat for each secret
npm run cf:deploy
```

Notes
- **Verified in workerd** (local `wrangler dev` of the OpenNext build): middleware redirect `/` → `/login`, pages render (RTL), API route with `web-push` + `supabase-js` under `nodejs_compat`, `CRON_SECRET` 401/200, `/branding/icon/*` fallback + no-`sharp` redirect, `/manifest.json` redirect, `_headers` immutable caching, and both `scheduled` cron triggers (`curl "http://localhost:8787/__scheduled?cron=0+3+*+*+*"` with `wrangler dev --test-scheduled`).
- **Worker size**: `wrangler` prints the compressed size on each deploy; the free plan allows 3 MiB, the paid plan 10 MiB. The server bundle is large (Next.js runtime + `xlsx`/`jspdf` are client-side, so they don't count) — if the free limit is exceeded, the $5/month Workers Paid plan removes the constraint.
- **Timeouts**: `maxDuration = 60` is a Vercel setting; Workers have no wall-clock limit but 30 s CPU (paid: configurable). The cron routes do mostly I/O, so this is fine.
- **Image optimizer**: `images.unoptimized = true` is already set, so `/_next/image` is never used on either platform.
- **Supabase**: no change — both deployments talk to the same project. Add the Cloudflare URL to **Supabase → Authentication → URL Configuration → Redirect URLs** if you use magic links / OAuth.
- The `.open-next/` and `.wrangler/` directories are build output and git-ignored.

### 4. PWA branding via Vercel environment variables (`src/lib/branding.ts`)
The app name, app icon, diocese name and diocese logo are **not hard-coded**:
they are read from environment variables so the same repo can be deployed for
any diocese. Set them in **Vercel → Project → Settings → Environment
Variables** and **redeploy** (they are `NEXT_PUBLIC_*`, i.e. inlined at build
time). Every variable is optional — an empty value keeps the built-in default
(**Diocese Management App** / **D.M.A** + the bundled D.M.A logo in `/public/icons`, master copy `assets/diocese-logo.png`).

| Variable | Used for | Default |
|---|---|---|
| `NEXT_PUBLIC_APP_NAME` | manifest `name`, `applicationName` | Diocese Management App |
| `NEXT_PUBLIC_APP_SHORT_NAME` | home-screen label (manifest `short_name`), iOS title, push title fallback, footers | D.M.A |
| `NEXT_PUBLIC_APP_DESCRIPTION` | manifest / meta description | Diocese Management App — تطبيق إدارة كنائس وخدمات الإيبارشية |
| `NEXT_PUBLIC_APP_ICON_URL` | **app icon** — public URL of a square image ≥ 512px (PNG/JPG/WebP/SVG, e.g. Supabase Storage). PWA icons (96/192/512, any + maskable), favicon, apple-touch-icon (180), push notification icon/badge, offline page | bundled D.M.A logo `/icons/*` |
| `NEXT_PUBLIC_DIOCESE_NAME` | **diocese name** — `<title>`, header fallback (staff + child portal) before a church is resolved, login / signup / child-login headings, offline page | Diocese Management App |
| `NEXT_PUBLIC_DIOCESE_LOGO_URL` | **diocese logo** — header fallback avatar and the login / signup / child-login logo | app icon |
| `NEXT_PUBLIC_THEME_COLOR` | manifest `theme_color`, browser UI colour | `#1e3a8a` |
| `NEXT_PUBLIC_BACKGROUND_COLOR` | manifest `background_color`, icon flatten colour | `#001f4e` (navy of the D.M.A logo) |

How it works:
- `src/app/branding/manifest/route.ts` generates the manifest at `/branding/manifest?v=<hash>` at build time from the variables (replaces the old static `public/manifest.json`; not `app/manifest.ts` because that convention injects an un-versioned link).
- `src/app/branding/[kind]/[size]/route.ts` serves `/branding/icon/{96|180|192|512}` and `/branding/logo/{size}`: it fetches the configured URL, crops it square with `sharp`, flattens it on the background colour and returns a PNG (CDN-cached 7 days). When no URL is set — or the fetch fails — it redirects to the bundled `/icons/*`, so nothing ever breaks.
- `src/app/offline/route.ts` renders the offline page with the diocese name / icon (replaces `public/offline.html`).
- `public/sw.js` is registered as `/sw.js?b=<branding hash>&n=<short name>` (`PwaRegister`). Changing any variable changes the hash → browsers install a fresh worker and drop the old brand's cache. Push notifications use `/branding/icon/*` and fall back to the short name as title.
- Tip: upload the icon/logo to a **public** Supabase Storage bucket (e.g. `church-logos`) and paste the public URL into the variable.
- Every branded URL (`/branding/icon/192?v=…`, `/branding/manifest?v=…`) carries the branding hash, so a variable change gives new cache keys everywhere (browser, Vercel CDN, service worker); the bundled-icon fallback redirect is `no-store`.

**Troubleshooting — the deployment URL shows the new icon but the production domain shows the old one**
1. In Vercel the variable must be enabled for the **Production** environment (the env-var dialog has Production / Preview / Development checkboxes — a preview-only value never reaches the main domain). Check *Settings → Environment Variables → filter: Production*.
2. Variables are inlined at **build** time: after adding/changing them trigger **Deployments → ⋯ → Redeploy** of the latest production deployment (or push a commit). Promoting an existing build does not re-read them.
3. On the phone, a previously **installed** PWA keeps the icon it was installed with — Android/iOS only refresh home-screen icons occasionally (Chrome checks the manifest roughly daily). Remove and re-add the app to the home screen to see the new icon immediately. The in-page logo / title update on the next visit.

## Card Designer Module (تصميم الكروت) — migrations 0017 + 0018 (+ 0049 print profiles)
Design & print ID cards for the children. `/settings/cards` lists templates
(scoped church → service → class like events/causes, table `card_templates`,
JSONB `design` + `print_settings`, schema in `src/lib/card-types.ts`).
Each template row has a gold 🔗 rebind button — re-bind the design to another
church / service / class (with "كل الـ..." options) without redesigning.

**Design tab** (`/settings/cards/[id]`):
- Card width / height / corner roundness in mm (presets: CR80 ID, A6, A7, square)
- Background: color, uploaded image with fit mode (cover/contain/stretch/tile) + opacity, border color/width
- Elements (drag to move, layer up/down, rotate, opacity, corner radius):
  - **Variables** per child: name, age (computed), birthdate, phone, national id, address, photo, QR (national id = scanner code)
  - **Constants**: church / service / class names, **church logo · service logo · class logo** (`churches.logo_url` / `services.photo_url` / `classes.photo_url` — each follows the printed person's own church / service / class, empty placeholder when no picture is uploaded; 0049), free text, uploaded image
- Text style per element: 10 fonts (8 Arabic Google fonts + Arial/Times), size (pt), color, bold/italic, align
- Per-element **box background** (color + opacity) and **stroke** (border that follows the element's rounded corners, color + width in mm)
- **Lock aspect ratio** per element (resize handles + W/H inputs keep the ratio; QR defaults to locked)

### Card back (ظهر الكارت) + flips — no migration needed
Every template can carry a **back face** designed with the same engine as the
front. Stored inside the existing `design` JSONB: the top-level
`background / border / elements` **are the front** (unchanged, so every stored
template keeps working); the back lives in `design.back = { enabled,
background, border, elements, flipH, flipV }` (`normalizeDesign` fills it for
old rows; `hasBack(design)`; `faceDesign(design, 'front' | 'back')` returns one
face as a stand-alone `CardDesign` so every renderer keeps taking a plain
design). Types in `src/lib/card-types.ts`, layout math in
`src/lib/card-layout.ts`, shared print renderers in
`src/components/cards/PrintSheet.tsx`.

**Design tab** — the live preview shows **الوجه and الظهر next to each other**
(same size, same zoom); the face being edited has a ring and is the
interactive one (drag / handles), tapping the other face switches to it. A
**وجهي الكارت** card has the **الوجه | الظهر** selector, «إضافة ظهر للكارت»
(seeds a sample back: church name · free text · QR, with the front's border),
«إلغاء الظهر», «نسخ الوجه إلى الظهر / نسخ الظهر إلى الوجه» (new element ids),
«مسح عناصر الظهر». Every section below it (الخلفية · الإطار · العناصر ·
inspector) works on the **selected face**; the card size is shared. The
templates list shows a **«وجه + ظهر»** badge.

**Flip (قلب) a face** — per face **قلب أفقي** (`flipH`) / **قلب رأسي**
(`flipV`) mirror the whole face content (for transparent / thermal-transfer
media). `CardCanvas` applies the mirror to the content layer only; the
selection box, the handles and drag / resize deltas are mapped so the designer
keeps working in the *seen* direction.

**Print tab → ظهر الكارت** (`CardPrintSettings.backMode`, saved with the
template and inside **ملفات الطباعة**):
- **صفحة منفصلة (وجه ثم ظهر)** `separate` — a page of fronts is followed by a
  page of backs; the back page is **mirrored about the page centre**
  (`duplexMirror`: **أفقي** = flip on the long edge, usual for portrait ·
  **رأسي** = short edge · **بدون انعكاس**) so each back lands behind its front
  after duplexing. The preview shows both pages side by side; the page counter
  reads «N كارت ← 2M صفحة (M وجه + M ظهر)».
- **بجانب الوجه** `beside` — front (right) + back (left) in the same grid cell,
  `backGap` mm between them (0 = fold line).
- **أسفل الوجه** `below` — back under the front, same gap.
- **بدون ظهر** `none` — front only even when the design has a back.
A design without a back always prints as `none`. **قلب الصفحة كاملة**
(`flipPageH` / `flipPageV`) mirrors everything printed (preview + sheet).
Grid math: one cell = one *unit* (`unitDims`), `computeLayout()` gives
`cols × rows`, `cellLeft/Top` and the mirrored `backCellLeft/Top`.
The same panel (`BackPrintSettings`), preview (`PagePreview`) and hidden sheet
(`PrintSheet`) are used by the designer print tab, the bound print page
(`/settings/cards → الطباعة` — cell = the largest unit among the bound
designs, `separate` when any printed design has a back), the **bulk print**
tab (its preview shows front + back; `{{placeholders}}` on the back are
detected too) and the **birthday-card** print tab.

**Print tab**: paper size (A3/A4/A5/Letter/custom), orientation, 4 margins,
horizontal & vertical gaps between cards, cut marks, **page center lines**
(vertical / horizontal / both — shown in preview AND printed), **back side
mode + page flip** (above), live page preview with computed cols×rows layout
— prints via a mm-exact hidden sheet (`@page` sized, browser print dialog).

**ملفات الطباعة المحفوظة — saved print profiles (migration 0049)**: the bar at the
top of every print tab (designer print tab · bound print page `/settings/cards →
الطباعة` · birthday-card print tab) lists the profiles in table
`card_print_profiles` — a **named copy of the print settings** (paper ·
orientation · margins · gaps · alignment · cut marks · center lines · back
mode / duplex mirror / page flip).
**حفظ كملف** saves the current settings under a name + scope (church →
service → class; the owner can save a **مشترك** profile with `church_id NULL`
visible to everyone); **تطبيق** copies a profile into the template / page
(the template keeps its own copy, so deleting a profile never breaks a
template); per row: update with the current settings (💾), rename / rebind
(✎), delete. The bar shows which profile equals the current settings
(«الملف الحالي») and each row's `A4 طولي · 2×5 · هوامش 10` summary for the
current card size. RLS: read = shared rows + every profile whose scope
**overlaps** mine (`scope_overlaps`: a class servant sees his service's and
church's profiles); write = `can_access` (my level or below). Realtime
(`postgres_changes`), audited in سجل النشاط, included in backups. When the
migration is not applied the bar hides itself.

**Who to print** (من تريد طباعته؟):
- Church / service / class selectors, each with a "كل الـ..." (all) option —
  the printed card constants (church/service/class names, logo) follow each
  person's own enrollment, not the template scope. **The whole selected scope
  is loaded** (`fetchAllEnrollments` pages in 500s until the server runs dry,
  no cap, with a «تم تحميل N…» counter) — a church-wide print includes every
  child, not the first 1000 (PostgREST `max_rows`); the print queue and
  `birthdays_in_month` are paged the same way (`fetchAllRows`).
- **اختيار يدوي** — manual picker (search + select all) over the scoped children
- **المطلوب طباعتهم** — requested queue (table `card_print_requests`, migration
  `0018`, realtime): the children page has a "طباعة كارت" job — tapping the violet
  🖨 button on a child sends a print request; duplicates are rejected with a
  clear message (unique enrollment constraint). In the queue you can print all
  visible or only checked requests, delete one (✕), delete selected, delete all,
  and optionally auto-delete printed requests after printing (with confirm).

### Bulk Print tab — طباعة جماعية (`/settings/cards/[id]` → third tab)
Generate **hundreds / thousands of personalised cards from ONE template**
without touching the database: **Data → Template → Cards → Preview → Print**.
The Design and Print tabs are unchanged; the new tab only *reads* the
template's design + print settings (`src/components/cards/BulkPrintTab.tsx`,
`BulkSourcePanel.tsx`, `BulkPreviewPane.tsx`, helpers in `src/lib/bulk-print.ts`).

1. **البيانات — data source** (any mix, appendable):
   - **توليد أكواد** — N codes, **sequential** (start · step · zero-padded
     length · prefix / suffix → `A-001, A-002 …`) or **random** (length,
     charset letters+digits / digits / letters, unambiguous — no `0 O 1 I`,
     unique). Into a new column, an existing column, or a fresh table.
   - **لصق بيانات** — paste from Excel / Google Sheets (Tab · `,` · `;` or one
     value per line, quoted CSV honoured); *first row = headers* toggle;
     live preview.
   - **استيراد Excel** — xlsx / xls / csv (lazy `xlsx`), sheet picker, header
     row toggle, columns auto-detected, preview table.
2. **Editable table** — add / edit / delete rows (paged 50 per page), add /
   rename / delete columns, checkbox in the header = column **available to
   the design**, total card count badge, row selection (per page / all) for
   «print selected». Persisted per template in `localStorage`
   (`bulk-print:<templateId>`) so a reload keeps the data.
3. **الربط — connect data to the design**
   - **Dynamic fields**: every enabled column is a placeholder
     `{{column}}` (e.g. `{{code}} · {{name}} · {{class}} · {{service}} ·
     {{phone}}`) usable inside any **نص ثابت** element or a variable's
     «نص قبل القيمة» — mixed text is fine (`الفصل: {{class}}`). Copy chip
     per field + a one-click «add as text element to the design» button
     (then move / style it in the Design tab and save). Case-insensitive
     key match; unknown keys print empty and are flagged with a warning
     listing the design's placeholders that have no matching column.
   - **Mapping**: the template's standard elements (name · phone ·
     national id / **QR** · birthdate / age · address · photo URL · church /
     service / class constants) each read one column (auto-mapped from header
     synonyms, Arabic and English). Unmapped constants keep the template's
     values; with no QR mapping the first enabled column feeds the QR.
   - Implementation: `CardPersonData.fields?` + `fillPlaceholders()` in
     `CardCanvas.tsx` — opt-in, so ID / birthday cards render exactly as before.
4. **المعاينة — preview**: «كارت 15 من 100», first / prev / next / last, jump
   to number, slider, ← → keys, zoom, and the row's data listed next to the
   card to verify every field.
5. **الطباعة — print**: **all cards** · **range** (`1-50`, `3, 7, 20-30`) ·
   **selected rows**; page layout starts from the template's print settings
   (paper · orientation · margins · gaps · cut marks · center lines,
   editable locally without changing the template) plus **cards per page**
   (capped at the computed cols × rows); pages are created automatically
   (`N كارت ← M صفحة`, first-page preview); the hidden mm-exact sheet uses
   the same `CardCanvas` at `96/25.4 px/mm` with the **exact card
   dimensions from the template** — mounted only while printing so large
   sets (QR codes) stay fast.

## Status, attendance & points badges on the children page (سجل الحضور / سجل النقاط)
Each person card shows badges under the name — **status** first (only when an
event is selected), then attendance, then points:
- **Status badge** (`childEventStatus` in `src/lib/time.ts`) — the child's
  state in the selected event at the working date-time (`useAppDate`):
  - **حاضر (present)** — green: an `attendance_log` row exists for this event
    on the current occurrence day.
  - **لم يُسجّل (not registered)** — grey: not attended and we are *inside*
    the event's day/time (or before it starts).
  - **غائب (absent)** — red: not attended and we are *after* the event's
    date-time. For a **one-time** event that is forever after its end; for a
    **recurring** (weekly) event it lasts from the end of an occurrence until
    the start of the next occurrence (`currentOccurrence` walks back ≤ 7 days
    to find the last occurrence day).
  The same status drives the card tint and the **status filter** in الفلاتر.
- Then the two **badge buttons**:
- **Attendance badge** (green, `CalendarCheck`): when an event is selected in
  the attendance job, it shows how many times this person attended **that
  event**; with no event selected it shows the **total attendance across all
  events** (`enrollments.attendance_count`). Tapping it opens **سجل الحضور**
  (`AttendanceLogModal` in `src/components/LogModals.tsx`): every
  `attendance_log` row of the enrollment — event name, Cairo day, points
  granted, recorded-at + recording servant — with a toggle between the
  selected event and all events, and a count / points summary strip.
- **Points badge** (gold, `Star`): the current balance. Tapping it opens
  **سجل النقاط** (`PointsLogModal`): `points_log` (cause points, ± delta)
  merged with the points that came with attendance (`attendance_log.points_delta`),
  newest first, with a filter (all / أسباب النقاط / نقاط الحضور) and added /
  removed / net totals.

The per-event counts come from the same `attendance_log` fetch used for card
coloring (one query per selected event), so no extra migration is needed.

## Performance & Scale Architecture — migration 0019
The app is designed so that cost grows with **what is on screen**, not with the
size of the database. Everything below was validated on a local Postgres 17
with 3,500 enrollments / 10,866 attendance rows and all 19 migrations applied
(per-role visible counts exact, zero cross-scope leaks, cross-scope writes
rejected by RLS).

### Database (`0019_performance_rls_indexes_rpc.sql`)
- **One scope lookup per statement** — `my_scope()` reads the caller's profile
  once; every policy uses `(select …)` wrappers so Postgres evaluates them as
  InitPlans instead of once per row (the old policies re-ran 3–4 functions per
  row per table).
- `enrollment_visible(...)` — a single IMMUTABLE expression that encodes the
  role / null-scope-means-all rules for enrollments, attendance, points and
  print requests.
- **17 indexes** on every RLS/filter/join path (`enrollments(class_id, person_id)`,
  `attendance_log(event_id, attended_on)`, `persons(phone)`, `events(church_id)`, …).
- **Aggregation RPCs** (security *invoker* → RLS still applies):
  `stats_summary`, `stats_week`, `stats_leaderboard`, `dashboard_counts`,
  `lookup_enrollments_by_national_id`.

### Frontend (`src/lib/queries.ts`, `src/lib/realtime.ts`)
- **Server-side scoped + paginated lists** — the children page loads 200 rows
  per page for the selected church/service/class only, search runs in SQL
  (`persons!inner` + `ilike` on name/phone/national_id), "load more" appends.
- **Debounced, scoped realtime** — `useDebouncedRealtime` coalesces bursts of
  events into one reload (1.2–2 s), never overlaps reloads, filters
  subscriptions to the user's scope (`class_id=eq.…`), and pauses while the tab
  is hidden (one refresh on return).
- **Unique realtime topics** — `supabase.channel(topic)` returns the *existing*
  channel when the topic is already registered on the singleton browser
  client; adding `postgres_changes` to an already-subscribed channel throws
  and crashes the page. Every subscription therefore uses
  `uniqueTopic('prefix')` (`src/lib/realtime.ts`); `useDebouncedRealtime` does
  it internally. The child portal fetches exams/messages **once** in
  `ChildProvider` (header, side menu and pages read from the context).
- **Images** — `next.config.mjs` sets `images.unoptimized: true`: photos are
  already 512px WebP from the app, and routing every distinct child photo
  through Vercel's optimizer exhausted the quota → pictures vanished on phones.
- **Service worker** (`public/sw.js`) — same-origin only, always resolves to a
  real `Response` (offline page `public/offline.html`), never serves HTML for
  an image/script, registered with `updateViaCache: 'none'`.
- **Optimistic patches** — attendance/points mutations update the row locally
  instead of refetching the list.
- **Cached lookups** — churches/services/classes/events cached 60 s across pages.
- **No full-table downloads anywhere** — stats/home use RPC aggregates, the
  scanner resolves a QR via RPC, card printing fetches only the selected scope.

## Scale Architecture — migration 0046 (60–80+ concurrent servants)

### The incident
On a scan day with ~60–80 servants online the app became laggy and then failed.
Root causes found while studying the code:

| # | Cause | Effect |
|---|---|---|
| 1 | Every open app held **8–18 `postgres_changes` subscriptions** (header bells, 3 contexts, the page, up to 10 home widgets), many on the hot tables. Supabase Realtime re-evaluates the table's **RLS policy once per change × per subscriber**. One scan = 2–4 row changes → **~3 000 policy queries per scan** with 80 devices. | DB saturation → every request queues → the app "hangs" |
| 2 | `middleware.ts` called `supabase.auth.getUser()` on **every request** (page, RSC payload, link prefetch) — a network round-trip to the rate-limited Auth server. | +150–400 ms per navigation, Auth rate-limit errors |
| 3 | Every open app POSTed `/api/notifications/dispatch` **every 2 min** (80 users → 40 serverless runs/min, each running `notif_tick()` with the service role). | wasted DB + function capacity |
| 4 | Children page reloaded **6 lookup tables + all list pages** on every realtime burst. | multiplied the load of #1 |
| 5 | Search used `ilike '%x%'` with no trigram index → **sequential scan of `persons`** per keystroke per user. | slow search, CPU burn |
| 6 | Auth context ran 5 sequential queries at login and again on every `TOKEN_REFRESHED` (all devices ≈ together). | login lag, synchronized spikes |

### The fix — a shared broadcast bus
```
                 DB statement (scan / import / points …)
                          │  statement-level trigger (zzz_rt_*)
                          ▼
     realtime.send(payload, 'change', topic, private=true)   ← ONE message per statement
        topics: scope:all │ scope:church:<uuid> │ user:<uid>
                          │  authorized ONCE at channel join (RLS on realtime.messages)
                          ▼
   browser: ONE channel per topic (2–4 per device) → src/lib/realtime.ts bus
                          │  fan-out by table name
                          ▼
   useDebouncedRealtime(…) ×84 call sites — API unchanged, debounced reloads
```
- **DB** (`0046_realtime_broadcast_scale.sql`): hot tables leave the publication; `rt_trg_scoped` / `rt_trg_by_enrollment` / `rt_trg_persons` / `rt_trg_*` statement triggers with transition tables; `rt_topic_allowed()` + policy on `realtime.messages`; `pg_trgm` GIN indexes; composite indexes; `notif_dispatch_gate()`.
- **Client bus** (`src/lib/realtime.ts`): `BUS_TABLES` decides per table — hot tables listen on the bus, the rest keep classic `postgres_changes` (+ `filter`). `AuthProvider` calls `configureRealtimeBus()` with the servant's churches (owner → `scope:all`). **Safety net**: when the bus isn't connected (migration not applied, socket down) hot-table listeners poll every 45 s while visible and refresh when the tab returns.
- **Auth** (`src/lib/auth-context.tsx`): `getSession()` (local) instead of `getUser()`; profile / scopes / person / church / service loaded **in parallel**; `TOKEN_REFRESHED` and repeated `SIGNED_IN` no longer reload the profile; own approval / scope changes arrive via `user:<uid>`.
- **Middleware**: `getSession()` — the JWT is verified locally and refreshed only when expired; RLS still validates the real token on every query.
- **Dispatcher**: server gate (one real run per 45 s across all devices, cron `GET` never gated) + client kicks every 5–7.5 min with jitter and a 60 s per-device throttle (`startDispatcherKicks`); an explicit send still kicks immediately (`kickDispatcher({ force: true })`).
- **Children page**: the scan-burst subscription reloads **only the list**; events / causes / feedbacks have their own subscription.
- **Child portal** (no auth session → cannot join private topics): hot-table blocks poll (45–60 s, open chat thread 10 s) + refresh on focus; web push remains the instant path for notifications.
- **Scanner / POS** balance modals re-read the one row when a bus message names that enrollment.

### Expected effect
Realtime work per scan: **from ~(devices × channels) RLS evaluations to 2–3 tiny inserts**, independent of the number of devices. Auth server calls: from one per request to one per token expiry (~1 h). Dispatcher runs: from ~40/min to ≤ 1.3/min.

## Activity Log module — migration 0047 (وحدة سجل النشاط)

**Goal**: one place that shows *everything that happens in the app* — every
operation, by anyone, on anything — organised by **user** or by **operation**,
loading 10 / 100 / 1 000 rows at a time and digging deeper on demand.

### Why the database writes the log (not the screens)
The app has ~60 business tables written from screens, RPCs, server routes,
triggers (counters, mirrors, automatic achievements), cron and the child
portal. Logging from the frontend would miss every write that doesn't go
through a screen. So the log is produced by **one generic AFTER … FOR EACH
STATEMENT trigger** (`activity_audit`) using transition tables:

```
statement on <table>  ──▶  activity_audit()
   ├─ actor   = activity_actor()      auth.uid() → servant_enrollments (name, role)
   │                                  app.child_actor (set by child_portal_person) → persons
   │                                  otherwise system / service_role
   ├─ per row = to_jsonb(row)  →  activity_trim()  (secrets + oversized values out)
   ├─ target  = activity_resolve_target(table, row)   enrollment → person → name · scope
   ├─ action  = activity_action_key(table, op, old, new)   'attendance.add' · 'servant.approve' …
   ├─ UPDATE  = changed[] + old/new restricted to the changed columns
   │            (edited_at / updated_at-only updates are dropped)
   └─ batch   = one batch_id per statement, batch_size = rows
```

One statement = one function call however many rows it touched (a 300-row
bulk import is 300 log rows sharing a `batch_id`, written in one INSERT …
SELECT). The trigger runs `security definer`, so RLS on the source tables
never blocks it; the log table itself is **read-only for the API** (only the
trigger and `log_activity()` insert).

### App-level events
Things that are not table writes — servant login / failed login / logout,
child portal login, exports, prints, prune — go through `log_activity()` /
`child_portal_log_activity()` (`src/lib/activity.ts → logActivity()`, never
throws, never blocks the operation).

### Reading — keyset pagination, 10 / 100 / 1 000
`activity_feed(filters, limit, before, before_id)` orders by
`(created_at desc, id desc)` and takes the last row of the previous page as
the cursor — no OFFSET, so digging 10 000 rows deep costs the same as the
first page and a row inserted meanwhile can never shift or duplicate the
list. `activity_summary(filters)` returns totals, by action / table / op /
actor / day / hour for the same filters (drives the «بالعملية» and «نظرة
عامة» tabs); `activity_actors(filters)` drives «بالمستخدم». Filters are a
JSON object rendered by `activity_where()` with `format('%L')` (literal-quoted,
injection-safe — tested).

### Who sees what
| role | default | with `activity.view_all` |
|---|---|---|
| owner | everything | — |
| church_manager | his church(es) + scope-less rows made by his servants | — |
| service_manager | his service | whole church |
| class_servant | nothing — needs `activity.view` → his class | whole church |

Plus the module must be granted (`module_visible('activity')`, وحدة المالك →
صلاحيات الوحدات). The owner sets retention (`keep_days`, default 365) and
prunes from the «نظرة عامة» tab.

### Cost & realtime budget
Audit rows are small (a scan ≈ 3 rows: attendance_log insert · enrollments
counters · notification). Indexes cover every filter of the screen. The
realtime broadcast for `activity_log` is **throttled to one message per 3 s**
(`rt_gates`) so a scan day never doubles the bus traffic 0046 reduced — the
screen refetches the head of the feed and picks up every row anyway.

### Files
`supabase/migrations/0047_activity_log.sql` · `supabase/tests/activity_log_test.sql`
· `src/lib/activity.ts` (types · Arabic registry of groups / verbs / nouns /
columns · `describe(row)` · fetch helpers · Excel export) ·
`src/components/activity/ActivityBits.tsx` · `src/app/activity/{layout,page}.tsx`.

## Reports & Tables module — migration 0050 (وحدة تقارير وجداول)

**Goal**: let a servant pull *exactly the data he wants* out of the app,
arrange it on paper the way he likes, and get it as **PDF · Excel · print** —
then keep the design as a **template** and re-run it for another class / month.

### Flow
```
1 البيانات   source · church → service → class · filters (period · event · cause · exam · gender · status …)  ──▶ load (RLS-bounded, paged)
2 الحقول     pick / order / rename / width / align · row filters (يحتوي · يساوي · أكبر من …) · sort · LIVE preview · quick Excel
3 التصميم    pages (add · delete · reorder · duplicate · portrait / landscape) · elements (عنوان · نص · شعار · صورة · جدول · رسم بياني · خط · مربع)
             drag to move · corner handle to resize · properties panel · header / footer · page numbers · {variables}
4 التصدير    full preview of every physical page · PDF · Excel · print · «حفظ كقالب»
```

### Architecture (`src/lib/reports/`)
| File | Role |
|---|---|
| `types.ts` | the versioned JSON document `ReportDefinition = { version, query, design }` — what a template stores and what the wizard edits; defaults + `normalizeDefinition()` for upgrading older templates |
| `sources.ts` | **data-source registry**: each source declares its `fields` (key · label · type · group · numeric), the `filters` it understands and a `load()` that returns flat `ReportRow`s. Sources: `enrollments` · `attendance` · `points` · `contacts` · `exam_results` (per-subject columns added dynamically per exam) · `servants`. *Adding a source = one entry.* |
| `engine.ts` | pure functions shared by preview / print / PDF / Excel: `filterRows` · `sortRows` · `formatCell` / `excelValue` · `aggregate` · `chartData` · `{variables}` resolution (`{church_name}` `{count}` `{today}` `{page}` `{pages}` `{sum:field}` …) · `layoutPages()` — splits a flowing table over continuation pages · `tableColumns()` |
| `templates.ts` | `report_templates` CRUD + migration-missing detection |
| `export-excel.ts` | SheetJS export of **exactly the chosen columns** in the chosen order with the chosen titles (numbers stay numeric, dates stay dates, RTL sheet, optional totals) |

**Rendering** — `src/components/reports/ReportPageView.tsx` draws ONE physical
page in mm at a given `scale` (px/mm). The same component is used by the
designer canvas (interactive), the export preview, the hidden **print portal**
(1 mm = 1 mm with `@page` per page size) and the **PDF** path (each page
rasterized at 200 dpi with `modern-screenshot` → `jsPDF` image pages — so
Arabic shaping / RTL is pixel-perfect without embedding fonts). Charts are
pure SVG (`ReportChart.tsx`: column · bar · pie · donut · line).

**Aggregates** — `report_enrollment_period_stats(enrollments[], from, to, event)`
(SECURITY INVOKER) returns per-enrollment attendance / points / calls inside
a period so the المخدومون source never downloads log rows for a whole scope.

**Templates** — `report_templates (church_id · service_id · class_id · name ·
source · definition jsonb)`; scope semantics identical to `card_print_profiles`
(read = `scope_overlaps`, write = `can_access`, `church_id NULL` = shared,
owner-only). RLS requires `module_visible('reports')`. Using a template loads
its query + design and jumps to step 1 — the user only picks the new scope /
filters and runs it.

**Permissions** — module `reports` (owner grants it from صلاحيات الوحدات);
keys `reports.build` (informational — everyone who sees the module builds
reports of his own RLS scope) and `reports.templates` (class servants need it
to save / edit / delete templates; managers have it).

**Ready for later** — more chart kinds (add a `case` in `ReportChart` +
`CHART_KIND_LABELS`), calculated columns (engine already resolves `{sum:}`
`{avg:}` …), grouping / sub-totals, scheduled runs (definition is a JSON
document — a cron can `load()` + render server-side), more sources.

### Files
`supabase/migrations/0050_report_templates.sql` · `src/lib/reports/*` ·
`src/components/reports/{ReportBits,DataStep,FieldsStep,DesignStep,ExportStep,ReportPageView,ReportChart,TemplatesPanel}.tsx`
· `src/app/reports/{layout,page}.tsx`.

## Family module — migration 20260924120000 (وحدة العائلات)
`supabase/migrations/20260924120000_families.sql` · test `supabase/tests/families_test.sql`

**Why** — brothers and sisters (and their parents who serve) arrive together. One card scanned should be enough to reach **any member of the family** and act on the right person in the right service.

`supabase/migrations/20260924130000_families_code_and_search.sql` — v2: user-set family code · person search · add existing / new member.

### Data
```
families        id · code (unique — the family QR; set by the servant, auto F-XXXXXX when empty; never equal to a person code) · name · phone · address · notes · audit
family_members  family_id → families · person_id → persons (UNIQUE: a person is in ONE family) · relation
```
`relation` ∈ father · mother · son · daughter · brother · sister · grandfather · grandmother · husband · wife · other (`RELATION_LABELS` in `src/lib/families.ts`).

### Flow
1. **العائلات → + عائلة** — **code** (typed · scanned with `QrScanner` · generated by `useCodeGenerator('family')`, legacy `F-XXXXXX`) with a live check through **`family_code_lookup(code)`** (`{free, family, person}`; a person code or another family's code is refused — the trigger `families_fill_code` enforces `code_is_person` / uniqueness too) + name (phone · address · notes optional). Empty code → the DB generates one. «كود العائلة» shows the QR → copy · share.
2. **العائلات → إضافة أفراد** (`/family?tab=qr&family=<id>`, `AddMembersPanel`) — choose the family (or «جديدة»), pick the relation for the next additions, then one of three modes:
   - **مسح كود** — scan each member's card (camera / gallery) or type the code → RPC **`family_add_member_by_code(family, code, relation, move)`**.
   - **بحث** — RPC **`family_search_persons(q)`** (name / phone / code, ≥ 2 chars, persons in the caller's scope — with each one's current family and places) → «إضافة» → RPC **`family_add_member(family, person_id, relation, move)`**.
   - **فرد جديد** — the same form as إضافة مخدوم (code typed / scanned / generated · name · gender · phone · birthdate · address · notes · photo) + an **optional** church → service → class → RPC **`family_add_new_member(...)`**: with a class it runs `add_person_and_enroll` (upsert by code + enrollment), without one it creates a bare person (code required) — then adds him to the family, all in one transaction.
   Outcomes everywhere: added ✔ · `already_member` · `person_not_found` · **`in_other_family`** → «نقل إلى هنا؟» (re-called with `move = true`). A session log lists every addition.
3. **الماسح** — `handleQr` first calls **`family_lookup(code, day)`** (person code OR family code). If the person has a family (or a family code was scanned) → **`FamilyScanPicker`**:
   - **Step 1 — أفراد العائلة**: every member (avatar · name · relation · code · «الممسوح»), his in-scope services and **«حضر اليوم: خدمة أ · خدمة ب»** (from `attendance_log.attended_on = working day`). Members outside the selected church / service / class (or with no enrollment the servant can reach) are greyed «خارج النطاق المختار».
   - **Step 2 — اختر الخدمة** (only when that person has **2+ in-scope enrollments**): the enrollment list; the one **attended today** is highlighted «حضر اليوم هنا». With **«التعرف على الخدمة تلقائياً»** (persisted in `localStorage`, default on) a single recognised service is chosen without asking.
   - The chosen enrollment goes to **`doJob(e)`** — exactly the same path as a single scan (attendance / points / data, same guards, same archive entry).
   - A lone person (no family) or an unknown code falls through to the classic `lookup_enrollments_by_national_id` flow. The **«العائلات» switch** in the scanner control panel disables the family detour (default on when the module is granted).

### Permissions & RLS
- `family_can(key)` = `module_visible('family')` AND (owner / church manager / service manager OR key = `family.view` OR `has_permission(key)`). `family_permissions()` → `{view, manage}` for the UI.
- `family_visible(id)` = owner · creator · or ≥ 1 member enrolled where `can_access`. Members of other churches are still **listed** by `family_lookup` (name + code — the family is complete) but their enrollments are filtered by `can_access`, so nothing can be done on them from a foreign scope.
- Tables are realtime + audited (`activity_audited_tables` extended: `families`, `family_members`). A global `module_access` grant is seeded (like `cards`) — the owner narrows it from وحدة المالك → صلاحيات الوحدات.

### Files
`src/lib/families.ts` (types · `lookupFamily` · `addFamilyMemberByCode` · …) · `src/app/family/{layout,page}.tsx` ·
`src/components/family/{FamilyBits,AddMembersPanel,FamilyScanPicker}.tsx` · scanner hook-in in `src/app/scanner/page.tsx` · code generator `family` in `src/lib/code-templates.ts`.

## Activity item permissions & modules for specific people — migration 20260925130000

### Fine-grained keys (ملفات الصلاحيات)
| Item | Keys | Default for class servant |
|---|---|---|
| المناسبات `events` | `view · add · edit · delete · set_default` | `view` |
| أسباب النقاط `causes` | `view · add · edit · delete · set_default` | `view` |
| نتائج الافتقاد `feedbacks` | `view · add · edit · delete · reorder` | `view` |
| طلبات تعديل البيانات `data_requests` | `view · approve · reject · delete` | `view` |

All keys are `activity.<item>.<action>`. **Owner / church manager / service manager hold every key** (nothing changed for them);
a **class servant** views by default (he must pick the event on the scanner) and needs a permission profile for any write.
The **legacy coarse keys** `activity.events` · `activity.causes` · `activity.feedbacks` · `activity.data_requests` are still
honoured — each implies every fine key of its item — and are expanded to the fine keys when the owner opens the profile.

**Enforcement**
- SQL `activity_item_can(key)`, `activity_item_permissions()` → nested JSON for the UI.
- RLS on `events` / `causes` / `call_feedbacks` = scope (`scope_overlaps` / `scope_contains`, as before) **and** key.
- `is_default` (events, causes) is protected by a BEFORE trigger needing `*.set_default`; the 0048 «one default per scope» cascade
  sets `app.default_cascade` so its own rows pass. Guards are skipped when `auth.uid()` is null (seeds, service role).
- `call_feedbacks` UPDATE: a `sort_order` change needs `reorder`, any other column needs `edit` (trigger).
- `data_change_requests`: select / delete policies check `view` / `delete`; `review_data_change_request` checks `approve` / `reject`.
- App: `usePermissions().activityCan(item, action)` (mirror of the SQL rule, `src/lib/permissions.ts → activityItemCan`);
  the settings pages hide «إضافة» / pencil / trash / arrows, lock the default radio and show «عرض فقط» when nothing is allowed.

### Modules for specific people (أشخاص محددون)
`module_access.servant_id` — a grant that names ONE servant and carries no scope. `module_visible(key)` = owner OR a scope grant
overlapping the caller OR a person grant naming him. The owner adds them from **وحدة المالك → صلاحيات الوحدات → «أشخاص محددون»**
(search by name / code, multi-select); they are listed under the scope grants with a person icon and a «N شخص» badge.
«إظهار للجميع» keeps person grants (harmless); «إخفاء عن الجميع» removes both kinds. Person grants are ignored by the child-portal
helpers (`module_granted_for`, `notif_module_covers`) — children see modules by scope only.

`supabase/migrations/20260925130000_activity_permissions_and_person_modules.sql` · test `supabase/tests/activity_permissions_test.sql`.

## Access module — migration 20260925120000 (وحدة التحكم في الدخول)

**Why** — a party, a trip bus, a meal hall or a conference room should let in only the right people, decided by **data the app already has** (points, attendance, events, exams, achievements, occasions, person fields) and by **who the admins listed** — and the servant at the door must see *why*.

`supabase/migrations/20260925120000_access_control.sql` · test `supabase/tests/access_control_test.sql`.

```
access_events       بوابة دخول — church → service → class scope · name · is_active · allow_all · root_op (and|or) · starts/ends
access_rule_groups  مجموعة — event · parent_id (nested) · op (and|or) · name · sort_order
access_rules        قاعدة — event · group_id (null = top level) · name · kind · params jsonb · enabled · sort_order
access_allowed      المسموح لهم — event · person_id  OR  church_id (+ service_id (+ class_id)); null levels = the whole level
access_log          سجل — event · person · code · granted · allowed · rules_ok · reason · details (rule statuses) · checked_by · checked_on
```

**Decision** — `granted = is_active AND allowed AND rules_ok`
- `allowed` = `allow_all` **or** ≥ 1 `access_allowed` row covers the person (listed by id, or he has an *active* enrollment inside a listed church / service / class).
- `rules_ok` = the tree evaluates true: every group combines its **enabled** rules + sub-groups with its `op`; the top level uses the event's `root_op`; a level with nothing enabled is vacuously true (so a gate with no rules is an allowed-list-only gate).
- Metrics (points · attendance) are summed over the person's active enrollments **inside the gate's scope**; a guest with none there is measured on all his enrollments (`summary.in_scope = false`).

**Rule kinds** (`params`): `points {op,value,value2}` · `attendance_count {op,value,value2,from,to,event_id}` (counter, or `attendance_log` rows when filtered) · `attended_events {event_ids[],mode all|any,from,to}` · `gender {value}` · `age {op,value,value2}` (years from birthdate) · `enrolled_in {church_id,service_id,class_id}` · `person_field {field,op present|absent|contains|equals,value}` · `exam_passed {exam_id}` · `achievement {achievement_id}` · `occasion {occasion_id,statuses[]}` · `not_entered {period day|ever}` (blocks a second pass). `op ∈ gte · lte · eq · neq · between`.

**RPCs** — `access_check(event, code | person, log)` → `{ event, matched, person, enrollments, summary {points, attendance_count, last_attended_on, entered_today…}, history[12], visits[6], allowed, allowed_by[], rules {ok, root_op, rules[{…, fulfilled, actual}], groups[{…, ok, empty}]}, granted, reason (not_found|inactive|not_allowed|rules), log_id }` — writes `access_log` unless `p_log = false` («تجربة» in the UI). `access_search_persons(q, limit)` · `access_permissions()`.

**Access** — `module_visible('access')`; `access.check` = every servant of a granted scope (RLS: gates by `scope_overlaps`, child tables through the gate); `access.manage` = owner / church manager / service manager or a class servant with the key (writes by `can_access` on the gate's scope). Triggers keep groups / rules inside one event. Realtime on all five tables, activity-log attached.

### Files
`src/lib/access.ts` (types · `accessCheck` · `describeRule` / `describeActual` · fetch / save helpers) · `src/app/access/{layout,page}.tsx` · `src/components/access/{AccessBits (DecisionCard · RuleTree · EventPicker), CheckPanel, AccessForms (event · rule · group modals), AllowedPanel}.tsx` · module `access` in `src/lib/modules.ts`, keys in `src/lib/permissions.ts`.

## Statistics Architecture — migration 0020
The الإحصائيات tab (`src/app/stats/page.tsx`) never downloads raw rows; every
number comes from a SECURITY INVOKER RPC in `0020_statistics_rpcs.sql`, so RLS
still applies and a class servant only ever sees his own class even when he
passes another church's id.

| RPC | Returns |
|---|---|
| `stats_scope_summary(p_church, p_service, p_class)` | enrollments, persons, males/females, total attendance & points, events/causes/classes count, first/last attendance |
| `stats_day_summary(p_day, …)` | attendance, unique attendees, events attended, attendance points, cause points ±, scope persons |
| `stats_attendance_by_event(p_day, …)` | per event: attendance, attendees, points, eligible, first/last time — sorted by event |
| `stats_points_by_cause(p_day, …)` | per cause: entries, recipients, added, removed, net — sorted by cause |
| `stats_attendance_timeline(p_from, p_to, p_bucket, …)` | attendance per bucket (day/week/month) **per event** — feeds the stacked chart |
| `stats_points_timeline(p_from, p_to, p_bucket, …)` | points per bucket per cause |
| `stats_attendance_by_class(p_day, …)` | per class: enrolled, attendees, attendance, points |
| `stats_leaderboard_scoped(p_by, p_limit, …)` | top persons by points or attendance |
| `stats_weekday_profile(p_from, p_to, …)` | attendance per weekday (Cairo) |

`null` for any scope parameter means "all" (the UI sends `ALL` → `null`). All
dates are Africa/Cairo (`attended_on`, `(created_at at time zone 'Africa/Cairo')::date`).
Two extra indexes (`points_log` Cairo-day expression, `points_log(cause_id)`) keep
the by-cause queries indexed. Frontend helpers live in `src/lib/stats.ts`
(typed fetchers, period/bucket/series builders) and pure-SVG chart primitives in
`src/components/stats/Charts.tsx` (no chart library).

### Expected capacity (Vercel + Supabase)
| Plan | Persons (المخدومين) | Servants | Notes |
|---|---|---|---|
| Free + Free ($0) | ~5,000 | ~40 concurrent (≈100 with 0046) | DB pauses after 7 idle days, no backups — OK for pilot only |
| Supabase Pro ($25) + Vercel Hobby* | ~20,000 | ~150 concurrent (≈400 with 0046) | recommended production floor; daily backups |
| Pro + Pro ($45) | 20,000–50,000 | 300+ concurrent | Vercel Hobby is non-commercial; Pro adds team seats & analytics |

\*Vercel Hobby is for non-commercial use; a church ministry generally
qualifies but check Vercel's fair-use policy.

## Child Portal Architecture — migration 0021
- **No auth account for children.** The QR value (`persons.national_id`) is the bearer token: the browser stores it in `localStorage` (`child_portal_token`) and passes it as `p_national_id` to `child_portal_profile / attendance / points / requests / submit_request / cancel_request` (SECURITY DEFINER RPCs executable by `anon`). Nothing else is readable by `anon`; `/child` is public in `middleware.ts`.
- **QR decoding** (`src/lib/qr-decode.ts`): native `BarcodeDetector` when available, otherwise `jsqr` on canvas frames; gallery images are decoded at several down-scales.
- **Change requests** (`data_change_requests`): `kind = 'data' | 'photo'`, `changes` jsonb (whitelisted fields: name, birthdate, gender, phone, address — or `image_url` for photos), `previous` snapshot, `status = pending | approved | rejected | cancelled`. Only one pending request per person & kind. Managers see requests via RLS (`can_access_person`) and decide with `review_data_change_request(p_request, p_approve, p_note)`; approval writes the changes into `persons`. Realtime keeps both the child's page and the review page in sync.

## Event-bound operations — migration 0022
- `points_log.event_id uuid → events (on delete set null)` + index; trigger
  `check_points_event_scope` rejects an event that doesn't cover the
  enrollment's church / service / class.
- `contact_log (enrollment_id, event_id, kind call|whatsapp|sms|internal,
  message, contacted_on, recorded_by)` — every call / message from the children
  page is logged as a follow-up for the selected event (fire-and-forget, never
  blocks the dialer / WhatsApp). RLS uses the `enrollment_visible` InitPlan
  pattern from 0019; realtime enabled.
- `child_portal_points` now returns an extra `event_name` column so the child
  portal can show which event points were given in.
- Frontend: `src/lib/time.ts` (`childEventStatus`, `currentOccurrence`,
  `CHILD_STATUS_LABELS`), `src/lib/types.ts` (`PointsLog.event_id`,
  `ContactLog`), children page, scanner (incl. manual points modal), settings
  hub order, `PointsLogModal` shows the event of each entry.

## Call feedback — migration 0023 (نتيجة الافتقاد)
- `call_feedbacks (church_id, service_id?, class_id?, event_id?, name, color hex,
  icon lucide-key, sort_order, audit)` — null service / class / event = "all".
  Trigger `check_call_feedback_event_scope` rejects an event outside the row's
  church / service / class. RLS: select via `scope_overlaps`, write via
  `scope_contains` (InitPlan pattern from 0019). Realtime enabled.
- `contact_log.feedback_id → call_feedbacks (on delete set null)` and
  `contact_log.occurrence_on date` (the occurrence the call is about); partial
  index `idx_contact_log_feedback_lookup`. `check_contact_event_scope()` also
  verifies the feedback applies to the enrollment + event.
- **Follow-up cycle** (`src/lib/call-feedback.ts` → `followUpCycle(ev, working, real)`):
  a cycle runs from an occurrence's start until the next occurrence starts.
  **Two clocks**: the *working* date (frozen override from the header, or live)
  is the secondary player — it picks `target`, the occurrence whose cycle
  contains it; the *real* date is the main player — it picks `realTarget` and
  therefore `status`: `open` (target = realTarget → feedback can be recorded /
  changed), `closed` (target < realTarget → final, read-only), `future`
  (target > realTarget → nothing to record yet). `beforeCreation` hides the
  badge when the target predates the event's `created_at`.
  `callFeedbackState` → `feedback` (latest row for target) | `wasnt_called`
  («لم يُفتقد», no feedback and status closed) | `not_called_yet`
  («لم يُفتقد بعد», no feedback, open or future). `canRecordFeedback` gates
  the modal buttons + undo.
- Frontend: `src/components/CallFeedback.tsx` (`CallFeedbackBadge`,
  `CallFeedbackModal`, `useCallFeedbackStates(supabase, rows, event, feedbacks, working, real)` — chunked fetch of on-screen
  enrollments for the `target` occurrence only), `src/lib/call-feedback.ts`
  (icons, color presets, `feedbackStyle`, `matchesCallFilter`),
  `src/lib/types.ts` (`CallFeedback`, `feedbackApplies`), `src/lib/time.ts`
  (`previousOccurrenceDate`), `cachedLookup('call_feedbacks')`, children page
  (badge + filter chips + realtime), scanner (badge + modal),
  `/settings/call-feedbacks` + hub link after إدارة أسباب النقاط.

## Modules & the Owner module — migration 0024 (الوحدات · وحدة المالك)
The app = a fixed **core** (the 5 main pages: الرئيسية · المخدومين · الماسح ·
الإحصائيات · الإعدادات) + optional **modules** (الوحدات). Today the only
module is the **card designer / print module** (`cards`).

- **Registry** — `src/lib/modules.ts`: every module is declared once (`key`,
  label, desc, entry `href`, icon, color, path prefixes). To add a module
  later: add one entry there and wrap its pages with `<ModuleGate module="key">`
  (or a route `layout.tsx` like `src/app/settings/cards/layout.tsx`).
- **Side menu** (`SideMenu.tsx`) — the section under the 5 main-page buttons
  shows **modules only**: the owner module (owner) + the modules granted to the
  caller's scope. Nothing else lives there.
- **Settings hub** — modules sit in their own group **الوحدات**, separate from
  الإدارة and النشاط (the owner module is listed first, gold-tinted, for the owner).
- **Owner module** (`/owner`) — a unique module for `role = owner` only
  (`<OwnerGate>`); owner-only controls are added here step by step. First tool:
  **صلاحيات الوحدات** (`/owner/modules`) — for each module the owner lists its
  **grants** (كنيسة ← خدمة ← فصل, any level may be «الكل»), adds a scope,
  deletes one, **إظهار للجميع** (one global grant) or **إخفاء عن الجميع** (no
  grants → only the owner sees the module).
- **Visibility rule** — a servant sees a module when at least one grant
  *overlaps* his scope (same `scope_overlaps` semantics as events / causes);
  the owner always sees everything. Computed in SQL (`module_visible(key)`)
  and mirrored in the client (`visibleModuleKeys` in `src/lib/modules.ts`).
- **Database** (`0024_owner_module_access.sql`) — table `module_access`
  (`module_key`, `church_id?`, `service_id?`, `class_id?`, unique per scope,
  chain check + trigger validating service ∈ church, class ∈ service). RLS: read
  what concerns you, **only the owner writes**. The card tables
  (`card_templates`, `card_print_requests`) now also require
  `module_visible('cards')` in every policy, so hiding the module in the UI is
  enforced by the database. Realtime enabled → grants propagate instantly.
- **Frontend plumbing** — `ModulesProvider` / `useModules` / `useModuleVisible`
  (`src/lib/modules-context.tsx`, mounted in the root layout, realtime on
  `module_access`), `ModuleGate` + `OwnerGate` (`src/components/ModuleGate.tsx`).
  The children page hides the **طباعة كارت** job when the card module is not
  granted; `/settings/cards/*` is gated by a route layout.

## Shepherds module — migration 0025 (وحدة الأشابين)
Every servant (الأشبين) is bound to a **group of children** he personally
follows up. The module is optional and only appears where the owner grants
it (`/owner/modules` → الأشابين).

- **Rule** — a child (enrollment) belongs to **at most one group**. Any child
  not yet chosen by another servant can be chosen; children already taken
  are shown locked with the holder's name («في مجموعة فلان»). Enforced by
  `uq_shepherd_groups_enrollment` (a race between two servants ends in
  `23505` → friendly «اختاره خادم آخر بالفعل»).
- **`/shepherds`** (`src/app/shepherds/page.tsx`, gated by
  `src/app/shepherds/layout.tsx`): tabs **مجموعتي** (my children, grouped by
  class, ✕ removes) and **اختيار مخدومين** (server-paged scoped list with
  search + church → service → class selectors; ＋ adds a free child, ✓ marks
  mine, 🔒 marks taken). Owner / church manager / service manager also get
  a **free** button on taken children and a **مجموعات الخدام** overview
  (`shepherd_group_summary`). Realtime on `shepherd_groups`.
- **Children page** — a **«مجموعتي» toggle** (with the group size) sits
  directly **below the church / service / class / event selectors** and
  above the job selector. ON → the list is the group only (still narrowed
  by the selectors + search, no paging — the group is small); everything
  else — jobs, badges, status / call-feedback filters, sort, modals — is
  untouched. The header shows a teal «مجموعتي» badge while active; an empty
  group offers a shortcut to `/shepherds`. Hidden entirely when the module
  isn't granted.
- **Database** — `shepherd_groups (servant_id → profiles, enrollment_id →
  enrollments unique, church_id / service_id / class_id denormalized by
  trigger)`. RLS (InitPlan pattern from 0019) + `module_visible('shepherds')`
  on every policy: **select** rows of enrollments I can see (so the picker
  knows what's taken), **insert** only `servant_id = auth.uid()` within my
  scope, **delete** my own rows, or any row in scope for owner / church /
  service managers. `shepherd_claims(p_church, p_service, p_class)` (SECURITY
  DEFINER, module + visibility checked inside) returns holder name / photo
  for visible children — needed because a class servant can't read other
  servants' profiles. Validated on local Postgres: module gate, own-group
  only, 23505 on double claim, cross-servant delete blocked, manager free,
  trigger scope fill, realtime publication.
- **Frontend plumbing** — registry entry `shepherds` (`src/lib/modules.ts`),
  types `ShepherdGroupRow / ShepherdClaim / ShepherdGroupSummary`
  (`src/lib/types.ts`), `fetchMyGroupIds` / `fetchMyGroupEnrollments`
  (`src/lib/queries.ts`).

## Points store module — migration 0026 (وحدة إستبدال النقاط)
A small **POS where children spend their points**. Optional module, visible
only where the owner grants it (`/owner/modules` → إستبدال النقاط).

- **Inventory** (`store_items`) — `code` (unique per church, case-insensitive;
  printed as the QR label), `name`, `description`, `image_url` (compressed
  ≤ 640 px webp in `photos/store/`), `price` (points), `stock`, `is_active`,
  scope `church_id → service_id? → class_id?` (null = all, same semantics as
  causes / events; chain validated by trigger). RLS: read `scope_overlaps`,
  write `scope_contains`, everything behind `module_visible('store')`.
- **Sale** (`store_checkout(p_enrollment, p_lines jsonb, p_note)`) — ONE
  SECURITY DEFINER transaction: module granted → caller can see the
  enrollment (`enrollment_visible`) → `for update` lock on the enrollment and
  on every item → item active + applies to the child's scope + stock ≥ qty →
  **total ≤ balance** → writes `store_orders` + `store_order_items`
  (snapshot of code / name / picture / price), decrements stock, inserts one
  `points_log` row (`delta = −total`, no cause / event) so the existing
  counter trigger updates `enrollments.points`; returns
  `{order_id, total_points, items_count, balance_before, balance_after}`.
  Duplicate lines of the same item are merged. Any failure rolls everything
  back (verified: failed attempts leave no order, no stock or balance change).
- **Archive** (`store_orders`) — read-only through the API (no insert /
  update / delete policies), `status = completed | cancelled`, balance
  before / after, `recorded_by`, note. **Cancel** (`store_cancel_order`,
  owner / church / service managers only): refund via a `+total` points_log
  row (`refund_points_log_id`), restock every line whose item still exists,
  `status = cancelled` + who / when. Double cancel → `not_completed`.
- **Child portal** — `child_portal_points` now returns `source = 'store'`
  rows (reason «إستبدال نقاط — N صنف» / «إلغاء عملية إستبدال — استرداد
  النقاط», plus `order_id`); `child_portal_store_orders(nid)` returns the
  bills with their lines. The points page shows a **إستبدال النقاط filter**,
  a «استبدلتها بأصناف» total, and tapping a store row opens the bill.
  The servant-side `PointsLogModal` labels the same rows (filter «إستبدال»).
- **Frontend** — registry entry `store` (`src/lib/modules.ts`), route gate
  `src/app/store/layout.tsx`, data layer `src/lib/store.ts` (basket helpers,
  Arabic error mapping incl. `insufficient_stock:<name>`, fetchers, label
  sizes), shared bits `src/components/store/StoreBits.tsx` (tabs header,
  scope selectors, thumbs), `ItemFormModal`, `LabelsPrintModal` (A4 grid,
  38×25 / 50×30 / 70×40 mm, copies = 1 / stock / custom, same hidden print
  portal as the card module), `QrScanner` (native BarcodeDetector → jsQR
  fallback, gallery image, pause while a confirm sheet is open). The POS uses
  **one camera for both**: a scanned code is tried as an item first, then as
  a child card; the child's balance is a realtime subscription on his
  enrollment row while the basket is open.
- **Tests** — `supabase/tests/local_shim.sql` + `run_migrations.sh` rebuild
  the whole schema on a plain Postgres (emulates `auth.uid()`, storage,
  realtime publication); `store_module_test.sql` asserts: module gate, RLS
  per scope, duplicate code, class servant can't write church-wide items,
  empty basket / over balance / over stock / out-of-scope rejections with
  no side effects, valid checkout (merge, totals, stock, points_log), servant
  can't cancel, archive read-only, cross-class isolation, anon portal RPCs,
  manager cancel (refund + restock), double cancel, realtime publication.
  Validated on PostgreSQL 17 with all 26 migrations → «STORE TESTS PASSED».

## Exams module — migration 0027 (وحدة الامتحانات)
Multiple-choice exams the children solve from their portal. Optional module,
visible only where the owner grants it (`/owner/modules` → الامتحانات).

- **Exam** (`exams`) — scope `church_id → service_id? → class_id?` (null = all,
  chain validated by trigger), `status` draft | published | closed, optional
  `opens_at` / `closes_at` window, `default_seconds` / `default_points` per
  question, pass rule `pass_mode` percent | score + `pass_value`,
  `points_pass` / `points_full` rewards, `question_mode` all | random +
  `random_count`, `shuffle_questions`, `shuffle_options`, `max_attempts`,
  `show_result`, `show_answers`. RLS: read `scope_overlaps`, write
  `scope_contains`, all behind `module_visible('exams')`.
- **Questions** (`exam_questions`) — text, picture (`photos/exams/`),
  `options` jsonb (2..6 non-blank strings, validated by trigger),
  `correct_index`, `points`, `seconds` (null → exam default), `sort_order`.
- **Attempt** (`exam_attempts` + `exam_answers`) — `child_exam_start` picks the
  questions (all or `random_count` random, optionally shuffled), **snapshots**
  them into `exam_answers` with a per-question **option permutation**, and
  serves the first one. The child **never receives the correct index**: every
  payload is built server-side (`exam_question_payload`). Each served question
  carries `served_at` / `deadline_at` / `server_now`; `child_exam_answer`
  accepts only the **current position** (no going back, stale double-taps are
  ignored), maps the served index back to the original, marks correct /
  wrong, and rejects answers after the deadline (+3 s grace) as timed-out.
  `exam_advance` skips expired questions when the child comes back after
  closing the app; the last answer triggers `exam_finalize`: score, max,
  percent, pass (full mark always passes), points → **one `points_log` row**
  (existing trigger updates `enrollments.points`). Unique partial index = one
  open sitting per child per exam; cancelled attempts don't count toward
  `max_attempts`.
- **Servant side** — attempts / answers are read-only via RLS
  (`enrollment_visible`); `exam_attempt_detail` returns the full result,
  `exam_cancel_attempt` (write scope on the exam) refunds granted points and
  frees a retake, `exam_duplicate` copies an exam + questions as a draft.
- **Child portal** — `child_portal_exams` lists published exams in the child's
  scope (module granted via `module_granted_for`, which works for anon) with
  attempt state + last result; `child_portal_points` gets `source = 'exam'`.
  Frontend: `/child/exams` list, `/child/exams/[id]` player (countdown
  anchored on the server deadline with clock-offset correction, auto-advance,
  resume on reload / visibility change, result screen with optional review),
  side-menu entry + home card shown only when exams exist for the child.
- **Frontend plumbing** — registry entry `exams` (`src/lib/modules.ts`), route
  gate `src/app/exams/layout.tsx`, data layer `src/lib/exams.ts` (types, error
  mapping, CRUD, RPC wrappers) + child fetchers in `src/lib/child-portal.ts`,
  components `src/components/exams/*` (ExamBits, ExamFormModal,
  QuestionFormModal, ResultsTab).
- **Tests** — `supabase/tests/exam_module_test.sql`: module gate (servant +
  child), RLS per class, question validation, draft invisible, out-of-scope
  child, full start → answer → timeout → grade flow (no leak of the correct
  index, stale answers ignored, position skipping rejected), attempts limit,
  servant visibility + read-only attempts, cancel + refund + retake, random N
  of M, full mark → points → balance → child points row, duplicate, closed
  window, realtime publication. Validated on PostgreSQL 17 with all 27
  migrations → «EXAM TESTS PASSED».

## Birthdays module — migration 0028 (وحدة أعياد الميلاد)
Who has a birthday **this month, day by day** — and everything a servant
wants to do about it. Optional module, visible only where the owner grants
it (`/owner/modules` → أعياد الميلاد).

- **Month view** (`/birthdays`, `src/app/birthdays/page.tsx`) — ◀ ▶ change
  the month (wrapping the year) + a 12-month strip; church → service → class
  selectors; stats (birthdays · today · greeted · gifts). The list is grouped
  **by day** (today ring-highlighted, past days greyed) — one row per
  **person** even if he has several enrollments (`enrollments_count`).
  Per row: greeting chips (which kinds were done this year), points balance,
  and four buttons: **call**, **WhatsApp / SMS** (channel toggle, text from
  the greeting template with variables), **gift** (NumPad → RPC, disabled
  once gifted), **card** (preview modal). Filters: not greeted / greeted /
  no gift / no phone + search. **Bulk**: «تهنئة الجميع» opens a stepper
  that sends to every not-yet-messaged child one by one (send / skip);
  «هدية للجميع» gifts everyone without a gift; «طباعة الكروت» deep-links to
  the card print tab pre-filtered on the month; export **ICS** (yearly
  recurring events with a reminder — import into Google / Apple calendar)
  and **Excel**. The greeting template is per device (`localStorage`),
  seeded from the settings.
- **Greetings log** (`birthday_greetings`) — `person_id × year × kind`
  (`call | whatsapp | sms | card_printed | card_shared | gift | note`), scope
  denormalized by trigger from the enrollment, `recorded_by` defaulted to
  `auth.uid()`. Every action from the UI logs itself (fire-and-forget). The
  row modal (`GreetingLogModal`) lists the year's greetings with who / when,
  lets the author (or a manager) delete one, add a **note**, and managers
  **cancel a gift**.
- **Gift** (`birthday_gift(enrollment, year, points, note)`) — SECURITY
  DEFINER: module granted → enrollment visible → **no gift yet for this
  person this year** (checked across all his enrollments; also a unique
  partial index) → one `points_log` row (`+points`, no cause / event, the
  existing trigger updates `enrollments.points`) + one greeting row of kind
  `gift` holding the `points_log_id`. `birthday_gift_cancel` (owner / church
  / service managers) inserts a compensating `−points` row and removes the
  greeting (same pattern as the store refund). Gift rows are labelled
  «🎂 هدية عيد ميلاد YYYY» in the servant `PointsLogModal` (filter «أعياد
  ميلاد») and in the child portal points page (`source = 'birthday'`).
- **Birthday cards** (`birthday_card_templates`, `/birthdays/cards`) — the
  same JSON design engine as the ID cards (`CardCanvas`, `DesignTab` with
  `variant="birthday"`) plus **birthday variables** resolved in
  `CardCanvas`: `first_name`, `turns_age` («يتمّ N سنة» with Arabic plurals),
  `birthday_day`, `birthday_month`, `birthday_date`, `birthday_year`,
  `gift_points` (`CardPersonData.birthday_year / gift_points`). A festive A6
  landscape default (`DEFAULT_BIRTHDAY_DESIGN`). Scoped church → service? →
  class? with **one default per exact scope** (trigger); the card used for a
  child is the **most specific** template that covers him (`templateFor`,
  mirrored in SQL). **Print tab** (`BirthdayPrintTab`): the print source is
  the **month's children** (month navigator + scope, select all / only not
  yet printed), same mm-exact hidden print sheet (`@page` sized, cols × rows,
  margins, gaps, cut marks, center lines) as the card module; after printing
  a `card_printed` greeting is logged per child. **Single card**
  (`BirthdayCardModal`): preview → **إرسال الصورة** rasterizes the card to a
  300-dpi PNG (`modern-screenshot`) and opens the phone's share sheet (Web
  Share API with files → WhatsApp etc.; desktop fallback downloads the PNG
  and opens the wa.me chat) and logs `card_shared`; **تنزيل PNG**; **طباعة**
  one card on its own page.
- **Settings** (`birthday_settings`, `/birthdays/settings`) — `gift_points`
  and `message_template` per church (church manager / owner) or one global
  row (`church_id null`, owner). Effective = church row → global → defaults.
- **Home widget** (`UpcomingBirthdaysWidget`) — `birthdays_upcoming(7,
  working-date)`: today's and the next 7 days' birthdays (wraps Dec → Jan,
  Feb 29 → Feb 28 via `next_birthday()`), with call / WhatsApp shortcuts;
  module-gated, realtime.
- **Child portal** — `child_portal_birthday(nid)` (anon, SECURITY DEFINER):
  is today his birthday, age he turns, days left, the card template of his
  scope (only when the module is granted to that scope via
  `module_granted_for`) + constants, and this year's gift. `BirthdayBanner`
  on `/child` shows a festive banner with his card (downloadable PNG) and
  gift on the day, a countdown in the 7 days before.
- **Performance** — expression index `idx_persons_birth_month_day` so the
  month query is an index scan; `birthdays_in_month` is one RPC returning
  greetings as JSON per row (no N+1); realtime on `birthday_greetings`,
  `birthday_card_templates`, `birthday_settings` (debounced).
- **Tests** — `supabase/tests/birthday_module_test.sql`: module gate,
  one-row-per-person + ordering + `turns_age` + scope narrowing, upcoming
  window / year wrap / leap day / today, greeting trigger + RLS (own scope
  only, no direct `gift` insert), gift validation (points, scope, double
  gift through another enrollment), servant can't cancel, manager cancel
  restores balance, re-gift, template RLS + one default per scope + chain,
  settings RLS (service manager refused, one global row), anon portal (most
  specific card, fallback to church card, gift, points source), realtime
  publication. Validated on PostgreSQL 17 with all 28 migrations →
  «BIRTHDAY TESTS PASSED» (store + exam suites still pass).

## Messages module — migration 0029 (وحدة الرسائل)
In-app conversations between children and their servants, and between
servants. Optional module, visible only where the owner grants it
(`/owner/modules` → الرسائل).

- **Model** — ONE table `chat_messages` with four kinds:
  `child` (the conversation of ONE enrollment — the child + every servant
  whose scope covers it), `staff` (direct chat between two servants, grouped
  by a generated `staff_pair`), `broadcast_children` (an announcement to a
  scope: class / service / church / all churches, null = all) and
  `broadcast_staff` (an announcement to the servants inside a scope). Exactly
  one sender (`sender_profile_id` or `sender_person_id`, trigger-checked),
  `body` ≤ 4000 chars and/or `image_url`. `chat_read_state (reader × bucket →
  last_read_at)` where the bucket is `e:<enrollment>` / `s:<profile>` / `b`.
- **Who sees what** — `chat_message_visible(...)` (one IMMUTABLE expression,
  InitPlan pattern from 0019): `child` rows follow `enrollment_visible`, so a
  child's message reaches **all servants allowed on that tenant**; `staff`
  rows only the two parties; `broadcast_children` reaches the servants of the
  audience scope (the owner and the sender always); `broadcast_staff` reaches
  the servants **inside** the scope (a service manager's broadcast to his
  service does not go up to the church manager). RLS select uses it; there
  are no insert / update policies (writes only via RPCs); delete = own
  messages, or any child / broadcast message inside a manager's scope.
- **Who may send** — `chat_send(p jsonb)` (SECURITY DEFINER, module checked):
  to **selected children** → each enrollment must be `enrollment_visible`;
  to a **children scope** → `scope_contains` (class servant → his class,
  service manager → his service or a class in it, church manager → his
  church / service / class, owner → anything incl. «كل الكنائس»), chain
  validated; to **selected servants** → `chat_staff_reachable`: the target's
  scope is *contained* in mine (below me in the hierarchy, never the owner)
  **or** he already wrote to me (reply always allowed); to a **staff scope** →
  `scope_contains`. Sending marks the bucket read for the sender.
- **Reading** — `chat_inbox()` returns every conversation (last message,
  names, unread per bucket) + `broadcasts_unread` / `broadcasts_last` /
  `total_unread`; `chat_thread(bucket, before, limit)` pages a conversation
  (the `e:` bucket merges the child's direct messages with the announcements
  that reached him — exactly what the child sees); `chat_unread_total()`
  feeds the header bell; `chat_staff_recipients()` lists the servants I may
  write to; `chat_audience_count()` previews a scope.
- **Child portal** (anon, token = national id, pattern of 0021) —
  `child_chat_overview` (one row per enrollment where the module is granted
  via `module_granted_for`, last message + unread), `child_chat_messages`,
  `child_chat_send` (own enrollments only, 30 msgs / 10 min rate limit),
  `child_chat_mark_read`, `child_chat_unread`. Storage policy lets the portal
  upload pictures into `photos/child-messages/`.
- **Frontend** — registry entry `messages` (`src/lib/modules.ts`), gate
  `src/app/messages/layout.tsx`, data layer `src/lib/chat.ts` (types, Arabic
  error mapping, RPC wrappers, day grouping), shared bits
  `src/components/messages/ChatBits.tsx` (header, avatar, bubble, day
  divider, composer with picture compression + upload, image viewer),
  `MessagesBell` in `AppHeader` (realtime unread), pages `/messages`
  (inbox), `/messages/new` (3-step composer), `/messages/[bucket]` (thread).
  Child portal: `useChildMessages` hook in `ChildShell` (header bell,
  side-menu entry, realtime), `/child/messages`, `/child/messages/[enrollment]`,
  home card. Children page: the «رسالة داخلية» channel now sends the
  template text as an in-app message (`chat_send`) and logs it in
  `contact_log` like WhatsApp / SMS.
- **Tests** — `supabase/tests/messages_module_test.sql`: module gate
  (servant + child), child message visible to class / service servants only
  (no leak to another class or church), reply + read state (servant and
  child), broadcasts per role (class servant ✓ class ✗ service; service
  manager ✓ service ✗ church; church manager ✓ church ✗ all; owner ✓ all;
  chain check), what each child receives (4 / 3 / 1), staff hierarchy (class
  servant can't write up or sideways, service manager reaches his 2 servants
  not the church manager, reply after being written to, staff broadcast not
  delivered upwards), deletes (author / manager / none), direct table writes
  blocked, realtime publication. Validated on PostgreSQL 17 with all 29
  migrations → «MESSAGES TESTS PASSED» (store / exam / birthday suites still
  pass).

## Online classes module — migration 0030 (وحدة الفصول الأونلاين)
Live online lessons with a real attendance algorithm. Optional module,
visible only where the owner grants it (`/owner/modules` → الفصول الأونلاين).

- **Model** — `online_classes` (scope church → service? → class?, title,
  `starts_at` / `ends_at`, platform `youtube | facebook | zoom | meet | other`
  + `stream_url`, status `scheduled | live | ended | cancelled`, `started_at` /
  `ended_at`, `chat_enabled`, optional `exam_id` and `event_id` — both must
  cover the class scope, trigger-checked — and the **per-class rules**
  `min_time_percent` (default 60), `checks_required` (3),
  `checks_min_success` (2, ≤ required), `min_answers` (0), `check_seconds`
  (60), `attendance_points`). `online_class_participants` (one row per
  enrollment × class: `first_joined_at`, `last_seen_at`, `left_at`,
  `total_seconds`, `sessions_count`, `checks_ok` / `checks_late`,
  `answers_count` / `correct_count`, `messages_count`, `final_status` /
  `final_percent`, `override_status`, `attendance_log_id`);
  `online_class_sessions` (join → heartbeat every 30 s → leave; a gap > 90 s
  closes the session); `online_class_checks` + `online_class_check_responses`
  (unique per check × participant, `ok` / `latency_ms`, 5 s server grace —
  late is recorded but not counted); `online_class_questions` (MCQ `options`
  jsonb + `correct_index` + `points`, or free text; `draft | open | closed`)
  + `online_class_answers` (once per participant, graded server-side, points
  via `points_log`); `online_class_messages` (servant XOR participant sender).
- **Attendance algorithm** — `online_evaluate(class, participant)`: presence
  seconds = union of the sessions clipped to the live span
  `[started_at, ended_at | now]`; `percent = seconds / span`;
  **present ⇔ `percent ≥ min_time_percent` AND
  `checks_ok ≥ least(checks_min_success, checks_sent)` AND
  `answers_count ≥ min_answers`**; a servant `override_status` always wins.
  Spec example (60 % / 3 required / 2 successful): أحمد 100 % 4/4 → حاضر,
  مريم 83 % 3/4 → حاضر, يوسف 50 % 1/4 → غائب, مارك 33 % 2/4 → غائب.
  `online_class_end` → `online_class_finalize` closes open sessions,
  evaluates everyone and writes ONE `attendance_log` row per present child
  (`points_delta = attendance_points`, `event_id`, `attended_on` = Cairo date
  of the start) — idempotent (re-finalize updates / deletes rows);
  `online_class_reopen` removes the written attendance and goes back to
  live; `online_class_set_override` re-finalizes when the class is ended.
- **Servant RPCs** (writer = `scope_contains` on the class scope) —
  `online_class_start`, `online_class_send_check(class, prompt, seconds)`,
  `online_class_live_stats(class)` (one jsonb: span, checks sent,
  participants with live %, online flag, checks, answers, rule result,
  totals), `online_class_messages_list`; questions are plain table CRUD
  under RLS. Messages: insert only as self.
- **Child portal** (anon, token = national id, pattern of 0021) —
  `child_online_classes` (classes whose scope covers one of my enrollments
  and where the module is granted via `module_granted_for`), `child_online_*`
  join / heartbeat / leave / check_respond / answer / messages / chat_send
  (rate 30 msgs / 5 min, `chat_disabled`, `class_not_live`). Every payload
  carries `server_now` so the countdowns are anchored on the server clock;
  `correct_index` is only revealed once a question is closed.
  `child_portal_points` gains source `online`; `child_portal_attendance`
  labels the online rows «فصل أونلاين — title».
- **Frontend** — registry entry `online` (`src/lib/modules.ts`), gate
  `src/app/online/layout.tsx`, data layer `src/lib/online-classes.ts`
  (types, labels, Arabic error mapping, CRUD + RPC wrappers, platform
  detection / embed builder, rules label), shared bits
  `src/components/online/OnlineBits.tsx` (header, status / platform badges,
  `StreamPlayer` iframe for YouTube / Facebook or «افتح البث» card, elapsed
  label), `ClassFormModal`, `LiveQuestionModal`, `ParticipantsTab` (totals,
  filters, per-child numbers, override, Excel), `QuestionsTab`, `LiveChat`
  (shared with the child room), `SettingsTab`; pages `/online` (hub) and
  `/online/[id]` (control room — realtime + 15 s stats poll). Child portal:
  `useChildOnline` in `ChildShell` (side-menu entry, realtime), home card,
  `/child/online` (list), `/child/online/[id]` (live room: join, heartbeat
  while visible, leave on unmount, full-screen attention-check popup,
  `ChildQuestionCard`, chat, final result).
- **Tests** — `supabase/tests/online_classes_test.sql`: module gate (servant
  + child), RLS per class scope, rule validations, exam / event scope
  triggers, join / heartbeat / leave sessions, 4 checks with the spec
  distribution + a late response, questions (draft rejected, grading,
  points, no `correct_index` leak while open, reveal on close), chat +
  rate limit + disabled, another servant's isolation, the 7:00–8:00
  timeline of the spec → end → 2 attendance rows + points, portal labels,
  override present / reset, reopen → re-end, realtime publication.
  Validated on PostgreSQL 17 with all 30 migrations → «ONLINE TESTS PASSED»
  (store / exam / birthday / messages suites still pass).

## Achievements module — migration 0031 (وحدة الإنجازات)
Simple achievements (badge + picture + points) — no levels, tiers, leaderboards
or quests. Optional module, visible only where the owner grants it
(`/owner/modules` → الإنجازات). Reuses the existing points, attendance, scope
and permission systems; nothing is duplicated.

- **Model** — `achievements` (scope `church_id` → `service_id?` → `class_id?`
  → `event_id?` (null = church-wide / any event; chain + event overlap
  trigger-checked), `name`, `description`, `image_url` (webp ≤ 512 px in the
  `achievements/` photo folder), `points ≥ 0`, `is_active`, `kind`
  `normal | attendance`, `award_mode` `once | multiple` (+ `max_awards`,
  `min_interval_days` — must be null for `once`), `attendance_rule`
  `count | streak` + `attendance_target` (required for `attendance`, null for
  `normal`)). `user_achievements` (one row per award: `enrollment_id` +
  denormalised person / scope, `points_awarded`, `awarded_at`, `awarded_by`
  (null = automatic), `source` `manual | attendance`, `attendance_log_id`,
  `event_id`, `points_log_id`, `note`). Points always flow through
  `points_log` (existing `on_points_log_insert` trigger updates
  `enrollments.points`); revoking inserts a compensating −points row.
- **Rules** — `achievement_progress(achievement, enrollment)` →
  `current_value / target_value / awards_count / last_awarded_at / eligible /
  block` (`inactive | out_of_scope | already_awarded | max_reached | too_soon |
  not_found`). `count` = distinct attended days since the day of the last
  award; `streak` = consecutive distinct attended days (a gap > 7 days breaks
  it), restarting after each award. `once` → a second award is refused;
  `multiple` → refused when `awards_count ≥ max_awards` or the last award is
  younger than `min_interval_days`.
- **Awarding** — manual: `achievement_award(achievement, enrollment, note)`
  (caller must see the enrollment and the achievement, module granted) →
  `{award_id, points, balance_after}`; `achievement_revoke(award, note)`
  (owner / church / service manager of the scope, or the awarder).
  Automatic: `zz_trg_achievements_on_attendance` (after insert on
  `attendance_log`, only where `module_granted_for('achievements', …)`)
  evaluates every active attendance achievement covering the enrollment
  (and the event, if the achievement is event-bound) and grants non-strictly
  — so scanner, event attendance and online-class finalisation all award
  without any frontend change. Errors are downgraded to warnings so
  attendance is never blocked.
- **Permissions** — `achievement_permissions()` → `{view, create, edit,
  delete, award}` from the existing roles: everyone with the module sees
  achievements overlapping their scope; create / edit need `scope_contains`;
  delete additionally owner / church_manager / service_manager; award needs a
  visible enrollment. `user_achievements` is read-only from the client
  (writes only through the RPCs).
- **Frontend** — `src/lib/achievements.ts` (types, labels, fetchers,
  `saveAchievement`, `awardAchievement`, `revokeAchievement`,
  `fetchChildAchievements`); `src/components/achievements/*`
  (`AchievementBits` — thumb, `ProgressBar`, `EarnedCard`, scope label;
  `AchievementFormModal` (reuses the store `ScopeSelectors` / photo compress
  + upload); `EarnersModal`; `AwardModal`); pages `/achievements`
  (module-gated layout, KPIs, search, scope + kind filters, realtime).
  Children page: «الإنجازات» job (only when the module is visible) opens the
  per-child `AwardModal` and patches the balance; `PointsLogModal` labels
  achievement points «🏆 إنجاز». Child portal: `ChildProvider` fetches
  `child_portal_achievements` once (realtime on `user_achievements` /
  `attendance_log`), `useChildAchievements` in `ChildShell` (side-menu entry),
  home card, `/child/achievements` (KPIs, «في الطريق» progress bars, «حصلت
  عليها» cards), points page filter `إنجازات`.
- **Tests** — `supabase/tests/achievements_module_test.sql`: module gate,
  constraint / scope-chain validation, RLS per role (class servant vs
  service manager, delete rights), manual award once / too_soon /
  max_reached / cross-class forbidden / direct insert blocked, auto award on
  the 3rd attendance, streak progress 2/4 → award at 4 → restart after a
  gap, other-class isolation, earners + enrollment progress RPCs, revoke
  rules + refund, child portal earned / progress / points labels, portal
  and trigger module gates, realtime publication. Validated on PostgreSQL
  17 with all 31 migrations → «ACHIEVEMENT TESTS PASSED» (store / exam /
  birthday / messages / online suites still pass).

## Occasions module — migration 0032 (وحدة الفعاليات)
Trips, conferences, celebrations, activities and special events for a
church / service / class. Optional module, visible only where the owner
grants it (`/owner/modules` → الفعاليات). Reuses persons / enrollments,
the points system, the scope + module RBAC and the child-portal token
pattern; nothing is duplicated.

- **Model** — `occasions` (scope `church_id` → `service_id?` → `class_id?`
  (null = all, chain trigger-checked), `title`, `description`, `image_url`
  (webp ≤ 1024 px in the `occasions/` photo folder), `kind` `trip |
  conference | celebration | activity | other`, `starts_at` / `ends_at`,
  `location` + `location_url`, `organizer` + `organizer_phone`,
  `registration_deadline`, `capacity` (null = unlimited), `auto_confirm`,
  `checkin_points`, `status` `draft | published | cancelled | completed`).
  `occasion_registrations` (one row per enrollment × occasion — unique;
  denormalised person / scope filled by trigger; `status` `pending |
  confirmed | checked_in | cancelled`; `ticket_code` unique `T-` + 10 hex
  (the e-ticket QR); `source` `self | leader`; who / when for every step;
  `note`; `points_log_id` of the check-in points). `occasion_checklist_items`
  (label · required · order) + `occasion_checklist_marks` (✓ per
  registration, who / when). `occasion_notifications` (`kind` `announcement
  | reminder | status`; `registration_id` null = everyone who sees the
  occasion, else one child's automatic status row).
- **Rules** — every status change goes through ONE internal path
  (`occasion_apply_status`): capacity is re-checked when a cancelled
  registration becomes active again (`occasion_full`); moving to
  `checked_in` inserts `+checkin_points` into `points_log` (existing
  trigger updates the balance), leaving `checked_in` or deleting the row
  inserts the compensating −points; every change writes a status
  notification for the child. Children may register only while
  `published`, before `starts_at`, before `registration_deadline` and
  while seats remain; `auto_confirm` → `confirmed` directly, else
  `pending`. They may cancel only before the start and not after
  check-in. Leaders bypass the deadline, never the capacity.
- **Permissions** — `occasion_permissions()` → `{view, create, edit,
  delete, manage}`: view = module + `scope_overlaps`; create / edit =
  `scope_contains` (RLS); delete additionally owner / church_manager /
  service_manager; **manage** (register / status / check-in / checklist
  marks) = the caller sees the occasion AND the child's enrollment
  (`enrollment_visible`) — so a class servant handles his own children on
  a service-wide trip; announcements need `scope_contains` on the
  occasion. `occasion_registrations` is insert / update-protected: writes
  only via RPCs. `anon` reads nothing directly.
- **Leader RPCs** — `occasion_register(occasion, enrollment, status)`,
  `occasion_set_status(registration, status, note)`,
  `occasion_checkin(occasion, code)` (code = ticket **or** the child's
  national id → `{result: checked_in | already_checked_in, person, points}`;
  raises `unknown_code / not_registered / registration_cancelled`),
  `occasion_checklist_mark(registration, item, done)`,
  `occasion_participants(occasion)` (names / pictures / checklist done),
  `occasion_counts(uuid[])` (pending · confirmed · checked_in · cancelled ·
  active for the dashboard — whole occasion, so remaining seats are real).
- **Child portal** (anon, token = national id) — `child_portal_occasions`
  (board: published occasions covering one of my enrollments where the
  module is granted, + recent ones I took part in; each with
  `can_register`, `remaining`, `my_registration`, `last_notification`),
  `child_portal_occasion(id)` (+ `checklist` with my marks +
  `notifications` mine + broadcast), `child_portal_occasion_register`
  («أنا مشارك»), `child_portal_occasion_cancel`. `child_portal_points`
  learns source `occasion` («حضور فعالية 🎟️ …»).
- **Frontend** — registry entry `occasions` (`src/lib/modules.ts`), gate
  `src/app/occasions/layout.tsx`, data layer `src/lib/occasions.ts`
  (types, labels, phase / registration helpers, Cairo datetime-local
  conversion, Arabic error mapping, CRUD + RPC wrappers, child fetchers);
  `src/components/occasions/*` (`OccasionBits` — header, cover, badges,
  board card, info list, stats row, **TicketCard** QR, avatar;
  `OccasionFormModal`; `AddParticipantModal` (server-paged scoped search);
  `ParticipantSheet` (status stepper, checklist ✓, ticket, note, remove);
  `CheckinTab` (camera QR via the shared `QrScanner`, manual code, name
  fallback, result card, history); `ChecklistTab`; `AnnouncementsTab`);
  pages `/occasions` (board, KPIs, filters, realtime) and
  `/occasions/[id]` (4 tabs, realtime on all five tables, CSV export,
  share). Child portal: `ChildProvider` fetches `child_portal_occasions`
  once (realtime on occasions / registrations / notifications),
  `useChildOccasions` in `ChildShell` (side-menu entry with a badge),
  home card, `/child/occasions` (القادمة · مشاركاتي · السابقة),
  `/child/occasions/[id]`, points page filter `الفعاليات`.
- **Tests** — `supabase/tests/occasions_module_test.sql`: module gate
  (servant + child), constraints / scope chain, RLS per role (class
  servant vs service manager, announce / checklist write rights), leader
  registration (direct insert blocked, duplicate, cross-class forbidden,
  capacity, out-of-scope), counts, participant visibility per class,
  child board / can_register / deadline / full / draft hidden /
  cross-class hidden, detail checklist + notifications + ticket, self
  cancel → seat freed → self register pending, confirm + note, checklist
  marks (idempotent, unknown item), check-in by ticket (+points, case
  insensitive, already), by national id, unknown code, cancelled child,
  refund on leaving checked_in and on delete, status notifications,
  portal points label, no cancel after check-in, started occasion, anon
  direct reads blocked, realtime publication. Validated on PostgreSQL 17
  with all 32 migrations → «OCCASION TESTS PASSED» (store / exam /
  birthday / messages / online suites still pass).

## Notifications module — migration 0034 (وحدة الإشعارات)
Create → choose recipients → send now / schedule → receive (in-app bell +
device push) → history, plus **Trigger → Recipient → Notification**
automations for existing app events. Optional module, visible only where
the owner grants it (`/owner/modules` → الإشعارات). The database decides
WHO gets WHAT and WHEN; the Next.js API route delivers Web Push with the
VAPID keys. Nothing is duplicated — persons / enrollments, scope + module
RBAC and the child-portal token pattern are reused.

- **Model** — `notifications` (one send: `title`, `body`, `image_url`
  (`notifications/` photo folder), `link_url` (in-app path), `target_kind`
  `all | church | service | class | group | person` + scope ids /
  `group_id` / `enrollment_id`, `audience` `children | staff`,
  `scheduled_at`, `status` `scheduled | sent | failed | cancelled`,
  `recipients_count`, `source` `manual | automation`, `automation_id`).
  `notification_recipients` (the inbox — one row per recipient:
  `enrollment_id` + `person_id` (child) **or** `profile_id` (servant),
  text snapshot, `read_at`, `push_status` `pending | sent | failed |
  no_device`). `notification_automations` (`trigger_key`, `recipient`
  `student | class_servants`, `name`, `title_template` / `body_template`
  with `[متغير]` placeholders, `link_url`, scope church → service → class
  (null = all), `is_active`, `config` jsonb e.g. `{"min_points": 5}`).
  `notification_automation_runs` («fired once» guard per automation ×
  reference). `push_subscriptions` (one device: `endpoint` https-only,
  `p256dh`, `auth`, bound to `profile_id` **or** `person_id`, `user_agent`,
  `last_seen_at`).
- **Sending** — `notif_send(jsonb)` validates the target against
  `scope_contains` (all churches = owner only; group = my own shepherd group
  or, for managers, any servant's group in scope; person =
  `enrollment_visible`), counts the audience, and either materialises the
  recipient rows immediately (`sent`) or stores the row as `scheduled`.
  `notif_audience_count(jsonb)` powers the live «سيصل إلى N» counter,
  `notif_cancel(uuid)` cancels a scheduled send, `notif_history(limit,
  before)` returns the history with `can_cancel`. Recipients are
  computed once from the current enrollments (children) or the servants
  whose scope overlaps (staff).
- **Automations** — triggers `attendance`, `points_added`,
  `points_deducted` (both with `min_points`), `achievement_earned`,
  `online_class_started`, `exam_published` (fires at `opens_at` through
  `notif_tick`), `occasion_reminder` (`hours_before`). Each trigger
  function collects the variables (`[الاسم]`, `[الاسم الأول]`, `[الفصل]`,
  `[الخدمة]`, `[النقاط]`, `[السبب]`, `[المناسبة]`, `[الفصل الأونلاين]`,
  `[الامتحان]`, `[الإنجاز]`, `[الفعالية]`, `[التاريخ]`, `[الوقت]`…) and calls
  `notif_fire_enrollment(trigger, enrollment, vars, default_link, ref)`
  (student, or the class servants of that enrollment) or
  `notif_fire_scope(...)`. The engine picks every active automation whose
  scope contains the enrollment, in a church where the module is granted,
  renders the templates (`notif_render`), writes one `notifications` row
  (`source = automation`) + recipient rows and guards repeats with
  `notification_automation_runs`. Triggers are `zz_notif_on_*` `after
  insert` on `attendance_log` / `points_log` / `user_achievements` and
  `after insert or update` on `online_classes` (→ live) / `exams`. They
  never raise — a failure inside an automation is swallowed so the
  original write (attendance, points…) always succeeds.
  **Adding a trigger later** = (1) add the key to the `trigger_key` check
  + `TRIGGERS` in `src/lib/notifications.ts` (label, variables, default
  link, optional `config`); (2) one new trigger function that builds the
  vars and calls `notif_fire_enrollment` / `notif_fire_scope`; (3) a test
  section. No UI change is needed.
- **Scheduling / tick** — `notif_tick()` (service_role) releases due
  `scheduled` sends, fires `occasion_reminder` and `exam_published`
  when their time comes. It is scheduled with **pg_cron** (`notif_tick`,
  every minute) when the extension exists and is also invoked by
  `GET /api/notifications/dispatch`. `vercel.json` registers a **daily**
  Vercel cron (`0 3 * * *` — the Hobby plan rejects per-minute schedules
  and the deployment fails with «Hobby accounts are limited to daily cron
  jobs»); minute-level timing comes from pg_cron and from the clients:
  the servant header bell kicks `POST /api/notifications/dispatch` on
  start and every 2 minutes while visible, the child portal on open, and
  the compose page right after a send. Enable **pg_cron** in Supabase
  (Database → Extensions) and re-run the `do $$ … cron.schedule …` block
  at the end of 0034 if the extension was enabled after the migration.
- **Inbox** — `notif_inbox(limit)`, `notif_unread_count()`,
  `notif_mark_read(uuid[] | null = all)` for servants (rows where
  `profile_id = auth.uid()`); `child_notifications(token, limit)`,
  `child_notif_unread(token)`, `child_notif_mark_read(token, ids)` for the
  child portal (anon, token = national id). `notif_permissions()` →
  `{visible, can_send_all, can_manage, role}`.
- **Push (device tray)** — `push_subscribe(jsonb)` / `push_unsubscribe
  (endpoint)` (servants) and `child_push_subscribe(token, jsonb)` /
  `child_push_unsubscribe(token, endpoint)` (children) store the
  `PushManager` subscription (https endpoints only, upsert by endpoint).
  `notif_push_queue(limit)` (service_role) returns pending recipient ×
  device pairs (recipients without any device are marked `no_device`);
  `notif_push_mark(jsonb)` records `sent` / `failed` and deletes devices
  that answered 404 / 410. `src/lib/server/push-dispatch.ts` runs
  `notif_tick` → queue → `web-push` → mark; `POST` (from the app after a
  send) and `GET` (Vercel cron, optional `CRON_SECRET` bearer) hit
  `/api/notifications/dispatch`; `/api/notifications/vapid` serves the
  public key. `public/sw.js` (`diocese-v4`) handles `push`
  (`showNotification` with title / body / image / `data.url`),
  `notificationclick` (focus an open tab and navigate, or open the link)
  and `pushsubscriptionchange`; it also posts `{type: 'push'}` to open
  tabs so the bell refreshes instantly. **iOS**: Web Push works only after
  the app is added to the Home Screen (iOS 16.4+) — `PushToggle` shows
  that hint.
- **RLS** — `notifications`: select = module + own or `scope_overlaps`;
  insert only through `notif_send`; update / delete = creator or owner /
  church_manager / service_manager in scope. `notification_recipients`:
  own rows, rows of a send I created, or (managers) of any visible send —
  a class servant never sees another servant's inbox. `notification_
  automations`: select `scope_overlaps`, write `scope_contains`.
  `push_subscriptions`: own rows only; `anon` reads nothing directly.
- **Frontend** — registry entry `notifications` (`src/lib/modules.ts`,
  `Bell`), gate `src/app/notifications/layout.tsx`, data layer
  `src/lib/notifications.ts` (types, `TRIGGERS`, labels, `renderPreview`,
  RPC wrappers, Arabic error mapping) and `src/lib/push.ts`
  (`pushSupport`, `enablePush`, `disablePush`, `syncPushRegistration`,
  `kickDispatcher`). Components `src/components/notifications/*`
  (`NotifBits` — header, status badge, toast, `NotifCard`, **PushToggle**;
  `AutomationForm`; `NotificationsBell` in `AppHeader`). Pages
  `/notifications` (history + KPIs + filters, cancel / delete, realtime),
  `/notifications/new` (content → recipients with live count → now /
  schedule → preview), `/notifications/automations` (list, active toggle,
  edit, delete, example automation), `/notifications/inbox` (servant
  inbox). Child portal: `ChildProvider` loads `child_notifications`
  (realtime on `notification_recipients` + SW messages),
  `useChildNotifications` in `ChildShell` (header bell with unread badge,
  side-menu entry, silent push re-sync), `/child/notifications` (list,
  mark read, tap → related page, PushToggle).
- **Env / setup** — `npx web-push generate-vapid-keys` once, then set
  `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`,
  `VAPID_SUBJECT` (`mailto:`), `SUPABASE_SERVICE_ROLE_KEY` and optionally
  `CRON_SECRET` in Vercel; `vercel.json` registers the dispatch cron.
  Without VAPID keys the module still works in-app (bell / inbox) — only
  the device tray is skipped.
- **Tests** — `supabase/tests/notifications_module_test.sql`: module gate,
  send validation (scope, group, person, audience), audience counts,
  immediate vs scheduled send + cancel + tick release, history, servant
  inbox (unread / mark read / RLS leak between class servants), child
  portal (unread, inbox, link, mark one / all, cross-child leak), push
  subscriptions (owner, upsert, https-only, service_role-only queue,
  child subscribe / unsubscribe, anon read blocked), automations
  (`min_points`, disabled, rendering with `[variables]`, default link,
  student + class servants + manager recipients, class-B leak, once
  guard), module grant removed → automations silent, push queue / mark /
  gone device, realtime publication. Validated on PostgreSQL 17 with all
  34 migrations → «NOTIFICATION TESTS PASSED» (achievements / birthday /
  exam / messages / occasions / online / store suites still pass).

## Exam Results module — migration 0038 (وحدة نتائج الامتحانات)
Score-based results for real (paper) exams — separate from the
multiple-choice **Exams** module (0027).

- **Model** — `grading_systems` (`church_id` null = global / owner-only,
  `is_default`) → `grading_grades` (name, `min_percent`..`max_percent`,
  color, `is_pass`, order). `result_exams` (scope church → service? →
  class?, `exam_date`, `academic_year`, `status` draft | open | completed |
  archived, `grading_system_id`, `grade_overall`, `grade_subject`,
  `pass_rule`, `pass_percent`, `absent_as_zero`, `min_required_subjects`,
  `locked` / `locked_at` / `locked_by`, `published_at`) → `result_subjects`
  (`full_degree`, `pass_degree`, `weight`, `sort_order`, `is_bonus`) →
  `exam_results` (`enrollment_id` × `subject_id`, `score`, `status`, `note`,
  computed `percent` / `grade_id` / `passed`, created / edited by + at).
- **Computation lives in the DB** — the write trigger validates
  (enrollment in the exam scope, subject in the exam, `score ≤ full`, not
  negative, not locked / archived) and computes percent → grade → passed.
  `result_summary_core(exam, enrollment?)` returns per-student totals
  (weighted when every subject has a weight), overall percent, grade,
  pass / fail (`pass_rule`) and status `not_entered | incomplete | draft |
  absent | passed | failed`; `result_exam_summary(exam)` adds competition
  ranking (`rank` by percent, `rank_score` by total — ties 1, 2, 2, 4).
  Changing a subject's full / pass degree or the grading bands re-computes
  affected rows (`result_recalc`).
- **Locking** — `result_exam_set_lock(exam, locked)` is the only path
  (direct `update locked` raises `use_lock_rpc`); locked exams reject every
  result write (`results_locked`). Requires `results.lock`.
- **Bulk** — `result_save_bulk(exam, rows jsonb)` upserts one row per
  `{subject_id, enrollment_id, score, status, note}` in its own savepoint
  and returns `[{subject_id, enrollment_id, ok, error}]`, so one bad row
  never blocks the batch (the client shows failed rows + «إعادة المحاولة»).
  `result_copy_from_exam`, `result_clear(exam, subject?, enrollments?)`,
  `result_exam_duplicate`, `grading_system_duplicate`.
- **Permissions** — `result_can(key)` = `module_visible('results')` and
  (owner / church_manager / service_manager in scope, or key is
  `results.view` / `results.stats`, or `has_permission(key)` through a
  permission profile). Keys: view · enter · edit · import · export ·
  manage_exams · manage_subjects · manage_grading · lock · stats.
- **UI** — `/results` (exams), `/results/[id]` (dashboard · subjects ·
  results · ranking · settings), `/results/bulk`, `/results/import`,
  `/results/reports`, `/results/grading`, `/results/students`. Shared code
  in `src/lib/results.ts` (types, fetchers, `validateScore`, `gradeFor`,
  `computeStats`, `saveBulk` with chunked progress) and
  `src/components/results/*` (`ResultBits`, `ExamFormModal`,
  `SubjectFormModal`, `StudentResultModal`).
- **Child portal** — `child_portal_results(national_id)` (anon, published
  exams only) is ready for a `/child/results` page (not wired yet).
- **Tests** — `supabase/tests/exam_results_test.sql`: grading bands, exam
  scope validation, score validation, bulk save with partial failure,
  weighted percent, pass rules, ranking ties, lock enforcement, copy /
  clear, RLS per role → «EXAM RESULTS TESTS PASSED».

## Rolled back: Messaging module — migration 0029 (وحدة الرسائل والإشعارات)
The messaging & notifications module (PR #51, `0029_messaging.sql`) was
**reverted** — the code is back to the 0028 state; the new, simpler messages module above (`0029_chat_messages.sql`) replaces it. If `0029_messaging.sql`
was already applied to your Supabase project, run
`supabase/rollbacks/0029_messaging_rollback.sql` once in the SQL editor.
It drops everything 0029 created (10 tables, ~60 `msg_*` / `child_portal_*`
functions, the `zz_msg_on_*` triggers on `attendance_log` / `points_log` /
`enrollments` / `exam_attempts` / `store_orders` / `data_change_requests` /
`profiles`, the `photos_messages_upload` storage policy, the `messaging_tick`
pg_cron job and the `messaging` row in `module_access`) and touches nothing
else. Verified on PostgreSQL 17: schema after `0001…0029 + rollback` is
identical (`pg_dump -s` diff) to a clean `0001…0028` install; idempotent.
Also remove the `/api/cron/messaging` cron and `CRON_SECRET` env var from
Vercel if they were added.

## Features Not Yet Implemented
- Attendance history per date (per-person list view for servants)
- PDF report export (Excel is done in الإحصائيات)

## Recommended Next Steps
1. Run migrations `0017` → `0036` (`0036_home_widgets_and_names.sql` powers ودجات الرئيسية & أسماء الصفحات; `0035_app_customization.sql` powers تخصيص التطبيق — taskbar & header layout; `0034_notifications.sql` powers وحدة الإشعارات — also set the VAPID env vars; `0032_occasions.sql` + `0033` power وحدة الفعاليات; `0031_achievements.sql` powers وحدة الإنجازات; `0030_online_classes.sql` powers وحدة الفصول الأونلاين; `0029_chat_messages.sql` powers وحدة الرسائل; `0028_birthdays.sql` powers وحدة أعياد الميلاد; `0027_exams.sql` powers وحدة الامتحانات; `0026_points_store.sql` powers وحدة إستبدال النقاط; `0022` powers event-bound points / calls / messages; `0023_call_feedbacks.sql` powers the call-feedback badge & إدارة نتائج الافتقاد; `0024_owner_module_access.sql` powers وحدة المالك & module visibility; `0025_shepherd_groups.sql` powers وحدة الأشابين) in Supabase SQL editor, then grant الأشابين from وحدة المالك → صلاحيات الوحدات
2. Deploy to Vercel and test the full approval flow
3. Per-person attendance history view

## Deployment
- **Platform**: Vercel + Supabase
- **Status**: ✅ Code complete for Phase 1 + performance/scale hardening (0019) + statistics tab (0020) + child portal & data change requests (0021) + event as 4th scope level with status badge (0022) + call-feedback badge & إدارة نتائج الافتقاد (0023) + owner module & per-scope module visibility (0024) + shepherds module الأشابين & «مجموعتي» (0025) + points store module إستبدال النقاط (0026) + exams module الامتحانات (0027) + birthdays module أعياد الميلاد (0028) + messages module الرسائل (0029) + online classes module الفصول الأونلاين (0030) + achievements module الإنجازات (0031) + occasions module الفعاليات (0032/0033) + notifications module الإشعارات (0034) + app customization تخصيص التطبيق — taskbar & header (0035) + home widgets & custom page names (0036) — awaiting Supabase project + Vercel connect
- **Last Updated**: 2026-09-12
0

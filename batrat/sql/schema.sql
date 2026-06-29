-- =========================================================
-- BAT RAT — قاعدة البيانات الكاملة
-- نفّذ هذا الملف بالكامل دفعة واحدة من: لوحة Supabase ← SQL Editor ← New query ← Run
-- =========================================================

create extension if not exists "pgcrypto";

-- ====================== 1) الجداول ======================

-- الملفات الشخصية (مرتبطة بنظام تسجيل الدخول auth.users في Supabase)
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique not null,
  display_name text not null,
  avatar_url text,
  bio text default '',
  created_at timestamptz default now()
);

-- المجتمعات
create table if not exists public.communities (
  id uuid primary key default gen_random_uuid(),
  name text unique not null,
  description text default '',
  cover_url text,
  creator_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz default now()
);

-- أعضاء المجتمعات
create table if not exists public.community_members (
  id uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text default 'member',
  joined_at timestamptz default now(),
  unique (community_id, user_id)
);

-- المنشورات (نصوص + صورة اختيارية، عامة أو داخل مجتمع)
create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles(id) on delete cascade,
  community_id uuid references public.communities(id) on delete cascade,
  content text not null,
  image_url text,
  created_at timestamptz default now()
);

-- الإعجابات
create table if not exists public.likes (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz default now(),
  unique (post_id, user_id)
);

-- التعليقات
create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  content text not null,
  created_at timestamptz default now()
);

-- الرسائل الخاصة (مراسلة بين مستخدمين)
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references public.profiles(id) on delete cascade,
  receiver_id uuid not null references public.profiles(id) on delete cascade,
  content text not null,
  is_read boolean default false,
  created_at timestamptz default now()
);

-- ====================== 2) صلاحيات الوصول عبر Data API ======================
-- مهم جدًا: مشاريع Supabase الجديدة (منذ مايو ٢٠٢٦) لا تكشف الجداول تلقائيًا
-- لواجهة البرمجة (Data API) إلا بعد منح صلاحية صريحة. بدون هذا القسم، التطبيق
-- سيظهر له خطأ "permission denied" أو لن يجد الجداول أبدًا.
grant select, insert, update, delete on table public.profiles          to authenticated;
grant select, insert, update, delete on table public.communities       to authenticated;
grant select, insert, update, delete on table public.community_members to authenticated;
grant select, insert, update, delete on table public.posts             to authenticated;
grant select, insert, update, delete on table public.likes             to authenticated;
grant select, insert, update, delete on table public.comments          to authenticated;
grant select, insert, update, delete on table public.messages          to authenticated;

-- ====================== 3) تفعيل الحماية على مستوى الصفوف (RLS) ======================
alter table public.profiles enable row level security;
alter table public.communities enable row level security;
alter table public.community_members enable row level security;
alter table public.posts enable row level security;
alter table public.likes enable row level security;
alter table public.comments enable row level security;
alter table public.messages enable row level security;

-- سياسات الملفات الشخصية
create policy "البروفايلات تظهر للجميع" on public.profiles
  for select using (true);
create policy "إنشاء البروفايل عند التسجيل" on public.profiles
  for insert with check (auth.uid() = id);
create policy "كل مستخدم يعدل بروفايله فقط" on public.profiles
  for update using (auth.uid() = id);

-- سياسات المجتمعات
create policy "المجتمعات تظهر للجميع" on public.communities
  for select using (true);
create policy "أي مستخدم مسجل ينشئ مجتمعًا" on public.communities
  for insert with check (auth.uid() = creator_id);
create policy "صاحب المجتمع يعدله" on public.communities
  for update using (auth.uid() = creator_id);

-- سياسات أعضاء المجتمع
create policy "عضويات المجتمعات تظهر للجميع" on public.community_members
  for select using (true);
create policy "المستخدم ينضم بنفسه" on public.community_members
  for insert with check (auth.uid() = user_id);
create policy "المستخدم يغادر بنفسه" on public.community_members
  for delete using (auth.uid() = user_id);

-- سياسات المنشورات
create policy "المنشورات تظهر للجميع" on public.posts
  for select using (true);
create policy "كل مستخدم ينشر بحسابه" on public.posts
  for insert with check (auth.uid() = author_id);
create policy "صاحب المنشور يعدله" on public.posts
  for update using (auth.uid() = author_id);
create policy "صاحب المنشور يحذفه" on public.posts
  for delete using (auth.uid() = author_id);

-- سياسات الإعجابات
create policy "الإعجابات تظهر للجميع" on public.likes
  for select using (true);
create policy "كل مستخدم يعجب بحسابه" on public.likes
  for insert with check (auth.uid() = user_id);
create policy "كل مستخدم يلغي إعجابه بنفسه" on public.likes
  for delete using (auth.uid() = user_id);

-- سياسات التعليقات
create policy "التعليقات تظهر للجميع" on public.comments
  for select using (true);
create policy "كل مستخدم يعلّق بحسابه" on public.comments
  for insert with check (auth.uid() = author_id);
create policy "صاحب التعليق يحذفه" on public.comments
  for delete using (auth.uid() = author_id);

-- سياسات الرسائل (خاصة جدًا — لا يراها إلا طرفاها)
create policy "الرسائل تظهر فقط لطرفيها" on public.messages
  for select using (auth.uid() = sender_id or auth.uid() = receiver_id);
create policy "المرسل فقط يضيف رسالته" on public.messages
  for insert with check (auth.uid() = sender_id);
create policy "المستلم يستطيع تعليم الرسالة كمقروءة" on public.messages
  for update using (auth.uid() = receiver_id);

-- ====================== 4) سياسات تخزين الصور ======================
-- ملاحظة: أنشئ أولًا حافظتين (Buckets) من Storage في لوحة Supabase باسمين دقيقين:
--   avatars   (صور البروفايل) — اجعلها Public
--   posts     (صور المنشورات) — اجعلها Public
-- ثم نفّذ هذا الجزء.

create policy "قراءة عامة لصور المنشورات والبروفايل"
  on storage.objects for select
  using (bucket_id in ('avatars', 'posts'));

create policy "رفع صور البروفايل للمستخدمين المسجلين"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'avatars');

create policy "رفع صور المنشورات للمستخدمين المسجلين"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'posts');

-- =========================================================
-- انتهى. الخطوة التالية: من القائمة الجانبية اذهب إلى
-- Database → Replication وفعّل Realtime لجدول messages
-- (هذا ما يجعل الرسائل تصل فورًا بدون تحديث الصفحة).
-- =========================================================

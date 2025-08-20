CREATE TABLE IF NOT EXISTS public.properties (
    id BIGSERIAL PRIMARY KEY,
    category TEXT NOT NULL,
    title TEXT NOT NULL,
    price TEXT,
    address TEXT,
    area TEXT,
    exclusive_area TEXT,
    approval_date TEXT,
    purpose TEXT,
    total_floors INTEGER,
    floor INTEGER,
    direction TEXT,
    direction_standard TEXT,
    transaction_type TEXT,
    parking INTEGER,
    maintenance_fee INTEGER,
    maintenance_fee_details TEXT,
    power_supply TEXT,
    hoist TEXT,
    ceiling_height REAL,
    permitted_business_types TEXT,
    access_road_condition TEXT,
    move_in_date TEXT,
    description TEXT,
    image_path TEXT,
    youtube_url TEXT,
    status TEXT DEFAULT '게시중',
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.boards (
    id BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    description TEXT,
    board_type TEXT DEFAULT 'general',
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.posts (
    id BIGSERIAL PRIMARY KEY,
    board_id BIGINT NOT NULL REFERENCES public.boards(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    content TEXT,
    author TEXT,
    attachment_path TEXT,
    youtube_url TEXT,
    thumbnail_url TEXT,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.pages (
    id BIGSERIAL PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    content TEXT,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS site_settings (
    key TEXT PRIMARY KEY,
    value TEXT
);

CREATE TABLE IF NOT EXISTS public.consultation_requests (
    id BIGSERIAL PRIMARY KEY,
    consultation_type TEXT,
    customer_name TEXT,
    contact_method TEXT,
    contact_info TEXT,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.consultation_details (
    id BIGSERIAL PRIMARY KEY,
    request_id BIGINT NOT NULL REFERENCES public.consultation_requests(id) ON DELETE CASCADE,
    property_type TEXT,
    desired_area TEXT,
    budget TEXT,
    rooms TEXT,
    business_type TEXT,
    required_area TEXT,
    other_requests TEXT,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.users (
    id BIGSERIAL PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "session" (
  "sid" varchar NOT NULL COLLATE "default",
  "sess" json NOT NULL,
  "expire" timestamp(6) NOT NULL
)
WITH (OIDS=FALSE);
ALTER TABLE "session" ADD CONSTRAINT "session_pkey" PRIMARY KEY ("sid") NOT DEFERRABLE INITIALLY IMMEDIATE;

-- Enable Row Level Security for all tables
ALTER TABLE public.properties ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.boards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.consultation_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.consultation_details ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.session ENABLE ROW LEVEL SECURITY;

-- Secure RLS Policies (v6 - Final & Verified)

-- Drop all conceivable old policies
DROP POLICY IF EXISTS "properties_select_public" ON public.properties;
DROP POLICY IF EXISTS "properties_insert_admin" ON public.properties;
DROP POLICY IF EXISTS "properties_update_admin" ON public.properties;
DROP POLICY IF EXISTS "properties_delete_admin" ON public.properties;
DROP POLICY IF EXISTS "boards_select_public" ON public.boards;
DROP POLICY IF EXISTS "boards_insert_admin" ON public.boards;
DROP POLICY IF EXISTS "boards_update_admin" ON public.boards;
DROP POLICY IF EXISTS "boards_delete_admin" ON public.boards;
DROP POLICY IF EXISTS "posts_select_public" ON public.posts;
DROP POLICY IF EXISTS "posts_insert_admin" ON public.posts;
DROP POLICY IF EXISTS "posts_update_admin" ON public.posts;
DROP POLICY IF EXISTS "posts_delete_admin" ON public.posts;
DROP POLICY IF EXISTS "pages_select_public" ON public.pages;
DROP POLICY IF EXISTS "pages_insert_admin" ON public.pages;
DROP POLICY IF EXISTS "pages_update_admin" ON public.pages;
DROP POLICY IF EXISTS "pages_delete_admin" ON public.pages;
DROP POLICY IF EXISTS "inquiries_insert_public" ON public.inquiries;
DROP POLICY IF EXISTS "inquiries_select_admin" ON public.inquiries;
DROP POLICY IF EXISTS "inquiries_update_admin" ON public.inquiries;
DROP POLICY IF EXISTS "inquiries_delete_admin" ON public.inquiries;
DROP POLICY IF EXISTS "users_all_admin" ON public.users;
DROP POLICY IF EXISTS "site_settings_all_admin" ON public.site_settings;
DROP POLICY IF EXISTS "consultation_requests_all_admin" ON public.consultation_requests;
DROP POLICY IF EXISTS "consultation_details_all_admin" ON public.consultation_details;
DROP POLICY IF EXISTS "session_block_all" ON public.session;
-- Drop old, conflicting policies for site_settings identified by verification script
DROP POLICY IF EXISTS "Allow all access for site_settings" ON public.site_settings;
DROP POLICY IF EXISTS "Allow public read access for site_settings" ON public.site_settings;


-- Create New, Separated Policies

-- properties
CREATE POLICY "properties_select_public" ON public.properties FOR SELECT USING (true);
CREATE POLICY "properties_insert_admin" ON public.properties FOR INSERT WITH CHECK ((select auth.role()) = $authenticated$);
CREATE POLICY "properties_update_admin" ON public.properties FOR UPDATE USING ((select auth.role()) = $authenticated$);
CREATE POLICY "properties_delete_admin" ON public.properties FOR DELETE USING ((select auth.role()) = $authenticated$);

-- boards
CREATE POLICY "boards_select_public" ON public.boards FOR SELECT USING (true);
CREATE POLICY "boards_insert_admin" ON public.boards FOR INSERT WITH CHECK ((select auth.role()) = $authenticated$);
CREATE POLICY "boards_update_admin" ON public.boards FOR UPDATE USING ((select auth.role()) = $authenticated$);
CREATE POLICY "boards_delete_admin" ON public.boards FOR DELETE USING ((select auth.role()) = $authenticated$);

-- posts
CREATE POLICY "posts_select_public" ON public.posts FOR SELECT USING (true);
CREATE POLICY "posts_insert_admin" ON public.posts FOR INSERT WITH CHECK ((select auth.role()) = $authenticated$);
CREATE POLICY "posts_update_admin" ON public.posts FOR UPDATE USING ((select auth.role()) = $authenticated$);
CREATE POLICY "posts_delete_admin" ON public.posts FOR DELETE USING ((select auth.role()) = $authenticated$);

-- pages
CREATE POLICY "pages_select_public" ON public.pages FOR SELECT USING (true);
CREATE POLICY "pages_insert_admin" ON public.pages FOR INSERT WITH CHECK ((select auth.role()) = $authenticated$);
CREATE POLICY "pages_update_admin" ON public.pages FOR UPDATE USING ((select auth.role()) = $authenticated$);
CREATE POLICY "pages_delete_admin" ON public.pages FOR DELETE USING ((select auth.role()) = $authenticated$);

-- inquiries
CREATE POLICY "inquiries_insert_public" ON public.inquiries FOR INSERT WITH CHECK (true);
CREATE POLICY "inquiries_select_admin" ON public.inquiries FOR SELECT USING ((select auth.role()) = $authenticated$);
CREATE POLICY "inquiries_update_admin" ON public.inquiries FOR UPDATE USING ((select auth.role()) = $authenticated$);
CREATE POLICY "inquiries_delete_admin" ON public.inquiries FOR DELETE USING ((select auth.role()) = $authenticated$);

-- users, site_settings, etc (FOR ALL is ok for these)
CREATE POLICY "users_all_admin" ON public.users FOR ALL USING ((select auth.role()) = $authenticated$);
CREATE POLICY "site_settings_all_admin" ON public.site_settings FOR ALL USING ((select auth.role()) = $authenticated$);
CREATE POLICY "consultation_requests_all_admin" ON public.consultation_requests FOR ALL USING ((select auth.role()) = $authenticated$);
CREATE POLICY "consultation_details_all_admin" ON public.consultation_details FOR ALL USING ((select auth.role()) = $authenticated$);
CREATE POLICY "session_block_all" ON public.session FOR ALL USING (false) WITH CHECK (false);


-- Insert initial data
INSERT INTO pages (slug, title, content) VALUES
('privacy-policy', '개인정보처리방침', '개인정보처리방침 내용을 여기에 입력하세요.'),
('reject-email-collection', '이메일무단수집거부', '이메일무단수집거부 내용을 여기에 입력하세요.'),
('terms-of-service', '이용약관', '이용약관 내용을 여기에 입력하세요.'),
('lifestyle-1', '라이프스타일 제안 1', '첫 번째 라이프스타일 제안에 대한 내용을 이곳에 입력해주세요.'),
('lifestyle-2', '라이프스타일 제안 2', '두 번째 라이프스타일 제안에 대한 내용을 이곳에 입력해주세요.'),
('lifestyle-3', '라이프스타일 제안 3', '세 번째 라이프스타일 제안에 대한 내용을 이곳에 입력해주세요.')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO boards (name, slug, description, board_type) VALUES
('공지사항', 'notice', '중요한 공지사항을 올리는 곳입니다.', 'general'),
('부동산 뉴스', 'news', '부동산 관련 최신 뉴스를 공유합니다.', 'general'),
('자유 게시판', 'freeboard', '자유롭게 이야기를 나누는 공간입니다.', 'general'),
('매물 사진', 'gallery', '매물 사진을 올리는 갤러리입니다.', 'gallery'),
('동영상 갤러리', 'utube', '관련 동영상을 공유하는 곳입니다.', 'youtube'),
('부동산 정보', 'rearinfo', '부동산 관련 전문 정보를 제공합니다.', 'general')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO users (username, password_hash) VALUES
('as123', '$2b$10$b3oaK7S1LOb94MvJeI6M7.fo6X.WeOcm6S9GjySWmckEFEO0.TqFa')
ON CONFLICT (username) DO NOTHING;
CREATE TABLE IF NOT EXISTS public.properties (
    id BIGSERIAL PRIMARY KEY,
    category TEXT NOT NULL,
    title TEXT NOT NULL,
    price TEXT,
    address TEXT,
    area REAL,
    exclusive_area REAL,
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

-- Enable Row Level Security for all tables
ALTER TABLE public.properties ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.boards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.consultation_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.consultation_details ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

-- Secure RLS Policies

-- Drop all existing policies to ensure a clean slate
DROP POLICY IF EXISTS "Allow public read access" ON public.properties;
DROP POLICY IF EXISTS "Allow all access for now" ON public.properties;
DROP POLICY IF EXISTS "Allow public read access for boards" ON public.boards;
DROP POLICY IF EXISTS "Allow all access for boards" ON public.boards;
DROP POLICY IF EXISTS "Allow public read access for posts" ON public.posts;
DROP POLICY IF EXISTS "Allow all access for posts" ON public.posts;
DROP POLICY IF EXISTS "Allow public read access for pages" ON public.pages;
DROP POLICY IF EXISTS "Allow all access for pages" ON public.pages;
DROP POLICY IF EXISTS "Allow all access for consultation_requests" ON public.consultation_requests;
DROP POLICY IF EXISTS "Allow all access for consultation_details" ON public.consultation_details;
DROP POLICY IF EXISTS "Allow all access for users" ON public.users;
DROP POLICY IF EXISTS "Allow all access for inquiries" ON public.inquiries;


-- Policies for properties, boards, posts, pages (Public Read, Admin All)
CREATE POLICY "Allow public read access" ON public.properties FOR SELECT USING (true);
CREATE POLICY "Allow admin full access" ON public.properties FOR ALL USING (auth.role() = 'authenticated');

CREATE POLICY "Allow public read access" ON public.boards FOR SELECT USING (true);
CREATE POLICY "Allow admin full access" ON public.boards FOR ALL USING (auth.role() = 'authenticated');

CREATE POLICY "Allow public read access" ON public.posts FOR SELECT USING (true);
CREATE POLICY "Allow admin full access" ON public.posts FOR ALL USING (auth.role() = 'authenticated');

CREATE POLICY "Allow public read access" ON public.pages FOR SELECT USING (true);
CREATE POLICY "Allow admin full access" ON public.pages FOR ALL USING (auth.role() = 'authenticated');

-- Policies for inquiries (Public Insert, Admin All)
CREATE POLICY "Allow public insert access" ON public.inquiries FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow admin full access" ON public.inquiries FOR ALL USING (auth.role() = 'authenticated');

-- Policies for users, settings, and consultation tables (Admin Only)
CREATE POLICY "Allow admin full access" ON public.users FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Allow admin full access" ON public.site_settings FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Allow admin full access" ON public.consultation_requests FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Allow admin full access" ON public.consultation_details FOR ALL USING (auth.role() = 'authenticated');


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

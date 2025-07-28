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
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.posts (
    id BIGSERIAL PRIMARY KEY,
    board_id BIGINT NOT NULL REFERENCES public.boards(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    content TEXT,
    author TEXT,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE public.properties ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow public read access" ON public.properties;
CREATE POLICY "Allow public read access" ON public.properties
    FOR SELECT
    USING (true);

DROP POLICY IF EXISTS "Allow all access for now" ON public.properties;
CREATE POLICY "Allow all access for now" ON public.properties
    FOR ALL
    USING (true)
    WITH CHECK (true);

ALTER TABLE public.boards ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow public read access for boards" ON public.boards;
CREATE POLICY "Allow public read access for boards" ON public.boards
    FOR SELECT
    USING (true);
    
DROP POLICY IF EXISTS "Allow all access for boards" ON public.boards;
CREATE POLICY "Allow all access for boards" ON public.boards
    FOR ALL
    USING (true)
    WITH CHECK (true);

ALTER TABLE public.posts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow public read access for posts" ON public.posts;
CREATE POLICY "Allow public read access for posts" ON public.posts
    FOR SELECT
    USING (true);

DROP POLICY IF EXISTS "Allow all access for posts" ON public.posts;
CREATE POLICY "Allow all access for posts" ON public.posts
    FOR ALL
    USING (true)
    WITH CHECK (true);
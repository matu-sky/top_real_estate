-- inquiries 테이블 생성
CREATE TABLE IF NOT EXISTS inquiries (
    id SERIAL PRIMARY KEY,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    name VARCHAR(255) NOT NULL,
    phone VARCHAR(255) NOT NULL,
    email VARCHAR(255),
    property_types VARCHAR(255),
    inquiry_type VARCHAR(255) NOT NULL,
    title VARCHAR(255) NOT NULL,
    message TEXT
);

-- RLS 활성화
ALTER TABLE public.inquiries ENABLE ROW LEVEL SECURITY;

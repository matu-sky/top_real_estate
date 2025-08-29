ALTER TABLE public.boards
DROP CONSTRAINT IF EXISTS board_type_check;

ALTER TABLE public.boards
ADD CONSTRAINT board_type_check 
CHECK (board_type = ANY (ARRAY['general'::text, 'gallery'::text, 'news'::text, 'youtube'::text, 'archive'::text]));

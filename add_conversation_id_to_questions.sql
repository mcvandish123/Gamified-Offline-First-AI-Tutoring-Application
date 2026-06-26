-- Add conversation_id column to questions table in Supabase
ALTER TABLE questions 
  ADD COLUMN IF NOT EXISTS conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE;

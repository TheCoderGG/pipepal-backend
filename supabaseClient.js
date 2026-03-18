const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

module.exports = supabase;

if (!process.env.SUPABASE_URL) {
  throw new Error("Missing SUPABASE_URL in environment variables");
}
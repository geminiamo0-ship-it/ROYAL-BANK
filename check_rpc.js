const { createClient } = require('@supabase/supabase-js');
const supabase = createClient('https://trnvsgenmzhyuayxxdoq.supabase.co', 'sb_secret_LfKxUzMNK1tuajaRE0KW3g_hXKjuQdF');
supabase.rpc('query', { query_text: "SELECT prosrc FROM pg_proc WHERE proname = 'get_category_topic_counts_json'" }).then(r => console.log(r));

async function test() {
  const { createClient } = await import('@supabase/supabase-js');
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error('Missing Supabase environment variables.');
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  const { data } = await supabase
    .from('questions')
    .select('explanation_html')
    .like('explanation_html', '%nephrology_add1558b.jpg%');

  if (data && data[0]) {
    const match = data[0].explanation_html.match(/<img[^>]+src=["'](.*?)["']/);
    console.log(match ? match[1] : 'No match');
  }
}

test();

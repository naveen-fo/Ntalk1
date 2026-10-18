# NTalk (Ntalk5 fixed)

## Supabase setup (okkasari)
1. SQL Editor -> `supabase_ntalk_final.sql` motham paste -> Run. Last lo anni `ok` undali.
   (`supabase_patch.sql` / `supabase_groups_extra.sql` ippudu avasaram ledu, avi run cheyakandi.)
2. Authentication -> URL Configuration: Site URL = mee deployed https URL, Redirect URLs lo `https://your-site/**`.
3. Google login kavalante: Authentication -> Providers -> Google enable (Client ID/Secret).
4. Background push kavalante: Edge Functions -> `send-push` deploy (`supabase/functions/send-push/index.ts`)
   + secrets VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT.
5. Files ni HTTPS hosting lo deploy cheyandi (calls ki HTTPS must).

`config.js` lo SUPABASE_URL (no /rest/v1) + publishable/anon key matrame. service_role key frontend lo pettakandi.

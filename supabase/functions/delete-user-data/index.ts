/**
 * Delete an account: every stored file, then projects and profile, then the login.
 * The order and the checks live in core.ts (tested from vitest). This file is the HTTP shell.
 *
 * Body: { confirmPhrase: "DELETE <email name>" } — the phrase the Settings dialog asks for.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'
import { deleteAccount, phraseMatches, type AdminLike } from './core.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json({ error: 'Missing authorization' }, 401)

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const userClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: { user }, error: userError } = await userClient.auth.getUser()
    if (userError || !user) return json({ error: 'Unauthorized' }, 401)

    const body = await req.json().catch(() => ({}))
    if (!phraseMatches(body.confirmPhrase, user.email)) {
      return json({ error: 'Confirmation phrase does not match' }, 400)
    }

    const admin = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const port: AdminLike = {
      async listFolder(bucket, path) {
        const { data, error } = await admin.storage.from(bucket).list(path, { limit: 1000 })
        if (error) throw error
        return data ?? []
      },
      async removeFiles(bucket, paths) {
        const { error } = await admin.storage.from(bucket).remove(paths)
        if (error) throw error
      },
      async projectIds(userId) {
        const { data, error } = await admin.from('projects').select('id').eq('user_id', userId)
        if (error) throw error
        return (data ?? []).map((p: { id: string }) => p.id)
      },
      async deleteRows(userId) {
        const p = await admin.from('projects').delete().eq('user_id', userId)
        if (p.error) throw p.error
        const pr = await admin.from('profiles').delete().eq('user_id', userId)
        if (pr.error) throw pr.error
      },
      async deleteAuthUser(userId) {
        const { error } = await admin.auth.admin.deleteUser(userId)
        if (error) throw error
      },
    }

    const result = await deleteAccount(port, user.id)
    if (result.ok) return json({ success: true, filesRemoved: result.filesRemoved })
    console.error('[delete-user-data]', user.id, result)
    return json({ error: result.message, stage: result.stage }, 500)
  } catch (err) {
    console.error('[delete-user-data] unexpected', err)
    return json({ error: 'Internal server error' }, 500)
  }
})

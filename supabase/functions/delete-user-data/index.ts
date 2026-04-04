import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Validate JWT from Authorization header
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing authorization' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

    // User client to get authenticated user
    const userClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } }
    })
    const { data: { user }, error: userError } = await userClient.auth.getUser()
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Validate confirmation email matches
    const body = await req.json().catch(() => ({}))
    if (body.confirmEmail?.toLowerCase() !== user.email?.toLowerCase()) {
      return new Response(JSON.stringify({ error: 'Email confirmation does not match' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Admin client for privileged operations
    const adminClient = createClient(supabaseUrl, serviceRoleKey)

    // 1. Get all user projects to find storage paths
    const { data: projects } = await adminClient
      .from('projects')
      .select('id')
      .eq('user_id', user.id)

    // 2. Delete storage files for each project
    if (projects && projects.length > 0) {
      for (const project of projects) {
        // Delete from project-assets
        const { data: assetFiles } = await adminClient.storage
          .from('project-assets')
          .list(project.id)
        if (assetFiles && assetFiles.length > 0) {
          await adminClient.storage
            .from('project-assets')
            .remove(assetFiles.map(f => `${project.id}/${f.name}`))
        }

        // Delete from project-models
        const { data: modelFiles } = await adminClient.storage
          .from('project-models')
          .list(project.id)
        if (modelFiles && modelFiles.length > 0) {
          await adminClient.storage
            .from('project-models')
            .remove(modelFiles.map(f => `${project.id}/${f.name}`))
        }
      }
    }

    // 3. Delete all projects (cascade handled by DB)
    await adminClient.from('projects').delete().eq('user_id', user.id)

    // 4. Delete profile
    await adminClient.from('profiles').delete().eq('user_id', user.id)

    // 5. Delete the auth user
    const { error: deleteError } = await adminClient.auth.admin.deleteUser(user.id)
    if (deleteError) {
      return new Response(JSON.stringify({ error: 'Failed to delete account' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})

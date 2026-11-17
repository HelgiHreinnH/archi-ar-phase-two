/**
 * Account deletion — the part that decides and deletes, free of Deno and HTTP so it can be
 * unit-tested from vitest (src/lib/deleteAccount.test.ts).
 *
 * Order matters (17 Nov 2026). Supabase refuses to delete an auth user who still owns storage
 * objects. The old function only cleared the top level of each project folder, so model files
 * (`<project>/<upload>/x.glb`) and marker images (`<project>/markers/`) survived, the final
 * auth delete failed, and the user was left with projects and profile gone but a live login.
 *
 * Now: every file first (all folder levels), then check that none are left, and only then the
 * rows and the login. If files remain, stop before touching anything else.
 */

/** "helgi.hreinn@x.dk" → "DELETE helgi.hreinn". Kept identical to src/lib/accountDeletion.ts. */
export function confirmPhrase(email: string | null | undefined): string {
  const local = (email ?? "").split("@")[0].trim().toLowerCase();
  return `DELETE ${local}`;
}

/** Spaces collapsed, "DELETE" in any case, the name lower-cased. */
export function phraseMatches(typed: unknown, email: string | null | undefined): boolean {
  if (typeof typed !== "string" || !email) return false;
  const norm = typed.trim().replace(/\s+/g, " ");
  const [word, ...rest] = norm.split(" ");
  return `${word.toUpperCase()} ${rest.join(" ").toLowerCase()}` === confirmPhrase(email);
}

export const PROJECT_BUCKETS = ["project-models", "project-assets"] as const;
/** Engine bake-off buckets: files sit under the user's own id (see storage policies). */
export const USER_BUCKETS = ["lab-8thwall", "lab-zappar", "lab-immersal"] as const;

type Entry = { name: string; id: string | null };

/** The slice of the Supabase admin client this needs; injectable for tests. */
export interface AdminLike {
  listFolder(bucket: string, path: string): Promise<Entry[]>;
  removeFiles(bucket: string, paths: string[]): Promise<void>;
  projectIds(userId: string): Promise<string[]>;
  deleteRows(userId: string): Promise<void>;
  deleteAuthUser(userId: string): Promise<void>;
}

async function walk(admin: AdminLike, bucket: string, prefix: string, depth = 4): Promise<string[]> {
  const out: string[] = [];
  for (const e of await admin.listFolder(bucket, prefix)) {
    const p = `${prefix}/${e.name}`;
    if (e.id) out.push(p);
    else if (depth > 0) out.push(...(await walk(admin, bucket, p, depth - 1)));
  }
  return out;
}

/** Every file the user owns, as [bucket, path] pairs. */
export async function userFiles(admin: AdminLike, userId: string): Promise<Array<[string, string]>> {
  const files: Array<[string, string]> = [];
  for (const pid of await admin.projectIds(userId)) {
    for (const b of PROJECT_BUCKETS) {
      for (const f of await walk(admin, b, pid)) if (f.startsWith(`${pid}/`)) files.push([b, f]);
    }
  }
  for (const b of USER_BUCKETS) {
    try {
      for (const f of await walk(admin, b, userId)) if (f.startsWith(`${userId}/`)) files.push([b, f]);
    } catch {
      /* a lab bucket that no longer exists is not this user's problem */
    }
  }
  return files;
}

export type DeleteResult =
  | { ok: true; filesRemoved: number }
  | { ok: false; stage: "files"; filesLeft: number; message: string }
  | { ok: false; stage: "auth"; message: string };

export async function deleteAccount(admin: AdminLike, userId: string): Promise<DeleteResult> {
  // 1. Files, all levels, in batches (Storage removes at most 1000 per call).
  const files = await userFiles(admin, userId);
  const byBucket = new Map<string, string[]>();
  for (const [b, p] of files) byBucket.set(b, [...(byBucket.get(b) ?? []), p]);
  for (const [b, paths] of byBucket) {
    for (let i = 0; i < paths.length; i += 900) await admin.removeFiles(b, paths.slice(i, i + 900));
  }

  // 2. Nothing may be left, or the login can't be deleted — stop while the account is intact.
  const left = await userFiles(admin, userId);
  if (left.length) {
    return { ok: false, stage: "files", filesLeft: left.length, message: "Some files could not be removed. Nothing else was deleted." };
  }

  // 3. Projects and profile, 4. the login.
  await admin.deleteRows(userId);
  try {
    await admin.deleteAuthUser(userId);
  } catch (e) {
    return { ok: false, stage: "auth", message: (e as Error).message };
  }
  return { ok: true, filesRemoved: files.length };
}

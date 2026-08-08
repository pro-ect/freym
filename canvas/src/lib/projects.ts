import { supabase } from "./supabase";
import type { ProjectRow } from "../types";

export async function listProjects(): Promise<ProjectRow[]> {
  const { data, error } = await supabase
    .from("canvas_projects")
    .select("id, name, nodes, edges, updated_at")
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as ProjectRow[];
}

export async function createProject(name: string): Promise<ProjectRow> {
  const { data: sess } = await supabase.auth.getSession();
  const userId = sess.session?.user.id;
  const { data, error } = await supabase
    .from("canvas_projects")
    .insert({ user_id: userId, name, nodes: [], edges: [] })
    .select()
    .single();
  if (error) throw error;
  return data as ProjectRow;
}

export async function loadProject(id: string): Promise<ProjectRow | null> {
  const { data } = await supabase
    .from("canvas_projects")
    .select("id, name, nodes, edges, updated_at")
    .eq("id", id)
    .maybeSingle();
  return (data as ProjectRow) ?? null;
}

export async function saveProject(id: string, nodes: unknown[], edges: unknown[]) {
  await supabase
    .from("canvas_projects")
    .update({ nodes, edges, updated_at: new Date().toISOString() })
    .eq("id", id);
}

export async function renameProject(id: string, name: string) {
  await supabase.from("canvas_projects").update({ name }).eq("id", id);
}

export async function deleteProject(id: string) {
  await supabase.from("canvas_projects").delete().eq("id", id);
}

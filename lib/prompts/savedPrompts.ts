/**
 * Saved Prompts - Cloud Synced Prompt Catalog
 *
 * CRUD operations for user's saved prompts synced with Supabase
 */

import { supabase } from '../supabase';

export interface SavedPrompt {
  id: string;
  user_id: string;
  name: string;
  prompt: string;
  created_at: string;
  updated_at: string;
}

export interface CreatePromptInput {
  name: string;
  prompt: string;
}

export interface UpdatePromptInput {
  name?: string;
  prompt?: string;
}

/**
 * Fetch all saved prompts for current user
 */
export async function getSavedPrompts(): Promise<SavedPrompt[]> {
  try {
    console.log('[SavedPrompts] Fetching saved prompts...');
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError) {
      console.error('[SavedPrompts] Auth error:', authError);
      return [];
    }

    if (!user) {
      console.log('[SavedPrompts] No user logged in');
      return [];
    }

    console.log('[SavedPrompts] User authenticated:', user.id);

    const { data, error } = await supabase
      .from('saved_prompts')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[SavedPrompts] Error fetching prompts:', error);
      throw error;
    }

    console.log('[SavedPrompts] Fetched', data?.length || 0, 'prompts');
    return data || [];
  } catch (error) {
    console.error('[SavedPrompts] Error in getSavedPrompts:', error);
    return [];
  }
}

/**
 * Create a new saved prompt
 */
export async function createSavedPrompt(input: CreatePromptInput): Promise<SavedPrompt> {
  console.log('[SavedPrompts] createSavedPrompt called with:', input.name);

  console.log('[SavedPrompts] Getting user...');
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError) {
    console.error('[SavedPrompts] Auth error:', authError);
    throw authError;
  }

  if (!user) {
    console.error('[SavedPrompts] No user found');
    throw new Error('Not authenticated');
  }

  console.log('[SavedPrompts] User found:', user.id);
  console.log('[SavedPrompts] Inserting prompt...');

  const { data, error } = await supabase
    .from('saved_prompts')
    .insert({
      user_id: user.id,
      name: input.name.trim(),
      prompt: input.prompt.trim(),
    })
    .select()
    .single();

  console.log('[SavedPrompts] Insert completed, data:', !!data, 'error:', !!error);

  if (error) {
    console.error('[SavedPrompts] Error creating prompt:', error);
    throw error;
  }

  console.log('[SavedPrompts] Prompt saved successfully:', data.id);
  return data;
}

/**
 * Update an existing saved prompt
 */
export async function updateSavedPrompt(
  promptId: string,
  input: UpdatePromptInput
): Promise<SavedPrompt> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    throw new Error('Not authenticated');
  }

  const updates: Partial<SavedPrompt> = {};
  if (input.name !== undefined) updates.name = input.name.trim();
  if (input.prompt !== undefined) updates.prompt = input.prompt.trim();

  const { data, error } = await supabase
    .from('saved_prompts')
    .update(updates)
    .eq('id', promptId)
    .eq('user_id', user.id)
    .select()
    .single();

  if (error) {
    console.error('[SavedPrompts] Error updating prompt:', error);
    throw error;
  }

  return data;
}

/**
 * Delete a saved prompt
 */
export async function deleteSavedPrompt(promptId: string): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    throw new Error('Not authenticated');
  }

  const { error } = await supabase
    .from('saved_prompts')
    .delete()
    .eq('id', promptId)
    .eq('user_id', user.id);

  if (error) {
    console.error('[SavedPrompts] Error deleting prompt:', error);
    throw error;
  }
}

/**
 * Get a single saved prompt by ID
 */
export async function getSavedPromptById(promptId: string): Promise<SavedPrompt | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return null;
  }

  const { data, error } = await supabase
    .from('saved_prompts')
    .select('*')
    .eq('id', promptId)
    .eq('user_id', user.id)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      return null; // Not found
    }
    console.error('[SavedPrompts] Error fetching prompt:', error);
    throw error;
  }

  return data;
}

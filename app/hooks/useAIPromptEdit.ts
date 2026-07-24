/**
 * Hook for AI-powered prompt editing using Replicate's Gemini 2.5 Flash
 *
 * Calls the ai-prompt-edit Supabase edge function to enhance or create prompts
 * based on user instructions.
 */

import { useState, useCallback } from 'react';
import { supabase } from '../../lib/supabase';

interface AIPromptEditState {
  isLoading: boolean;
  error: string | null;
  streamingText: string;
}

interface AIPromptEditResult {
  editPrompt: (currentPrompt: string, instruction: string) => Promise<string>;
  isLoading: boolean;
  error: string | null;
  streamingText: string;
  reset: () => void;
}

export function useAIPromptEdit(): AIPromptEditResult {
  const [state, setState] = useState<AIPromptEditState>({
    isLoading: false,
    error: null,
    streamingText: '',
  });

  const reset = useCallback(() => {
    setState({
      isLoading: false,
      error: null,
      streamingText: '',
    });
  }, []);

  const editPrompt = useCallback(async (currentPrompt: string, instruction: string): Promise<string> => {
    console.log('🤖 [AI Edit] Starting edit:', { currentPrompt: currentPrompt.substring(0, 50), instruction });

    setState({
      isLoading: true,
      error: null,
      streamingText: '',
    });

    try {
      // Get current session for auth
      const { data: { session } } = await supabase.auth.getSession();
      console.log('🤖 [AI Edit] Session:', session ? 'present' : 'missing');

      if (!session) {
        throw new Error('Please sign in to use AI Edit');
      }

      // Call the edge function
      console.log('🤖 [AI Edit] Calling edge function...');
      const { data, error } = await supabase.functions.invoke('ai-prompt-edit', {
        body: {
          currentPrompt,
          instruction,
        },
      });

      console.log('🤖 [AI Edit] Response:', { data, error });

      if (error) {
        console.error('🤖 [AI Edit] Edge function error:', error);
        // Try to get more details from the error
        let errorMessage = 'Failed to edit prompt';
        try {
          if (error.context && typeof error.context.json === 'function') {
            const errorData = await error.context.json();
            console.error('🤖 [AI Edit] Error data:', errorData);
            errorMessage = errorData?.error || error.message || errorMessage;
          } else {
            errorMessage = error.message || errorMessage;
          }
        } catch (e) {
          console.error('🤖 [AI Edit] Could not parse error:', e);
          errorMessage = error.message || errorMessage;
        }
        throw new Error(errorMessage);
      }

      if (!data?.result) {
        console.error('🤖 [AI Edit] No result in data:', data);
        throw new Error('No result from AI');
      }

      const result = data.result;
      console.log('🤖 [AI Edit] Success:', result.substring(0, 100));

      setState({
        isLoading: false,
        error: null,
        streamingText: result,
      });

      return result;
    } catch (error: any) {
      console.error('🤖 [AI Edit] Error:', error);
      const errorMessage = error.message || 'Failed to edit prompt';
      setState({
        isLoading: false,
        error: errorMessage,
        streamingText: '',
      });
      throw new Error(errorMessage);
    }
  }, []);

  return {
    editPrompt,
    isLoading: state.isLoading,
    error: state.error,
    streamingText: state.streamingText,
    reset,
  };
}

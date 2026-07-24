/**
 * Background Task Manager Hook
 *
 * Manages image generation tasks that can be paused when app goes to background
 * and resumed when app returns to foreground.
 *
 * Features:
 * - Saves task state to AsyncStorage for persistence
 * - Detects app state changes (foreground/background)
 * - Auto-resumes pending tasks when app comes to foreground
 * - Provides callbacks for task lifecycle events
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = '@background_tasks';

export interface BackgroundTask {
  id: string;
  libraryId: string;
  predictionId?: string; // Replicate prediction ID
  api: 'replicate' | 'seedream';
  modelId: string;
  prompt: string;
  imageUri: string;
  status: 'active' | 'paused' | 'completed' | 'failed';
  createdAt: number;
  pausedAt?: number;
  resumedAt?: number;
  options?: Record<string, any>;
}

interface BackgroundTaskCallbacks {
  onResume?: (task: BackgroundTask) => Promise<void>;
  onPause?: (task: BackgroundTask) => void;
  onComplete?: (taskId: string, result: string) => void;
  onError?: (taskId: string, error: Error) => void;
}

export function useBackgroundTaskManager(callbacks?: BackgroundTaskCallbacks) {
  const [tasks, setTasks] = useState<Map<string, BackgroundTask>>(new Map());
  const [appState, setAppState] = useState<AppStateStatus>(AppState.currentState);
  const appStateRef = useRef(AppState.currentState);
  const tasksRef = useRef<Map<string, BackgroundTask>>(new Map());

  // Keep tasksRef in sync with tasks state
  useEffect(() => {
    tasksRef.current = tasks;
  }, [tasks]);

  // Load persisted tasks from AsyncStorage
  const loadTasks = useCallback(async () => {
    try {
      const stored = await AsyncStorage.getItem(STORAGE_KEY);
      if (stored) {
        const tasksArray: BackgroundTask[] = JSON.parse(stored);
        const tasksMap = new Map<string, BackgroundTask>();
        tasksArray.forEach(task => {
          // Only load tasks that are not completed or failed
          if (task.status === 'active' || task.status === 'paused') {
            tasksMap.set(task.id, task);
          }
        });
        setTasks(tasksMap);
        console.log(`📦 Loaded ${tasksMap.size} background task(s) from storage`);
      }
    } catch (error) {
      console.error('❌ Failed to load background tasks:', error);
    }
  }, []);

  // Save tasks to AsyncStorage
  const saveTasks = useCallback(async (tasksToSave: Map<string, BackgroundTask>) => {
    try {
      const tasksArray = Array.from(tasksToSave.values());
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(tasksArray));
      console.log(`💾 Saved ${tasksArray.length} background task(s) to storage`);
    } catch (error) {
      console.error('❌ Failed to save background tasks:', error);
    }
  }, []);

  // Register a new background task
  const registerTask = useCallback((task: Omit<BackgroundTask, 'id' | 'status' | 'createdAt'>) => {
    const newTask: BackgroundTask = {
      ...task,
      id: `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      status: 'active',
      createdAt: Date.now(),
    };

    setTasks(prev => {
      const updated = new Map(prev);
      updated.set(newTask.id, newTask);
      saveTasks(updated);
      return updated;
    });

    console.log(`✅ Registered background task: ${newTask.id}`);
    return newTask.id;
  }, [saveTasks]);

  // Update a task
  const updateTask = useCallback((taskId: string, updates: Partial<BackgroundTask>) => {
    setTasks(prev => {
      const task = prev.get(taskId);
      if (!task) {
        console.warn(`⚠️ Task ${taskId} not found`);
        return prev;
      }

      const updated = new Map(prev);
      updated.set(taskId, { ...task, ...updates });
      saveTasks(updated);
      return updated;
    });
  }, [saveTasks]);

  // Mark task as paused
  const pauseTask = useCallback((taskId: string) => {
    const task = tasksRef.current.get(taskId);
    if (task && task.status === 'active') {
      updateTask(taskId, {
        status: 'paused',
        pausedAt: Date.now()
      });
      console.log(`⏸️ Paused task: ${taskId}`);

      if (callbacks?.onPause) {
        callbacks.onPause(task);
      }
    }
  }, [updateTask, callbacks]);

  // Mark task as active (resumed)
  const resumeTask = useCallback(async (taskId: string) => {
    const task = tasksRef.current.get(taskId);
    if (task && task.status === 'paused') {
      updateTask(taskId, {
        status: 'active',
        resumedAt: Date.now()
      });
      console.log(`▶️ Resuming task: ${taskId}`);

      if (callbacks?.onResume) {
        try {
          await callbacks.onResume(task);
        } catch (error: any) {
          console.error(`❌ Failed to resume task ${taskId}:`, error);
          completeTask(taskId, 'failed', error);
        }
      }
    }
  }, [updateTask, callbacks]);

  // Mark task as completed or failed
  const completeTask = useCallback((taskId: string, status: 'completed' | 'failed', resultOrError?: string | Error) => {
    const task = tasksRef.current.get(taskId);
    if (!task) return;

    // Update task status
    updateTask(taskId, { status });

    // Remove from active tasks after a delay (keep for 1 minute for history)
    setTimeout(() => {
      setTasks(prev => {
        const updated = new Map(prev);
        updated.delete(taskId);
        saveTasks(updated);
        return updated;
      });
    }, 60000); // 1 minute

    console.log(`${status === 'completed' ? '✅' : '❌'} Task ${status}: ${taskId}`);

    // Trigger callbacks
    if (status === 'completed' && typeof resultOrError === 'string' && callbacks?.onComplete) {
      callbacks.onComplete(taskId, resultOrError);
    } else if (status === 'failed' && resultOrError instanceof Error && callbacks?.onError) {
      callbacks.onError(taskId, resultOrError);
    }
  }, [updateTask, saveTasks, callbacks]);

  // Get active tasks
  const getActiveTasks = useCallback(() => {
    return Array.from(tasksRef.current.values()).filter(task => task.status === 'active');
  }, []);

  // Get paused tasks
  const getPausedTasks = useCallback(() => {
    return Array.from(tasksRef.current.values()).filter(task => task.status === 'paused');
  }, []);

  // Handle app state changes
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextAppState: AppStateStatus) => {
      const previousState = appStateRef.current;
      appStateRef.current = nextAppState;
      setAppState(nextAppState);

      console.log(`📱 App state changed: ${previousState} → ${nextAppState}`);

      // App went to background
      if (previousState === 'active' && nextAppState.match(/inactive|background/)) {
        console.log('📱 App going to background, pausing active tasks...');
        const activeTasks = Array.from(tasksRef.current.values()).filter(task => task.status === 'active');
        activeTasks.forEach(task => {
          pauseTask(task.id);
        });
      }

      // App came back to foreground
      if (previousState.match(/inactive|background/) && nextAppState === 'active') {
        console.log('📱 App came to foreground, checking for paused tasks...');
        const pausedTasks = Array.from(tasksRef.current.values()).filter(task => task.status === 'paused');

        if (pausedTasks.length > 0) {
          console.log(`🔄 Found ${pausedTasks.length} paused task(s), resuming...`);
          pausedTasks.forEach(task => {
            resumeTask(task.id);
          });
        }
      }
    });

    return () => {
      subscription.remove();
    };
  }, [pauseTask, resumeTask]);

  // Load tasks on mount
  useEffect(() => {
    loadTasks();
  }, [loadTasks]);

  return {
    tasks: Array.from(tasks.values()),
    appState,
    registerTask,
    updateTask,
    pauseTask,
    resumeTask,
    completeTask,
    getActiveTasks,
    getPausedTasks,
  };
}

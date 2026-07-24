/**
 * Global Design System Constants
 * Use these values for consistent styling across the app
 */

export const BorderRadius = {
  // Small elements (chips, tags, small buttons)
  xs: 8,
  sm: 12,

  // Medium elements (buttons, cards)
  md: 16,
  lg: 20,

  // Large elements (modals, bottom sheets)
  xl: 24,
  xxl: 28,

  // Circular (profile pics, icon buttons)
  full: 9999,
} as const;

export const Spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
} as const;

export const Colors = {
  primary: '#007AFF',
  background: '#000',
  surface: '#1C1C1E',
  text: '#FFFFFF',
  textSecondary: '#999',
  border: '#333',
  success: '#34C759',
  warning: '#FF9500',
  error: '#FF3B30',
} as const;

/**
 * Manrope Font Design System
 *
 * Use these font family constants instead of fontWeight.
 * This ensures proper font rendering across iOS and Android.
 */

export const Fonts = {
  // Regular weight (400)
  regular: 'Manrope-Regular',

  // Medium weight (500)
  medium: 'Manrope-Medium',

  // SemiBold weight (600)
  semibold: 'Manrope-SemiBold',

  // Bold weight (700)
  bold: 'Manrope-Bold',
} as const;

/**
 * Helper function to get font family by weight
 *
 * @example
 * style={{ fontFamily: getFontFamily(600) }} // Returns 'Manrope-SemiBold'
 */
export const getFontFamily = (weight: 400 | 500 | 600 | 700): string => {
  const fontMap = {
    400: Fonts.regular,
    500: Fonts.medium,
    600: Fonts.semibold,
    700: Fonts.bold,
  };
  return fontMap[weight];
};

/**
 * Text style presets
 * Use these in your StyleSheet for consistent typography
 */
export const TextStyles = {
  // Headers
  h1: {
    fontFamily: Fonts.bold,
    fontSize: 32,
  },
  h2: {
    fontFamily: Fonts.bold,
    fontSize: 24,
  },
  h3: {
    fontFamily: Fonts.semibold,
    fontSize: 20,
  },
  h4: {
    fontFamily: Fonts.semibold,
    fontSize: 18,
  },

  // Body text
  body: {
    fontFamily: Fonts.regular,
    fontSize: 16,
  },
  bodyMedium: {
    fontFamily: Fonts.medium,
    fontSize: 16,
  },
  bodySemiBold: {
    fontFamily: Fonts.semibold,
    fontSize: 16,
  },

  // Small text
  caption: {
    fontFamily: Fonts.regular,
    fontSize: 12,
  },
  captionMedium: {
    fontFamily: Fonts.medium,
    fontSize: 12,
  },

  // Buttons
  button: {
    fontFamily: Fonts.semibold,
    fontSize: 16,
  },
  buttonSmall: {
    fontFamily: Fonts.semibold,
    fontSize: 14,
  },
};

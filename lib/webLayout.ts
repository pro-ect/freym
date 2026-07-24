// Web renders in a centered phone-like column instead of stretching across
// the browser. Screens inside #root are capped by CSS (app/_layout.tsx);
// RN Modals portal OUTSIDE #root, so modal content sizes itself off
// getScreenWidth() instead of the raw viewport width.
import { Dimensions, Platform } from 'react-native';

export const WEB_MAX_WIDTH = 520;

export function getScreenWidth(): number {
  const { width } = Dimensions.get('window');
  return Platform.OS === 'web' ? Math.min(width, WEB_MAX_WIDTH) : width;
}

export function getScreenHeight(): number {
  return Dimensions.get('window').height;
}

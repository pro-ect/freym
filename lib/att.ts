import { Platform } from 'react-native';
import {
  getTrackingPermissionsAsync,
  requestTrackingPermissionsAsync,
  PermissionStatus,
} from 'expo-tracking-transparency';

export type ATTStatus = 'granted' | 'denied' | 'undetermined' | 'unsupported';

export async function getATTStatus(): Promise<ATTStatus> {
  if (Platform.OS !== 'ios') return 'unsupported';
  try {
    const { status } = await getTrackingPermissionsAsync();
    if (status === PermissionStatus.GRANTED) return 'granted';
    if (status === PermissionStatus.UNDETERMINED) return 'undetermined';
    return 'denied';
  } catch (e) {
    console.warn('[ATT] getTrackingPermissionsAsync failed:', e);
    return 'undetermined';
  }
}

export async function requestATT(): Promise<ATTStatus> {
  if (Platform.OS !== 'ios') return 'unsupported';
  try {
    const { status } = await requestTrackingPermissionsAsync();
    if (status === PermissionStatus.GRANTED) return 'granted';
    if (status === PermissionStatus.UNDETERMINED) return 'undetermined';
    return 'denied';
  } catch (e) {
    console.warn('[ATT] requestTrackingPermissionsAsync failed:', e);
    return 'denied';
  }
}

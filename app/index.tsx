import { Redirect } from 'expo-router';

export default function Index() {
  // Inspire is the first tab in the current 5-tab layout; `home` is archived.
  return <Redirect href="/(tabs)/inspire" />;
}

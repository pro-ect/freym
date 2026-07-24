import * as FileSystem from 'expo-file-system';

export async function ensureAssetsLocal(uris: string[]): Promise<void> {
  await Promise.all(
    uris.map(async (uri) => {
      try {
        await FileSystem.getInfoAsync(uri);
      } catch {
      }
    })
  );
}

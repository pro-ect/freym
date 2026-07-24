/**
 * Image Utility Functions
 *
 * Helper functions for working with images
 */

import { Image } from 'react-native';
import * as ImageManipulator from 'expo-image-manipulator';

export interface ImageDimensions {
  width: number;
  height: number;
  aspectRatio: string;
}

/**
 * Get image dimensions from URI
 * @param uri - Image URI (local or remote)
 * @returns Image dimensions with aspect ratio
 */
export const getImageDimensions = async (uri: string): Promise<ImageDimensions> => {
  return new Promise((resolve, reject) => {
    Image.getSize(
      uri,
      (width, height) => {
        const gcd = (a: number, b: number): number => b === 0 ? a : gcd(b, a % b);
        const divisor = gcd(width, height);
        const aspectRatio = `${width / divisor}:${height / divisor}`;

        resolve({ width, height, aspectRatio });
      },
      (error) => {
        reject(error);
      }
    );
  });
};

/**
 * Get file size from base64 string
 * @param base64 - Base64 encoded image
 * @returns Size in bytes
 */
export const getBase64Size = (base64: string): number => {
  const stringLength = base64.length - 'data:image/png;base64,'.length;
  const sizeInBytes = 4 * Math.ceil(stringLength / 3) * 0.5624896334383812;
  return Math.round(sizeInBytes);
};

/**
 * Format bytes to human readable size
 * @param bytes - Size in bytes
 * @returns Formatted string (e.g., "1.5 MB")
 */
export const formatBytes = (bytes: number): string => {
  if (bytes === 0) return '0 Bytes';

  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
};

/**
 * Get comprehensive image metadata
 * @param uri - Image URI
 * @returns Complete image metadata
 */
export const getImageMetadata = async (uri: string) => {
  try {
    const dimensions = await getImageDimensions(uri);

    // Try to get file info if it's a local file
    let fileSize: number | undefined;
    if (uri.startsWith('file://')) {
      try {
        const FileSystem = await import('expo-file-system/legacy');
        const fileInfo = await FileSystem.getInfoAsync(uri);
        if (fileInfo.exists && !fileInfo.isDirectory) {
          fileSize = fileInfo.size;
        }
      } catch (fileError) {
        console.warn('Could not get file size:', fileError);
        // File size is optional, continue without it
      }
    }

    return {
      ...dimensions,
      fileSize,
      fileSizeFormatted: fileSize ? formatBytes(fileSize) : undefined,
    };
  } catch (error) {
    console.error('Error getting image metadata:', error);
    return null;
  }
};

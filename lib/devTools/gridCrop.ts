import * as ImageManipulator from 'expo-image-manipulator';
import { Image } from 'react-native';

function getSize(uri: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    Image.getSize(uri, (width, height) => resolve({ width, height }), reject);
  });
}

/**
 * Slice an image into an N×N grid. Each cell is shrunk by `safeAreaPct` on every
 * side (default 3%) so a thin border around the grid lines is dropped — hides
 * white-space inconsistency at cell boundaries when the source isn't perfectly
 * divisible. The right column and bottom row absorb any pixel remainder so the
 * full image is covered before the inset is applied.
 */
export interface GridCropTile {
  uri: string;
  width: number;
  height: number;
}

export async function runGridCrop(
  uri: string,
  n: 2 | 3,
  safeAreaPct: number = 0.03,
): Promise<GridCropTile[]> {
  const { width, height } = await getSize(uri);

  const baseCellW = Math.floor(width / n);
  const baseCellH = Math.floor(height / n);
  const colWs = Array.from({ length: n }, (_, c) =>
    c === n - 1 ? width - baseCellW * (n - 1) : baseCellW,
  );
  const rowHs = Array.from({ length: n }, (_, r) =>
    r === n - 1 ? height - baseCellH * (n - 1) : baseCellH,
  );
  const colXs = Array.from({ length: n }, (_, c) => baseCellW * c);
  const rowYs = Array.from({ length: n }, (_, r) => baseCellH * r);

  const out: GridCropTile[] = [];
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const cellW = colWs[c];
      const cellH = rowHs[r];
      const insetX = safeAreaPct > 0 ? Math.max(1, Math.round(cellW * safeAreaPct)) : 0;
      const insetY = safeAreaPct > 0 ? Math.max(1, Math.round(cellH * safeAreaPct)) : 0;
      const cropW = Math.max(1, cellW - 2 * insetX);
      const cropH = Math.max(1, cellH - 2 * insetY);

      const result = await ImageManipulator.manipulateAsync(
        uri,
        [
          {
            crop: {
              originX: colXs[c] + insetX,
              originY: rowYs[r] + insetY,
              width: cropW,
              height: cropH,
            },
          },
        ],
        { compress: 1, format: ImageManipulator.SaveFormat.JPEG },
      );
      out.push({ uri: result.uri, width: cropW, height: cropH });
    }
  }
  return out;
}

/**
 * 上傳前的瀏覽器端縮圖：學生常直接選照相館原檔（2 MB 以上很常見），
 * 在送出前縮到可負擔的大小並轉成 JPEG，順帶把 EXIF（含拍攝地點）留在瀏覽器。
 *
 * 只用瀏覽器原生 API，不引入任何相依套件。
 */

/** 目標長邊：證件照列印需求 450 × 600 之上留足夠倍數 */
const TARGET_LONG_EDGE = 1600;

/** 依序嘗試的（長邊、JPEG 品質）組合，直到結果檔案小於上限 */
const ATTEMPTS: { longEdge: number; quality: number }[] = [
  { longEdge: TARGET_LONG_EDGE, quality: 0.87 },
  { longEdge: TARGET_LONG_EDGE, quality: 0.75 },
  { longEdge: 1200, quality: 0.8 },
  { longEdge: 1000, quality: 0.75 },
  { longEdge: 900, quality: 0.7 },
];

async function decodeBitmap(file: File): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    // 舊瀏覽器不支援 imageOrientation 選項：退回不帶選項的解碼
    return await createImageBitmap(file);
  }
}

function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
}

/**
 * 把學生選的檔案縮成符合上限的 JPEG。
 * 若原本就已經夠小，仍會重新編碼一次（確保格式一致並移除 EXIF）。
 *
 * @throws 無法解碼時拋出可直接顯示給使用者的中文訊息。
 */
export async function prepareStudentPhotoFile(file: File, maxBytes: number): Promise<File> {
  if (file.size <= 0) throw new Error("照片不可為空");

  const bitmap = await decodeBitmap(file).catch(() => null);
  if (!bitmap) throw new Error("無法讀取這張照片，請改用其他 JPG 檔案");

  try {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) throw new Error("瀏覽器不支援圖片處理，請改用其他瀏覽器上傳");

    for (const { longEdge, quality } of ATTEMPTS) {
      const scale = Math.min(1, longEdge / Math.max(bitmap.width, bitmap.height));
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const blob = await toBlob(canvas, quality);
      if (!blob) throw new Error("瀏覽器無法產生照片，請改用其他 JPG 檔案");
      if (blob.size <= maxBytes) {
        const baseName = file.name.replace(/\.[^.]+$/, "") || "photo";
        return new File([blob], `${baseName}.jpg`, { type: "image/jpeg" });
      }
    }

    throw new Error("照片縮圖後仍超過上限，請改用解析度較低的照片");
  } finally {
    bitmap.close();
  }
}

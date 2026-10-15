/** Browser-only: reads a File and returns base64 (downscaled JPEG for images) plus a small thumbnail data URL. */
export async function prepareUpload(file: File, maxSide = 1600): Promise<{ base64: string; mediaType: string; thumbnail?: string }> {
  if (file.type === "application/pdf") {
    const buf = new Uint8Array(await file.arrayBuffer());
    let bin = "";
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return { base64: btoa(bin), mediaType: "application/pdf" };
  }
  const bitmap = await createImageBitmap(file);
  const encode = (side: number, quality: number) => {
    const scale = Math.min(1, side / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", quality);
  };
  const full = encode(maxSide, 0.85);
  return { base64: full.split(",")[1], mediaType: "image/jpeg", thumbnail: encode(480, 0.7) };
}

export async function fileFromUrl(url: string, name: string): Promise<File> {
  const blob = await (await fetch(url)).blob();
  return new File([blob], name, { type: blob.type || "image/jpeg" });
}

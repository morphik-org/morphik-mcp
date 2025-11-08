import sharp from "sharp";

const MAX_DIMENSION = 1568;
const MAX_MEGAPIXELS = 1.15 * 1_000_000; // Anthropic documented limit
const DEFAULT_MIME = "image/png";

const detectMimeType = async (buffer: Buffer): Promise<string> => {
  try {
    const metadata = await sharp(buffer).metadata();
    return metadata.format ? `image/${metadata.format}` : DEFAULT_MIME;
  } catch {
    return DEFAULT_MIME;
  }
};

export async function resizeImageIfNeeded(imageData: string): Promise<{ data: string; mimeType: string }> {
  const buffer = Buffer.from(imageData, "base64");

  try {
    const image = sharp(buffer);
    const metadata = await image.metadata();
    const width = metadata.width ?? 0;
    const height = metadata.height ?? 0;

    // If we can't read dimensions, just return as-is with detected MIME
    if (!width || !height) {
      return { data: imageData, mimeType: await detectMimeType(buffer) };
    }

    const pixels = width * height;
    if (width <= MAX_DIMENSION && height <= MAX_DIMENSION && pixels <= MAX_MEGAPIXELS) {
      return { data: imageData, mimeType: await detectMimeType(buffer) };
    }

    let newWidth = width;
    let newHeight = height;

    if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
      const aspectRatio = width / height;
      if (width >= height) {
        newWidth = MAX_DIMENSION;
        newHeight = Math.round(MAX_DIMENSION / aspectRatio);
      } else {
        newHeight = MAX_DIMENSION;
        newWidth = Math.round(MAX_DIMENSION * aspectRatio);
      }
    }

    const resizedPixels = newWidth * newHeight;
    if (resizedPixels > MAX_MEGAPIXELS) {
      const scaleFactor = Math.sqrt(MAX_MEGAPIXELS / resizedPixels);
      newWidth = Math.round(newWidth * scaleFactor);
      newHeight = Math.round(newHeight * scaleFactor);
    }

    const targetFormat =
      metadata.format && sharp.format[metadata.format] ? metadata.format : "png";

    const resizedBuffer = await sharp(buffer)
      .resize(newWidth, newHeight, { fit: "inside", withoutEnlargement: true })
      .toFormat(targetFormat as keyof sharp.FormatEnum)
      .toBuffer();

    return {
      data: resizedBuffer.toString("base64"),
      mimeType: `image/${targetFormat}`,
    };
  } catch (error) {
    console.warn("Image resizing failed, returning original image:", error);
    return { data: imageData, mimeType: await detectMimeType(buffer) };
  }
}

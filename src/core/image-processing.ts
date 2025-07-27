import sharp from "sharp";

// Maximum image size for Claude (in bytes) - slightly under 1MB to be safe
export const MAX_IMAGE_SIZE = 900 * 1024; // 900KB

/**
 * Resizes an image to ensure it's under the maximum size limit for Claude
 * @param imageData Base64-encoded image data
 * @returns Object with resized base64-encoded image data and MIME type
 */
export async function resizeImageIfNeeded(imageData: string): Promise<{ data: string; mimeType: string }> {
  // Convert base64 to buffer
  const buffer = Buffer.from(imageData, 'base64');
  
  // If image is already under the size limit, detect format and return it as is
  if (buffer.length <= MAX_IMAGE_SIZE) {
    try {
      const metadata = await sharp(buffer).metadata();
      const mimeType = metadata.format ? `image/${metadata.format}` : 'image/png';
      return { data: imageData, mimeType };
    } catch (error) {
      // If we can't detect format, assume PNG
      return { data: imageData, mimeType: 'image/png' };
    }
  }
  
  // Calculate resize factor based on current size
  const sizeFactor = Math.sqrt(MAX_IMAGE_SIZE / buffer.length);
  
  try {
    // Get image metadata
    const metadata = await sharp(buffer).metadata();
    
    // Calculate new dimensions, keeping aspect ratio
    const newWidth = Math.floor((metadata.width || 800) * sizeFactor);
    const newHeight = Math.floor((metadata.height || 600) * sizeFactor);
    
    console.error(`Resizing image from ${buffer.length} bytes (${metadata.width}x${metadata.height}) to target ${MAX_IMAGE_SIZE} bytes (${newWidth}x${newHeight})`);
    
    // Resize and optimize the image
    const resizedImageBuffer = await sharp(buffer)
      .resize(newWidth, newHeight)
      .webp({ quality: 80 }) // Use webp for better compression
      .toBuffer();
    
    console.error(`Resized image to ${resizedImageBuffer.length} bytes`);
    
    // If still too large, reduce quality further
    if (resizedImageBuffer.length > MAX_IMAGE_SIZE) {
      const qualityFactor = MAX_IMAGE_SIZE / resizedImageBuffer.length * 75; // Reduce quality proportionally
      
      const furtherResizedBuffer = await sharp(buffer)
        .resize(newWidth, newHeight)
        .webp({ quality: Math.floor(qualityFactor) })
        .toBuffer();
        
      console.error(`Further resized image to ${furtherResizedBuffer.length} bytes with quality ${Math.floor(qualityFactor)}`);
      
      return { data: furtherResizedBuffer.toString('base64'), mimeType: 'image/webp' };
    }
    
    return { data: resizedImageBuffer.toString('base64'), mimeType: 'image/webp' };
  } catch (error) {
    console.error("Error resizing image:", error);
    // Fall back to original image if resize fails - try to detect format
    try {
      const buffer = Buffer.from(imageData, 'base64');
      const metadata = await sharp(buffer).metadata();
      const mimeType = metadata.format ? `image/${metadata.format}` : 'image/png';
      return { data: imageData, mimeType };
    } catch {
      return { data: imageData, mimeType: 'image/png' };
    }
  }
}
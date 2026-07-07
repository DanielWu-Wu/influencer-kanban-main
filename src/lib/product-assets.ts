export type ProductMainImage = {
  fileName: string;
  mimeType: string;
  dataUrl: string;
  width?: number;
  height?: number;
};

export type ProductResourceData = {
  mainImage?: ProductMainImage;
  resourceNotes: string;
};

const PRODUCT_RESOURCE_PREFIX = '__PRODUCT_RESOURCE_V1__';
const MAX_SOURCE_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_COMPRESSED_DATA_URL_LENGTH = 1_600_000;

export function parseProductResources(value?: string): ProductResourceData {
  const raw = String(value || '');
  if (!raw.startsWith(PRODUCT_RESOURCE_PREFIX)) {
    return { resourceNotes: raw };
  }

  try {
    const parsed = JSON.parse(raw.slice(PRODUCT_RESOURCE_PREFIX.length).trim()) as ProductResourceData;
    return {
      mainImage: parsed.mainImage?.dataUrl ? parsed.mainImage : undefined,
      resourceNotes: String(parsed.resourceNotes || ''),
    };
  } catch {
    return { resourceNotes: raw };
  }
}

export function serializeProductResources(data: ProductResourceData) {
  const payload: ProductResourceData = {
    resourceNotes: data.resourceNotes || '',
    mainImage: data.mainImage,
  };
  return `${PRODUCT_RESOURCE_PREFIX}\n${JSON.stringify(payload)}`;
}

export function productResourcesForAi(value?: string) {
  const resources = parseProductResources(value);
  const lines = [
    resources.resourceNotes.trim(),
    resources.mainImage
      ? `产品主图：已上传（${resources.mainImage.fileName}），仅供人工预览，AI 不读取图片内容。`
      : '',
  ].filter(Boolean);
  return lines.join('\n');
}

export async function compressProductImage(file: File): Promise<ProductMainImage> {
  if (!file.type.startsWith('image/')) {
    throw new Error('请选择 PNG、JPG 或 WebP 等常见图片文件。');
  }
  if (file.size > MAX_SOURCE_IMAGE_BYTES) {
    throw new Error('图片文件太大，请选择 8MB 以内的产品图。');
  }
  if (typeof document === 'undefined') {
    throw new Error('当前环境不支持图片压缩，请在浏览器中上传。');
  }

  const image = await loadImage(file);
  const maxSide = 960;
  const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('图片处理失败，请换一张图片重试。');

  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);
  const dataUrl = canvas.toDataURL('image/jpeg', 0.78);
  URL.revokeObjectURL(image.src);

  if (dataUrl.length > MAX_COMPRESSED_DATA_URL_LENGTH) {
    throw new Error('图片压缩后仍然过大，请换一张更小的产品图。');
  }

  return {
    fileName: file.name,
    mimeType: 'image/jpeg',
    dataUrl,
    width,
    height,
  };
}

function loadImage(file: File) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('图片读取失败，请换一张图片重试。'));
    };
    image.src = url;
  });
}

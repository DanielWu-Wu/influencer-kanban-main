import { textToEmailHtml } from '@/lib/email-content';
import { parseProductResources, type ProductMainImage } from '@/lib/product-assets';
import type { Product } from '@/lib/types';

export type OutreachEmailProductAsset = {
  name: string;
  model: string;
  productUrl: string;
  mainImage?: ProductMainImage;
};

export type OutreachInlineImage = {
  contentId: string;
  fileName: string;
  mimeType: string;
  dataUrl: string;
};

const PRODUCT_IMAGE_CONTENT_ID = 'product-main-image';

export function selectedProductEmailAsset(products: Product[], targetProduct?: string): OutreachEmailProductAsset | null {
  const normalized = String(targetProduct || '').trim().toLowerCase();
  if (!normalized) return null;
  const product = products.find((item) => (
    item.status === 'active'
    && [item.name, item.model].some((value) => value.trim().toLowerCase() === normalized)
  ));
  if (!product) return null;
  const resources = parseProductResources(product.imageAndResourceLinks);
  return {
    name: product.name,
    model: product.model,
    productUrl: product.productUrl,
    mainImage: resources.mainImage,
  };
}

export function splitEmailParagraphs(body: string) {
  const normalized = String(body || '').replace(/\r\n/g, '\n').trim();
  if (!normalized) return [];
  return normalized.split(/\n{2,}/).map((paragraph) => paragraph.trim()).filter(Boolean);
}

export function getRecommendedImagePlacement(body: string, product?: OutreachEmailProductAsset | null) {
  const paragraphs = splitEmailParagraphs(body);
  if (!paragraphs.length) return 0;
  const terms = [product?.model, product?.name].map((value) => value?.trim()).filter(Boolean) as string[];
  const targetIndex = paragraphs.findIndex((paragraph) => (
    terms.some((term) => paragraph.toLowerCase().includes(term.toLowerCase()))
  ));
  return Math.min(paragraphs.length, (targetIndex >= 0 ? targetIndex : 0) + 1);
}

export function clampImagePlacement(placement: number | undefined, body: string, product?: OutreachEmailProductAsset | null) {
  const paragraphCount = splitEmailParagraphs(body).length;
  const fallback = getRecommendedImagePlacement(body, product);
  const numeric = Number.isFinite(placement) ? Number(placement) : fallback;
  return Math.max(0, Math.min(paragraphCount, Math.round(numeric)));
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function escapeHtmlAttribute(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function linkFirstProductMention(html: string, product?: OutreachEmailProductAsset | null) {
  const productUrl = product?.productUrl?.trim();
  if (!productUrl) return html;
  const terms = [
    [product?.name, product?.model].filter(Boolean).join(' '),
    product?.name,
    product?.model,
  ].map((value) => value?.trim()).filter((value): value is string => Boolean(value));
  const term = Array.from(new Set(terms)).sort((a, b) => b.length - a.length)[0];
  if (!term) return html;
  const pattern = new RegExp(escapeRegExp(term), 'i');
  let linked = false;
  let insideAnchor = false;
  return html.split(/(<[^>]+>)/g).map((part) => {
    if (!part) return part;
    if (part.startsWith('<')) {
      if (/^<a\b/i.test(part)) insideAnchor = true;
      if (/^<\/a\b/i.test(part)) insideAnchor = false;
      return part;
    }
    if (linked || insideAnchor) return part;
    return part.replace(pattern, (match) => {
      linked = true;
      return `<a href="${productUrl}" target="_blank" rel="noopener noreferrer">${match}</a>`;
    });
  }).join('');
}

export function buildProductImageHtml({
  src,
  product,
}: {
  src: string;
  product?: OutreachEmailProductAsset | null;
}) {
  const alt = escapeHtmlAttribute([product?.name, product?.model].filter(Boolean).join(' ') || 'Product image');
  return [
    '<div data-product-image="true" draggable="true" style="margin:18px 0;text-align:left;cursor:grab">',
    `<img src="${src}" alt="${alt}" draggable="false" style="display:block;width:100%;max-width:560px;height:auto;border-radius:8px;border:1px solid #e2e8f0" />`,
    '</div>',
  ].join('');
}

export function buildOutreachEmailHtml({
  body,
  product,
  imageSrc,
  imagePlacement,
  includeImage,
}: {
  body: string;
  product?: OutreachEmailProductAsset | null;
  imageSrc?: string;
  imagePlacement?: number;
  includeImage?: boolean;
}) {
  const paragraphs = splitEmailParagraphs(body);
  const placement = clampImagePlacement(imagePlacement, body, product);
  const shouldRenderImage = Boolean(includeImage && imageSrc && product?.mainImage);
  const parts: string[] = [];
  paragraphs.forEach((paragraph, index) => {
    if (shouldRenderImage && placement === index) parts.push(buildProductImageHtml({ src: imageSrc!, product }));
    parts.push(`<div>${textToEmailHtml(paragraph)}</div>`);
  });
  if (shouldRenderImage && placement === paragraphs.length) parts.push(buildProductImageHtml({ src: imageSrc!, product }));
  return linkFirstProductMention(parts.join('<br>'), product);
}

export function getProductInlineImage(product?: OutreachEmailProductAsset | null): OutreachInlineImage | undefined {
  if (!product?.mainImage?.dataUrl) return undefined;
  return {
    contentId: PRODUCT_IMAGE_CONTENT_ID,
    fileName: product.mainImage.fileName || 'product-main-image.jpg',
    mimeType: product.mainImage.mimeType || 'image/jpeg',
    dataUrl: product.mainImage.dataUrl,
  };
}

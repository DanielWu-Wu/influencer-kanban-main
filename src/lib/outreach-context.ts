import type { Prospect } from '@/lib/creator-prospecting';
import { parseProductResources, productResourcesForAi } from '@/lib/product-assets';
import type { Product } from '@/lib/types';

export type OutreachContextSettings = {
  brandName?: string;
  senderName?: string;
  emailSignature?: string;
  youtubeDefaultLanguage?: string;
};

export type OutreachAiContext = {
  channel: {
    contactName: string;
    title?: string;
    url: string;
    description?: string;
    country?: string;
    language?: string;
    subscriberCount?: number | null;
    videoCount?: number | null;
    viewCount?: number | null;
    recentAverageViews?: number | null;
    recentVideos: NonNullable<Prospect['recentVideos']>;
  };
  products: Array<{
    name: string;
    model: string;
    productUrl: string;
    sellingPoints: string;
    technicalSpecifications: string;
    imageAndResourceLinks: string;
    productImage: {
      hasMainImage: boolean;
      fileName: string;
      previewDataUrl?: string;
    };
    marketProfiles: Product['marketProfiles'];
  }>;
  targetProduct: string;
  cooperationType: string;
  cooperationIdea: string;
  priority: Prospect['priority'];
  brandName: string;
  senderName: string;
  emailSignature: string;
  preferredLanguage: string;
  userPreference: string;
};

function firstValue(...values: Array<string | undefined>) {
  return values.find((value) => Boolean(value?.trim()))?.trim() || '';
}

function selectedProductForAi(products: Product[], targetProduct?: string) {
  const normalizedTarget = String(targetProduct || '').trim().toLowerCase();
  if (!normalizedTarget) return [];
  const product = products.find((item) => (
    item.status === 'active'
    && [item.name, item.model].some((value) => value.trim().toLowerCase() === normalizedTarget)
  ));
  if (!product) return [];
  const resources = parseProductResources(product.imageAndResourceLinks);
  return [{
    name: product.name,
    model: product.model,
    productUrl: product.productUrl,
    sellingPoints: product.sellingPoints,
    technicalSpecifications: product.technicalSpecifications,
    imageAndResourceLinks: productResourcesForAi(product.imageAndResourceLinks),
    productImage: {
      hasMainImage: Boolean(resources.mainImage),
      fileName: resources.mainImage?.fileName || '',
      previewDataUrl: resources.mainImage?.dataUrl,
    },
    marketProfiles: product.marketProfiles,
  }];
}

export function stripOutreachPreviewData(context: OutreachAiContext): OutreachAiContext {
  return {
    ...context,
    products: context.products.map((product) => ({
      ...product,
      productImage: {
        hasMainImage: product.productImage.hasMainImage,
        fileName: product.productImage.fileName,
      },
    })),
  };
}

export function buildOutreachAiContext(
  prospect: Prospect,
  products: Product[],
  settings: OutreachContextSettings,
  userPreference: string,
): OutreachAiContext {
  return {
    channel: {
      contactName: prospect.contactName?.trim() || '',
      title: prospect.title,
      url: firstValue(prospect.url, prospect.sourceUrl, prospect.inputUrl),
      description: prospect.description,
      country: prospect.country,
      language: prospect.language,
      subscriberCount: prospect.subscriberCount,
      videoCount: prospect.videoCount,
      viewCount: prospect.viewCount,
      recentAverageViews: prospect.recentAverageViews,
      recentVideos: (prospect.recentVideos || []).slice(0, 8),
    },
    products: selectedProductForAi(products, prospect.targetProduct),
    targetProduct: prospect.targetProduct || '',
    cooperationType: prospect.cooperationType || '',
    cooperationIdea: prospect.cooperationIdea || '',
    priority: prospect.priority,
    brandName: settings.brandName || '',
    senderName: settings.senderName || '',
    emailSignature: settings.emailSignature || '',
    preferredLanguage: prospect.outreachLanguage || '',
    userPreference: userPreference.trim(),
  };
}

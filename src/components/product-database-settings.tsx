'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Archive,
  Box,
  ChevronDown,
  ChevronUp,
  CirclePause,
  ExternalLink,
  FileText,
  Globe2,
  ImageIcon,
  Info,
  Link2,
  Package,
  Pencil,
  Plus,
  Search,
  Store,
  Trash2,
  Upload,
  Users,
  WalletCards,
  X,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { generateId, useProducts } from '@/lib/data';
import {
  compressProductImage,
  parseProductResources,
  serializeProductResources,
  type ProductMainImage,
} from '@/lib/product-assets';
import type { Product, ProductMarketProfile, ProductStatus } from '@/lib/types';

type ProductFormData = Omit<Product, 'id' | 'createdAt' | 'updatedAt'>;
type ProductFormAssets = {
  mainImage?: ProductMainImage;
  resourceNotes: string;
};

const emptyMarketProfile = (): ProductMarketProfile => ({
  id: generateId(),
  targetMarket: '',
  siteName: '',
  localProductUrl: '',
  targetInfluencerType: '',
  promotionBudget: '',
  cooperationRequirements: '',
  mustMention: '',
  prohibitedContent: '',
  localAssetLinks: '',
});

const emptyProduct = (): ProductFormData => ({
  name: '',
  model: '',
  productUrl: '',
  sellingPoints: '',
  technicalSpecifications: '',
  imageAndResourceLinks: '',
  notes: '',
  status: 'active',
  marketProfiles: [emptyMarketProfile()],
});

const statusMeta: Record<ProductStatus, { label: string; className: string; icon: typeof Box }> = {
  active: {
    label: '推广中',
    className: 'border-emerald-200/80 bg-emerald-50/80 text-emerald-700',
    icon: Box,
  },
  paused: {
    label: '已暂停',
    className: 'border-amber-200/80 bg-amber-50/80 text-amber-700',
    icon: CirclePause,
  },
  archived: {
    label: '已归档',
    className: 'border-slate-200/80 bg-slate-50/80 text-slate-600',
    icon: Archive,
  },
};

interface ProductDatabaseSettingsProps {
  expanded: boolean;
  onToggle: () => void;
}

export function ProductDatabaseSettings({ expanded, onToggle }: ProductDatabaseSettingsProps) {
  const { products, loading, addProduct, updateProduct, deleteProduct } = useProducts();
  const [searchQuery, setSearchQuery] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [deletingProduct, setDeletingProduct] = useState<Product | null>(null);
  const [formData, setFormData] = useState<ProductFormData>(emptyProduct);
  const [formAssets, setFormAssets] = useState<ProductFormAssets>({ resourceNotes: '' });
  const [imageError, setImageError] = useState('');
  const [imageProcessing, setImageProcessing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const filteredProducts = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return products;

    return products.filter((product) => {
      const marketText = product.marketProfiles
        .map((market) => `${market.targetMarket} ${market.siteName} ${market.targetInfluencerType}`)
        .join(' ');
      const resources = parseProductResources(product.imageAndResourceLinks).resourceNotes;
      return `${product.name} ${product.model} ${product.sellingPoints} ${resources} ${marketText}`
        .toLowerCase()
        .includes(query);
    });
  }, [products, searchQuery]);

  const totalMarkets = products.reduce((total, product) => total + product.marketProfiles.length, 0);
  const activeProducts = products.filter((product) => product.status === 'active').length;

  useEffect(() => {
    if (!dialogOpen) {
      setEditingProduct(null);
      setFormData(emptyProduct());
      setFormAssets({ resourceNotes: '' });
      setAdvancedOpen(false);
      setImageError('');
      setImageProcessing(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }, [dialogOpen]);

  const openCreateDialog = () => {
    setEditingProduct(null);
    setFormData(emptyProduct());
    setFormAssets({ resourceNotes: '' });
    setAdvancedOpen(false);
    setDialogOpen(true);
  };

  const openEditDialog = (product: Product) => {
    const resources = parseProductResources(product.imageAndResourceLinks);
    setEditingProduct(product);
    setFormData({
      name: product.name,
      model: product.model,
      productUrl: product.productUrl,
      sellingPoints: product.sellingPoints,
      technicalSpecifications: product.technicalSpecifications,
      imageAndResourceLinks: product.imageAndResourceLinks,
      notes: product.notes,
      status: product.status,
      marketProfiles: product.marketProfiles.length
        ? product.marketProfiles.map((market) => ({ ...market }))
        : [emptyMarketProfile()],
    });
    setFormAssets({
      mainImage: resources.mainImage,
      resourceNotes: resources.resourceNotes,
    });
    setAdvancedOpen(Boolean(
      product.technicalSpecifications
      || product.notes
      || product.marketProfiles.length,
    ));
    setDialogOpen(true);
  };

  const updateMarket = (
    id: string,
    field: keyof Omit<ProductMarketProfile, 'id'>,
    value: string,
  ) => {
    setFormData((current) => ({
      ...current,
      marketProfiles: current.marketProfiles.map((market) =>
        market.id === id ? { ...market, [field]: value } : market,
      ),
    }));
  };

  const addMarket = () => {
    setFormData((current) => ({
      ...current,
      marketProfiles: [...current.marketProfiles, emptyMarketProfile()],
    }));
  };

  const removeMarket = (id: string) => {
    setFormData((current) => ({
      ...current,
      marketProfiles:
        current.marketProfiles.length === 1
          ? [emptyMarketProfile()]
          : current.marketProfiles.filter((market) => market.id !== id),
    }));
  };

  const handleImageSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setImageError('');
    setImageProcessing(true);
    try {
      const mainImage = await compressProductImage(file);
      setFormAssets((current) => ({ ...current, mainImage }));
    } catch (error) {
      setImageError(error instanceof Error ? error.message : '图片上传失败，请换一张图片重试。');
    } finally {
      setImageProcessing(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const normalizedData = {
      ...formData,
      name: formData.name.trim(),
      model: formData.model.trim(),
      productUrl: formData.productUrl.trim(),
      sellingPoints: formData.sellingPoints.trim(),
      technicalSpecifications: formData.technicalSpecifications.trim(),
      notes: formData.notes.trim(),
      imageAndResourceLinks: serializeProductResources({
        mainImage: formAssets.mainImage,
        resourceNotes: formAssets.resourceNotes.trim(),
      }),
      marketProfiles: formData.marketProfiles.filter((market) =>
        Object.entries(market).some(([key, value]) => key !== 'id' && value.trim()),
      ),
    };

    if (editingProduct) {
      updateProduct(editingProduct.id, normalizedData);
    } else {
      addProduct(normalizedData);
    }
    setDialogOpen(false);
  };

  return (
    <>
      <Card className="overflow-hidden rounded-lg border-white/65 bg-white/66 shadow-apple backdrop-blur-xl">
        <button type="button" onClick={onToggle} className="w-full text-left">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-4">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-cyan-500/10 ring-1 ring-cyan-500/10">
                  <Package className="h-4 w-4 text-cyan-600" />
                </div>
                <div className="min-w-0">
                  <CardTitle className="text-base">产品数据库</CardTitle>
                  <CardDescription className="mt-0.5 text-xs">
                    维护红人开发信会用到的产品链接、卖点和主图。
                  </CardDescription>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {products.length > 0 && (
                  <Badge variant="secondary" className="rounded-md bg-white/75 text-xs">
                    {products.length} 个产品
                  </Badge>
                )}
                {expanded ? (
                  <ChevronUp className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                )}
              </div>
            </div>
          </CardHeader>
        </button>

        {expanded && (
          <CardContent className="space-y-4 pt-0">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="gap-1 rounded-md border-white/70 bg-white/55 text-xs">
                  <Info className="h-3 w-3" />
                  当前保存到本地和云端产品表，不会改数据库结构
                </Badge>
                {products.length > 0 && (
                  <span className="text-xs text-muted-foreground">
                    {activeProducts} 个推广中 / {totalMarkets} 个高级市场配置
                  </span>
                )}
              </div>
              <Button type="button" size="sm" className="h-9 gap-1.5 rounded-lg shadow-apple" onClick={openCreateDialog}>
                <Plus className="h-4 w-4" />
                添加产品
              </Button>
            </div>

            {products.length > 0 && (
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="搜索产品、型号、卖点或市场资料..."
                  className="h-10 rounded-lg border-white/65 bg-white/75 pl-9"
                />
              </div>
            )}

            {loading ? (
              <div className="rounded-lg border border-white/60 bg-white/35 py-10 text-center text-sm text-muted-foreground">正在读取产品资料...</div>
            ) : products.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-white/70 bg-white/35 py-10 text-center">
                <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-lg bg-white/75 shadow-sm">
                  <Package className="h-6 w-6 text-muted-foreground" />
                </div>
                <p className="text-sm font-medium">还没有产品资料</p>
                <p className="mt-1 max-w-md text-xs leading-5 text-muted-foreground">
                  先添加一个产品页面链接、卖点描述和主图。之后生成开发信时，AI 会优先使用当前选中的产品资料。
                </p>
                <Button type="button" variant="outline" size="sm" className="mt-4 h-9 gap-1.5 rounded-lg border-white/70 bg-white/70" onClick={openCreateDialog}>
                  <Plus className="h-4 w-4" />
                  添加第一个产品
                </Button>
              </div>
            ) : filteredProducts.length === 0 ? (
              <div className="rounded-lg border border-white/60 bg-white/35 py-10 text-center text-sm text-muted-foreground">
                没有找到符合条件的产品
              </div>
            ) : (
              <div className="space-y-3">
                {filteredProducts.map((product) => {
                  const meta = statusMeta[product.status];
                  const StatusIcon = meta.icon;
                  const resources = parseProductResources(product.imageAndResourceLinks);
                  return (
                    <div key={product.id} className="flex flex-col gap-3 rounded-lg border border-white/65 bg-white/55 p-4 transition-colors hover:bg-white/75 lg:flex-row lg:items-start">
                      <div className="flex min-w-0 flex-1 gap-3">
                        <div className="flex h-20 w-28 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-white/70 bg-white/75">
                          {resources.mainImage ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={resources.mainImage.dataUrl} alt={`${product.name} 产品主图`} className="h-full w-full object-cover" />
                          ) : (
                            <ImageIcon className="h-6 w-6 text-muted-foreground" />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <h4 className="font-medium">{product.name}</h4>
                            {product.model && (
                              <span className="text-sm text-muted-foreground">{product.model}</span>
                            )}
                            <Badge variant="outline" className={meta.className}>
                              <StatusIcon className="mr-1 h-3 w-3" />
                              {meta.label}
                            </Badge>
                          </div>
                          {product.sellingPoints ? (
                            <p className="mt-1 line-clamp-2 text-sm leading-5 text-muted-foreground">
                              {product.sellingPoints}
                            </p>
                          ) : (
                            <p className="mt-1 text-sm text-amber-700">建议补充产品卖点，开发信会更个性化。</p>
                          )}
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {resources.resourceNotes && (
                              <Badge variant="secondary" className="rounded-md bg-white/75 font-normal">
                                有素材说明
                              </Badge>
                            )}
                            {product.marketProfiles.length > 0 && (
                              <Badge variant="secondary" className="rounded-md bg-white/75 font-normal">
                                {product.marketProfiles.length} 个高级市场配置
                              </Badge>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="flex shrink-0 items-center gap-1">
                        {product.productUrl && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 rounded-lg hover:bg-white/80"
                            title="打开产品链接"
                            onClick={() => window.open(product.productUrl, '_blank', 'noopener,noreferrer')}
                          >
                            <ExternalLink className="h-4 w-4" />
                          </Button>
                        )}
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 rounded-lg hover:bg-white/80"
                          title="编辑产品"
                          onClick={() => openEditDialog(product)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 rounded-lg text-muted-foreground hover:bg-white/80 hover:text-destructive"
                          title="删除产品"
                          onClick={() => setDeletingProduct(product)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        )}
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="glass-panel-strong flex max-h-[92vh] max-w-4xl flex-col gap-0 overflow-hidden rounded-lg border-white/65 p-0">
          <DialogHeader className="shrink-0 border-b border-white/60 bg-white/55 px-6 py-5">
            <DialogTitle>{editingProduct ? '编辑产品资料' : '添加产品资料'}</DialogTitle>
            <DialogDescription>
              日常只需要填写产品链接、卖点和主图；更细的市场资料可在高级资料里补充。
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-6 py-5">
              <section className="space-y-4">
                <div>
                  <h3 className="text-sm font-semibold">产品资料卡</h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    这些内容会和红人频道资料一起进入开发信生成流程。
                  </p>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <Field label="产品名称" required icon={Package}>
                    <Input
                      value={formData.name}
                      onChange={(event) => setFormData({ ...formData, name: event.target.value })}
                      placeholder="例如：Aferiy P280"
                      required
                      className="rounded-lg border-white/65 bg-white/75"
                    />
                  </Field>
                  <Field label="产品型号" icon={Box}>
                    <Input
                      value={formData.model}
                      onChange={(event) => setFormData({ ...formData, model: event.target.value })}
                      placeholder="例如：P280 / AF-P280"
                      className="rounded-lg border-white/65 bg-white/75"
                    />
                  </Field>
                </div>

                <div className="grid gap-4 md:grid-cols-[1fr_180px]">
                  <Field label="产品页面链接" icon={Link2}>
                    <Input
                      value={formData.productUrl}
                      onChange={(event) => setFormData({ ...formData, productUrl: event.target.value })}
                      placeholder="https://es.aferiy.com/products/..."
                      className="rounded-lg border-white/65 bg-white/75"
                    />
                  </Field>
                  <Field label="产品状态" icon={Archive}>
                    <Select
                      value={formData.status}
                      onValueChange={(value: ProductStatus) => setFormData({ ...formData, status: value })}
                    >
                      <SelectTrigger className="w-full rounded-lg border-white/65 bg-white/75">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="active">推广中</SelectItem>
                        <SelectItem value="paused">已暂停</SelectItem>
                        <SelectItem value="archived">已归档</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                </div>

                <Field label="产品描述卖点" icon={FileText}>
                  <Textarea
                    value={formData.sellingPoints}
                    onChange={(event) => setFormData({ ...formData, sellingPoints: event.target.value })}
                    placeholder="可以直接粘贴给红人看的卖点，例如服务、容量、性能、太阳能输入、APP、UPS、电池安全等..."
                    rows={8}
                    className="rounded-lg border-white/65 bg-white/75"
                  />
                </Field>

                <div className="grid gap-4 lg:grid-cols-[240px_minmax(0,1fr)]">
                  <div className="space-y-2">
                    <Label className="flex items-center gap-1.5 text-xs">
                      <ImageIcon className="h-3.5 w-3.5 text-muted-foreground" />
                      产品主图
                    </Label>
                    <div className="flex aspect-[4/3] items-center justify-center overflow-hidden rounded-lg border border-dashed border-white/75 bg-white/55">
                      {formAssets.mainImage ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={formAssets.mainImage.dataUrl} alt="产品主图预览" className="h-full w-full object-cover" />
                      ) : (
                        <div className="text-center text-xs text-muted-foreground">
                          <ImageIcon className="mx-auto mb-2 h-6 w-6" />
                          上传 1 张主图
                        </div>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        className="hidden"
                        onChange={handleImageSelect}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-9 flex-1 gap-1.5 rounded-lg border-white/70 bg-white/70"
                        disabled={imageProcessing}
                        onClick={() => fileInputRef.current?.click()}
                      >
                        <Upload className="h-4 w-4" />
                        {imageProcessing ? '处理中...' : formAssets.mainImage ? '更换图片' : '上传图片'}
                      </Button>
                      {formAssets.mainImage && (
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className="h-9 w-9 rounded-lg border-white/70 bg-white/70"
                          title="移除主图"
                          onClick={() => setFormAssets((current) => ({ ...current, mainImage: undefined }))}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                    <p className="text-xs leading-5 text-muted-foreground">
                      图片会压缩后保存到现有产品资料字段，适合 1 张主图预览。
                    </p>
                    {imageError && <p className="text-xs text-destructive">{imageError}</p>}
                  </div>

                  <Field label="图片/素材说明" icon={ImageIcon}>
                    <Textarea
                      value={formAssets.resourceNotes}
                      onChange={(event) => setFormAssets({ ...formAssets, resourceNotes: event.target.value })}
                      placeholder="可填写素材包链接、网盘链接、说明书链接，或提醒自己这张图适合哪个市场..."
                      rows={10}
                      className="rounded-lg border-white/65 bg-white/75"
                    />
                  </Field>
                </div>
              </section>

              <Separator />

              <section className="space-y-4">
                <button
                  type="button"
                  className="flex w-full items-center justify-between rounded-lg border border-white/65 bg-white/45 px-4 py-3 text-left"
                  onClick={() => setAdvancedOpen((current) => !current)}
                >
                  <div>
                    <h3 className="text-sm font-semibold">高级资料</h3>
                    <p className="mt-1 text-xs text-muted-foreground">
                      技术参数、内部备注、不同国家/站点的推广要求，平时可以不填。
                    </p>
                  </div>
                  {advancedOpen ? (
                    <ChevronUp className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                  )}
                </button>

                {advancedOpen && (
                  <div className="space-y-6">
                    <div className="grid gap-4 lg:grid-cols-2">
                      <Field label="技术参数" icon={FileText}>
                        <Textarea
                          value={formData.technicalSpecifications}
                          onChange={(event) =>
                            setFormData({ ...formData, technicalSpecifications: event.target.value })
                          }
                          placeholder="容量、功率、接口、尺寸、重量、充电时间等，可直接粘贴完整参数..."
                          rows={5}
                          className="rounded-lg border-white/65 bg-white/75"
                        />
                      </Field>
                      <Field label="内部备注" icon={FileText}>
                        <Textarea
                          value={formData.notes}
                          onChange={(event) => setFormData({ ...formData, notes: event.target.value })}
                          placeholder="库存、生命周期、内部负责人、价格底线等仅供团队参考的信息..."
                          rows={5}
                          className="rounded-lg border-white/65 bg-white/75"
                        />
                      </Field>
                    </div>

                    <div className="space-y-4">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <h4 className="text-sm font-semibold">市场与站点推广资料</h4>
                          <p className="mt-1 text-xs text-muted-foreground">
                            同一产品可以分别设置西班牙、荷兰等市场的链接、预算和合作要求。
                          </p>
                        </div>
                        <Button type="button" variant="outline" size="sm" className="h-9 gap-1.5 rounded-lg border-white/70 bg-white/65" onClick={addMarket}>
                          <Plus className="h-4 w-4" />
                          添加市场
                        </Button>
                      </div>

                      <div className="space-y-4">
                        {formData.marketProfiles.map((market, index) => (
                          <div key={market.id} className="overflow-hidden rounded-lg border border-white/65 bg-white/55">
                            <div className="flex items-center justify-between border-b border-white/60 bg-white/55 px-4 py-3">
                              <div className="flex items-center gap-2">
                                <Globe2 className="h-4 w-4 text-muted-foreground" />
                                <span className="text-sm font-medium">
                                  {market.targetMarket || market.siteName || `市场配置 ${index + 1}`}
                                </span>
                              </div>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 rounded-lg text-muted-foreground hover:bg-white/80 hover:text-destructive"
                                title="删除这个市场配置"
                                onClick={() => removeMarket(market.id)}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>

                            <div className="space-y-4 p-4">
                              <div className="grid gap-4 md:grid-cols-2">
                                <Field label="目标市场" icon={Globe2}>
                                  <Input
                                    value={market.targetMarket}
                                    onChange={(event) => updateMarket(market.id, 'targetMarket', event.target.value)}
                                    placeholder="例如：西班牙、荷兰、德国"
                                    className="rounded-lg border-white/65 bg-white/75"
                                  />
                                </Field>
                                <Field label="站点或项目名称" icon={Store}>
                                  <Input
                                    value={market.siteName}
                                    onChange={(event) => updateMarket(market.id, 'siteName', event.target.value)}
                                    placeholder="例如：Aferiy ES / 2026 夏季推广"
                                    className="rounded-lg border-white/65 bg-white/75"
                                  />
                                </Field>
                              </div>

                              <Field label="当地产品链接" icon={Link2}>
                                <Input
                                  value={market.localProductUrl}
                                  onChange={(event) => updateMarket(market.id, 'localProductUrl', event.target.value)}
                                  placeholder="该国家或站点对应的产品页面链接"
                                  className="rounded-lg border-white/65 bg-white/75"
                                />
                              </Field>

                              <div className="grid gap-4 lg:grid-cols-2">
                                <Field label="目标红人类型" icon={Users}>
                                  <Textarea
                                    value={market.targetInfluencerType}
                                    onChange={(event) =>
                                      updateMarket(market.id, 'targetInfluencerType', event.target.value)
                                    }
                                    placeholder="频道领域、粉丝量级、内容风格、受众和排除条件..."
                                    rows={4}
                                    className="rounded-lg border-white/65 bg-white/75"
                                  />
                                </Field>
                                <Field label="推广预算" icon={WalletCards}>
                                  <Textarea
                                    value={market.promotionBudget}
                                    onChange={(event) =>
                                      updateMarket(market.id, 'promotionBudget', event.target.value)
                                    }
                                    placeholder="例如：单条视频 500-1000 欧元，可接受产品置换..."
                                    rows={4}
                                    className="rounded-lg border-white/65 bg-white/75"
                                  />
                                </Field>
                              </div>

                              <Field label="合作要求" icon={FileText}>
                                <Textarea
                                  value={market.cooperationRequirements}
                                  onChange={(event) =>
                                    updateMarket(market.id, 'cooperationRequirements', event.target.value)
                                  }
                                  placeholder="视频形式、时长、交付物、发布时间、链接、折扣码、素材授权等..."
                                  rows={4}
                                  className="rounded-lg border-white/65 bg-white/75"
                                />
                              </Field>

                              <div className="grid gap-4 lg:grid-cols-2">
                                <Field label="必须提及的内容" icon={FileText}>
                                  <Textarea
                                    value={market.mustMention}
                                    onChange={(event) => updateMarket(market.id, 'mustMention', event.target.value)}
                                    placeholder="必须出现的卖点、演示场景、品牌名称、活动信息或免责声明..."
                                    rows={4}
                                    className="rounded-lg border-white/65 bg-white/75"
                                  />
                                </Field>
                                <Field label="禁止宣传的内容" icon={FileText}>
                                  <Textarea
                                    value={market.prohibitedContent}
                                    onChange={(event) =>
                                      updateMarket(market.id, 'prohibitedContent', event.target.value)
                                    }
                                    placeholder="不可使用的绝对化说法、竞品攻击、错误参数、安全风险表述等..."
                                    rows={4}
                                    className="rounded-lg border-white/65 bg-white/75"
                                  />
                                </Field>
                              </div>

                              <Field label="当地图片和资料链接" icon={ImageIcon}>
                                <Textarea
                                  value={market.localAssetLinks}
                                  onChange={(event) => updateMarket(market.id, 'localAssetLinks', event.target.value)}
                                  placeholder="当地语言素材、站点图片、价格表、活动页面等..."
                                  rows={3}
                                  className="rounded-lg border-white/65 bg-white/75"
                                />
                              </Field>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </section>
            </div>

            <DialogFooter className="shrink-0 border-t border-white/60 bg-white/65 px-6 py-4">
              <Button type="button" variant="outline" className="h-10 rounded-lg border-white/70 bg-white/70" onClick={() => setDialogOpen(false)}>
                取消
              </Button>
              <Button type="submit" className="h-10 rounded-lg shadow-apple">{editingProduct ? '保存修改' : '添加产品'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={Boolean(deletingProduct)}
        onOpenChange={(open) => {
          if (!open) setDeletingProduct(null);
        }}
      >
        <AlertDialogContent className="glass-panel-strong rounded-lg border-white/65">
          <AlertDialogHeader>
            <AlertDialogTitle>删除这条产品资料？</AlertDialogTitle>
            <AlertDialogDescription>
              将删除“{deletingProduct?.name}”以及它的高级市场配置。此操作无法撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => {
                if (deletingProduct) deleteProduct(deletingProduct.id);
                setDeletingProduct(null);
              }}
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function Field({
  label,
  required = false,
  icon: Icon,
  children,
}: {
  label: string;
  required?: boolean;
  icon: typeof Package;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label className="flex items-center gap-1.5 text-xs">
        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
        {label}
        {required && <span className="text-destructive">*</span>}
      </Label>
      {children}
    </div>
  );
}

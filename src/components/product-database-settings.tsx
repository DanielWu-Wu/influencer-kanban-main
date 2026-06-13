'use client';

import { useEffect, useMemo, useState } from 'react';
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
  Users,
  WalletCards,
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
import type { Product, ProductMarketProfile, ProductStatus } from '@/lib/types';

type ProductFormData = Omit<Product, 'id' | 'createdAt' | 'updatedAt'>;

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
    className: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    icon: Box,
  },
  paused: {
    label: '已暂停',
    className: 'border-amber-200 bg-amber-50 text-amber-700',
    icon: CirclePause,
  },
  archived: {
    label: '已归档',
    className: 'border-slate-200 bg-slate-50 text-slate-600',
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
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [deletingProduct, setDeletingProduct] = useState<Product | null>(null);
  const [formData, setFormData] = useState<ProductFormData>(emptyProduct);

  const filteredProducts = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return products;

    return products.filter((product) => {
      const marketText = product.marketProfiles
        .map((market) => `${market.targetMarket} ${market.siteName} ${market.targetInfluencerType}`)
        .join(' ');
      return `${product.name} ${product.model} ${product.sellingPoints} ${marketText}`
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
    }
  }, [dialogOpen]);

  const openCreateDialog = () => {
    setEditingProduct(null);
    setFormData(emptyProduct());
    setDialogOpen(true);
  };

  const openEditDialog = (product: Product) => {
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

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const normalizedData = {
      ...formData,
      name: formData.name.trim(),
      model: formData.model.trim(),
      productUrl: formData.productUrl.trim(),
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
      <Card className="overflow-hidden">
        <button type="button" onClick={onToggle} className="w-full text-left">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-4">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-cyan-500/10">
                  <Package className="h-4 w-4 text-cyan-600" />
                </div>
                <div className="min-w-0">
                  <CardTitle className="text-base">产品数据库</CardTitle>
                  <CardDescription className="mt-0.5 text-xs">
                    管理产品资料，以及不同国家和站点的推广要求
                  </CardDescription>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {products.length > 0 && (
                  <Badge variant="secondary" className="text-xs">
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
                <Badge variant="outline" className="gap-1 text-xs">
                  <Info className="h-3 w-3" />
                  当前保存在本机浏览器，后续可同步到飞书
                </Badge>
                {products.length > 0 && (
                  <span className="text-xs text-muted-foreground">
                    {activeProducts} 个推广中 · {totalMarkets} 个市场配置
                  </span>
                )}
              </div>
              <Button type="button" size="sm" className="gap-1.5" onClick={openCreateDialog}>
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
                  placeholder="搜索产品、型号、市场或目标红人..."
                  className="pl-9"
                />
              </div>
            )}

            {loading ? (
              <div className="py-10 text-center text-sm text-muted-foreground">正在读取产品资料...</div>
            ) : products.length === 0 ? (
              <div className="flex flex-col items-center justify-center border-y py-10 text-center">
                <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-lg bg-muted">
                  <Package className="h-6 w-6 text-muted-foreground" />
                </div>
                <p className="text-sm font-medium">还没有产品资料</p>
                <p className="mt-1 max-w-md text-xs leading-5 text-muted-foreground">
                  先录入产品卖点、参数和推广规则。之后 AI 起草开发信或谈判回复时，就能调用这些资料。
                </p>
                <Button type="button" variant="outline" size="sm" className="mt-4 gap-1.5" onClick={openCreateDialog}>
                  <Plus className="h-4 w-4" />
                  添加第一个产品
                </Button>
              </div>
            ) : filteredProducts.length === 0 ? (
              <div className="border-y py-10 text-center text-sm text-muted-foreground">
                没有找到符合条件的产品
              </div>
            ) : (
              <div className="divide-y border-y">
                {filteredProducts.map((product) => {
                  const meta = statusMeta[product.status];
                  const StatusIcon = meta.icon;
                  return (
                    <div key={product.id} className="flex flex-col gap-3 py-4 lg:flex-row lg:items-start">
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
                        {product.sellingPoints && (
                          <p className="mt-1 line-clamp-2 text-sm leading-5 text-muted-foreground">
                            {product.sellingPoints}
                          </p>
                        )}
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {product.marketProfiles.length > 0 ? (
                            product.marketProfiles.map((market) => (
                              <Badge key={market.id} variant="secondary" className="font-normal">
                                {market.targetMarket || market.siteName || '未命名市场'}
                                {market.targetMarket && market.siteName ? ` · ${market.siteName}` : ''}
                              </Badge>
                            ))
                          ) : (
                            <span className="text-xs text-muted-foreground">尚未设置目标市场</span>
                          )}
                        </div>
                      </div>

                      <div className="flex shrink-0 items-center gap-1">
                        {product.productUrl && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
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
                          className="h-8 w-8"
                          title="编辑产品"
                          onClick={() => openEditDialog(product)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-destructive"
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
        <DialogContent className="flex max-h-[92vh] max-w-5xl flex-col gap-0 overflow-hidden p-0">
          <DialogHeader className="shrink-0 border-b px-6 py-5">
            <DialogTitle>{editingProduct ? '编辑产品资料' : '添加产品资料'}</DialogTitle>
            <DialogDescription>
              可直接使用自然语言填写。市场推广资料支持为同一产品添加多个国家或站点。
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-6 py-5">
              <section className="space-y-4">
                <div>
                  <h3 className="text-sm font-semibold">产品基础资料</h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    这里填写不同市场都会共用的产品信息。
                  </p>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <Field label="产品名称" required icon={Package}>
                    <Input
                      value={formData.name}
                      onChange={(event) => setFormData({ ...formData, name: event.target.value })}
                      placeholder="例如：Aferiy 便携式储能电源"
                      required
                    />
                  </Field>
                  <Field label="产品型号" icon={Box}>
                    <Input
                      value={formData.model}
                      onChange={(event) => setFormData({ ...formData, model: event.target.value })}
                      placeholder="例如：P280 / Nomad 1800 Pro"
                    />
                  </Field>
                </div>

                <div className="grid gap-4 md:grid-cols-[1fr_220px]">
                  <Field label="通用产品链接" icon={Link2}>
                    <Input
                      value={formData.productUrl}
                      onChange={(event) => setFormData({ ...formData, productUrl: event.target.value })}
                      placeholder="https://..."
                    />
                  </Field>
                  <Field label="产品状态" icon={Archive}>
                    <Select
                      value={formData.status}
                      onValueChange={(value: ProductStatus) => setFormData({ ...formData, status: value })}
                    >
                      <SelectTrigger className="w-full">
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

                <div className="grid gap-4 lg:grid-cols-2">
                  <Field label="产品卖点" icon={FileText}>
                    <Textarea
                      value={formData.sellingPoints}
                      onChange={(event) => setFormData({ ...formData, sellingPoints: event.target.value })}
                      placeholder="用自然语言描述核心优势、适用场景、与竞品的差异..."
                      rows={5}
                    />
                  </Field>
                  <Field label="技术参数" icon={FileText}>
                    <Textarea
                      value={formData.technicalSpecifications}
                      onChange={(event) =>
                        setFormData({ ...formData, technicalSpecifications: event.target.value })
                      }
                      placeholder="容量、功率、接口、尺寸、重量、充电时间等，可直接粘贴完整参数..."
                      rows={5}
                    />
                  </Field>
                </div>

                <div className="grid gap-4 lg:grid-cols-2">
                  <Field label="图片和资料链接" icon={ImageIcon}>
                    <Textarea
                      value={formData.imageAndResourceLinks}
                      onChange={(event) =>
                        setFormData({ ...formData, imageAndResourceLinks: event.target.value })
                      }
                      placeholder="产品图片、说明书、媒体包、网盘资料等，每行一个链接或附上说明..."
                      rows={4}
                    />
                  </Field>
                  <Field label="内部备注" icon={FileText}>
                    <Textarea
                      value={formData.notes}
                      onChange={(event) => setFormData({ ...formData, notes: event.target.value })}
                      placeholder="记录库存、生命周期、内部负责人或其他仅供团队参考的信息..."
                      rows={4}
                    />
                  </Field>
                </div>
              </section>

              <Separator />

              <section className="space-y-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h3 className="text-sm font-semibold">市场与站点推广资料</h3>
                    <p className="mt-1 text-xs text-muted-foreground">
                      同一产品可分别设置西班牙、荷兰等市场的链接、预算和合作要求。
                    </p>
                  </div>
                  <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={addMarket}>
                    <Plus className="h-4 w-4" />
                    添加市场
                  </Button>
                </div>

                <div className="space-y-4">
                  {formData.marketProfiles.map((market, index) => (
                    <div key={market.id} className="rounded-md border">
                      <div className="flex items-center justify-between border-b bg-muted/30 px-4 py-3">
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
                          className="h-8 w-8 text-muted-foreground hover:text-destructive"
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
                            />
                          </Field>
                          <Field label="站点或项目名称" icon={Store}>
                            <Input
                              value={market.siteName}
                              onChange={(event) => updateMarket(market.id, 'siteName', event.target.value)}
                              placeholder="例如：Aferiy ES / 2026 夏季推广"
                            />
                          </Field>
                        </div>

                        <Field label="当地产品链接" icon={Link2}>
                          <Input
                            value={market.localProductUrl}
                            onChange={(event) => updateMarket(market.id, 'localProductUrl', event.target.value)}
                            placeholder="该国家或站点对应的产品页面链接"
                          />
                        </Field>

                        <div className="grid gap-4 lg:grid-cols-2">
                          <Field label="目标红人类型" icon={Users}>
                            <Textarea
                              value={market.targetInfluencerType}
                              onChange={(event) =>
                                updateMarket(market.id, 'targetInfluencerType', event.target.value)
                              }
                              placeholder="描述频道领域、粉丝量级、内容风格、受众和排除条件..."
                              rows={4}
                            />
                          </Field>
                          <Field label="推广预算" icon={WalletCards}>
                            <Textarea
                              value={market.promotionBudget}
                              onChange={(event) =>
                                updateMarket(market.id, 'promotionBudget', event.target.value)
                              }
                              placeholder="例如：单条视频 500-1000 欧元，可接受产品置换；总预算约 8000 欧元..."
                              rows={4}
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
                          />
                        </Field>

                        <div className="grid gap-4 lg:grid-cols-2">
                          <Field label="必须提及的内容" icon={FileText}>
                            <Textarea
                              value={market.mustMention}
                              onChange={(event) => updateMarket(market.id, 'mustMention', event.target.value)}
                              placeholder="必须出现的卖点、演示场景、品牌名称、活动信息或免责声明..."
                              rows={4}
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
                            />
                          </Field>
                        </div>

                        <Field label="当地图片和资料链接" icon={ImageIcon}>
                          <Textarea
                            value={market.localAssetLinks}
                            onChange={(event) => updateMarket(market.id, 'localAssetLinks', event.target.value)}
                            placeholder="当地语言素材、站点图片、价格表、活动页面等..."
                            rows={3}
                          />
                        </Field>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            </div>

            <DialogFooter className="shrink-0 border-t bg-background px-6 py-4">
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                取消
              </Button>
              <Button type="submit">{editingProduct ? '保存修改' : '添加产品'}</Button>
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
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除这条产品资料？</AlertDialogTitle>
            <AlertDialogDescription>
              将删除“{deletingProduct?.name}”及其全部市场推广配置。此操作无法撤销。
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

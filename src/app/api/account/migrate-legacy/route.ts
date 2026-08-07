import { NextRequest, NextResponse } from 'next/server';
import { USER_DATA_KEYS, type UserDataKey } from '@/lib/account-data-keys';
import { createAdminServerClient, getRequestAdmin } from '@/lib/supabase/server';

const LEGACY_USER_DATA_MAP: Record<string, UserDataKey> = {
  'influencer-board-influencers': USER_DATA_KEYS.INFLUENCERS,
  'influencer-board-templates': USER_DATA_KEYS.TEMPLATES,
  'influencer-board-reminders': USER_DATA_KEYS.REMINDERS,
  'influencer-board-emails': USER_DATA_KEYS.EMAILS,
  'influencer-board-collaborations': USER_DATA_KEYS.COLLABORATIONS,
  'influencer-board-todos': USER_DATA_KEYS.TODOS,
  'influencer-board-calendar-events': USER_DATA_KEYS.CALENDAR_EVENTS,
  'gmail-threads': USER_DATA_KEYS.GMAIL_THREADS,
  'gmail-translations': USER_DATA_KEYS.GMAIL_TRANSLATIONS,
  'gmail-drafts': USER_DATA_KEYS.GMAIL_DRAFTS,
  'gmail-ai-suggestions': USER_DATA_KEYS.GMAIL_AI_SUGGESTIONS,
  'influencer-board-daily-gmail-summaries-v1': USER_DATA_KEYS.DAILY_GMAIL_SUMMARIES,
  'influencer-board-daily-gmail-completions-v1': USER_DATA_KEYS.DAILY_GMAIL_COMPLETIONS,
  'influencer-board-daily-gmail-tasks-v2': USER_DATA_KEYS.DAILY_GMAIL_TASKS,
  'influencer-board-creator-prospects-deleted': USER_DATA_KEYS.DELETED_CREATOR_PROSPECTS,
};

const LEGACY_RECORD_KEYS = new Set([
  'influencer-board-daily-gmail-summaries-v1',
  'influencer-board-daily-gmail-completions-v1',
  'influencer-board-daily-gmail-tasks-v2',
]);
const ALLOWED_LEGACY_KEYS = new Set([
  ...Object.keys(LEGACY_USER_DATA_MAP),
  'influencer-board-products',
  'influencer-board-settings',
  'gmail-auth',
  'influencer-board-creator-prospects',
]);

function parseLegacyValue(value: string) {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function parseLegacyUserData(key: string, value: string) {
  const parsed = parseLegacyValue(value);
  if (LEGACY_RECORD_KEYS.has(key)) {
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error(`历史数据“${key}”格式异常，原数据已保留，请修复后重试。`);
    }
    return parsed;
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`历史数据“${key}”格式异常，原数据已保留，请修复后重试。`);
  }
  return parsed;
}

export async function POST(request: NextRequest) {
  const currentAdmin = await getRequestAdmin(request);
  if (!currentAdmin) return NextResponse.json({ error: '只有主管理员可以迁移历史数据。' }, { status: 403 });

  const body = await request.json().catch(() => ({})) as { legacy?: unknown };
  const legacy = body.legacy && typeof body.legacy === 'object'
    ? body.legacy as Record<string, unknown>
    : {};
  const allowedLegacy = Object.fromEntries(
    Object.entries(legacy).filter(([key, value]) => (
      ALLOWED_LEGACY_KEYS.has(key) && typeof value === 'string'
    )),
  ) as Record<string, string>;
  if (!Object.keys(allowedLegacy).length) {
    return NextResponse.json({ success: true, data: { migratedKeys: [] } });
  }

  try {
    const admin = createAdminServerClient();
    const now = new Date().toISOString();
    const expectedSecretKeys = new Set<string>();
    const migratedProductIds: string[] = [];
    const migratedProspectIds: string[] = [];
    let settingsMigrated = false;
    const saveSecretIfMissing = async (key: string, value: unknown) => {
      const { data: existing, error: readError } = await admin
        .from('user_secrets')
        .select('secret_key')
        .eq('user_id', currentAdmin.user.id)
        .eq('secret_key', key)
        .maybeSingle();
      if (readError) throw readError;
      if (!existing) {
        const { error } = await admin.from('user_secrets').upsert({
          user_id: currentAdmin.user.id,
          secret_key: key,
          secret_value: JSON.stringify(value),
          updated_at: now,
        });
        if (error) throw error;
      }
      expectedSecretKeys.add(key);
    };
    await saveSecretIfMissing(USER_DATA_KEYS.LEGACY_BACKUP, {
      capturedAt: now,
      values: allowedLegacy,
    });
    const rows = Object.entries(LEGACY_USER_DATA_MAP)
      .filter(([legacyKey]) => allowedLegacy[legacyKey] !== undefined)
      .map(([legacyKey, dataKey]) => ({
        user_id: currentAdmin.user.id,
        data_key: dataKey,
        data: parseLegacyUserData(legacyKey, allowedLegacy[legacyKey]),
        updated_at: now,
      }));
    if (rows.length) {
      const { error: rowsError } = await admin.from('user_data').upsert(rows);
      if (rowsError) throw rowsError;
    }

    const legacySettings = allowedLegacy['influencer-board-settings'];
    if (legacySettings) {
      const parsed = parseLegacyValue(legacySettings);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const parsedSettings = parsed as Record<string, unknown>;
        const { data: existing } = await admin
          .from('app_settings')
          .select('data')
          .eq('user_id', currentAdmin.user.id)
          .maybeSingle();
        const data = {
          ...parsedSettings,
          ...((existing?.data && typeof existing.data === 'object') ? existing.data : {}),
        };
        delete data.customApiKey;
        delete data.gmailClientSecret;
        delete data.youtubeApiKey;
        const { error } = await admin.from('app_settings').upsert({
          user_id: currentAdmin.user.id,
          data,
          updated_at: now,
        });
        if (error) throw error;
        settingsMigrated = true;

        const legacyAiKey = typeof parsedSettings.customApiKey === 'string' ? parsedSettings.customApiKey.trim() : '';
        if (legacyAiKey && !/^•+$/.test(legacyAiKey)) {
          await saveSecretIfMissing('ai_api_key', legacyAiKey);
        }
        const legacyYouTubeKey = typeof parsedSettings.youtubeApiKey === 'string' ? parsedSettings.youtubeApiKey.trim() : '';
        if (legacyYouTubeKey) {
          await saveSecretIfMissing('youtube_api_key', legacyYouTubeKey);
        }
      } else {
        throw new Error('历史设置格式异常，原数据已保留，请修复后重试。');
      }
    }

    const legacyProducts = allowedLegacy['influencer-board-products'];
    if (legacyProducts) {
      const parsed = parseLegacyValue(legacyProducts);
      if (!Array.isArray(parsed)) {
        throw new Error('历史产品资料格式异常，原数据已保留，请修复后重试。');
      }
      const { data: existingProducts, error: existingProductsError } = await admin
        .from('products')
        .select('id')
        .eq('user_id', currentAdmin.user.id);
      if (existingProductsError) throw existingProductsError;
      if (parsed.length) {
        const productRows = parsed
          .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
          .map((product) => ({
            id: String(product.id || ''),
            user_id: currentAdmin.user.id,
            name: String(product.name || ''),
            model: String(product.model || ''),
            product_url: String(product.productUrl || ''),
            selling_points: String(product.sellingPoints || ''),
            technical_specifications: String(product.technicalSpecifications || ''),
            image_and_resource_links: String(product.imageAndResourceLinks || ''),
            notes: String(product.notes || ''),
            status: product.status === 'paused' || product.status === 'archived' ? product.status : 'active',
            market_profiles: Array.isArray(product.marketProfiles) ? product.marketProfiles : [],
            created_at: String(product.createdAt || now),
            updated_at: String(product.updatedAt || now),
          }))
          .filter((product) => product.id && product.name);
        migratedProductIds.push(...productRows.map((product) => product.id));
        const existingIds = new Set((existingProducts || []).map((product) => product.id));
        const missingProductRows = productRows.filter((product) => !existingIds.has(product.id));
        if (missingProductRows.length) {
          const { error } = await admin.from('products').upsert(missingProductRows);
          if (error) throw error;
        }
      }
    }

    const legacyGmailAuth = allowedLegacy['gmail-auth'];
    if (legacyGmailAuth) {
      const parsed = parseLegacyValue(legacyGmailAuth);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('历史 Gmail 授权格式异常，原数据已保留，请修复后重试。');
      }
      if (
        'refreshToken' in parsed
        && typeof parsed.refreshToken === 'string'
        && parsed.refreshToken
      ) {
        await saveSecretIfMissing('gmail_auth', parsed);
      }
    }

    const legacyProspects = allowedLegacy['influencer-board-creator-prospects'];
    if (legacyProspects) {
      const parsed = parseLegacyValue(legacyProspects);
      if (!Array.isArray(parsed)) {
        throw new Error('历史红人开发资料格式异常，原数据已保留，请修复后重试。');
      }
      if (parsed.length) {
        const { data: existingProspects, error: existingProspectsError } = await admin
          .from('creator_prospects')
          .select('id,updated_at')
          .eq('user_id', currentAdmin.user.id);
        if (existingProspectsError) throw existingProspectsError;
        const existingUpdatedAt = new Map(
          (existingProspects || []).map((prospect) => [prospect.id, String(prospect.updated_at || '')]),
        );
        const prospectRows = parsed
          .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object' && item.id))
          .map((prospect) => ({
            id: String(prospect.id),
            user_id: currentAdmin.user.id,
            data: prospect,
            created_at: String(prospect.createdAt || now),
            updated_at: String(prospect.updatedAt || now),
          }));
        migratedProspectIds.push(...prospectRows.map((prospect) => prospect.id));
        const newerProspectRows = prospectRows.filter((prospect) => (
          !existingUpdatedAt.has(prospect.id)
          || prospect.updated_at > (existingUpdatedAt.get(prospect.id) || '')
        ));
        if (newerProspectRows.length) {
          const { error } = await admin.from('creator_prospects').upsert(newerProspectRows);
          if (error) throw error;
        }
      }
    }

    if (rows.length) {
      const { data: verified, error: verifyError } = await admin
        .from('user_data')
        .select('data_key')
        .eq('user_id', currentAdmin.user.id)
        .in('data_key', rows.map((row) => row.data_key));
      if (verifyError || (verified?.length || 0) !== rows.length) {
        throw verifyError || new Error('历史数据回读校验失败。');
      }
    }

    const { data: verifiedSecrets, error: secretVerifyError } = await admin
      .from('user_secrets')
      .select('secret_key')
      .eq('user_id', currentAdmin.user.id)
      .in('secret_key', Array.from(expectedSecretKeys));
    if (secretVerifyError || (verifiedSecrets?.length || 0) !== expectedSecretKeys.size) {
      throw secretVerifyError || new Error('历史私密数据回读校验失败。');
    }

    if (settingsMigrated) {
      const { data: verifiedSettings, error: settingsVerifyError } = await admin
        .from('app_settings')
        .select('user_id')
        .eq('user_id', currentAdmin.user.id)
        .maybeSingle();
      if (settingsVerifyError || !verifiedSettings) {
        throw settingsVerifyError || new Error('历史设置回读校验失败。');
      }
    }

    if (migratedProductIds.length) {
      const uniqueIds = Array.from(new Set(migratedProductIds));
      const { data: verifiedProducts, error: productVerifyError } = await admin
        .from('products')
        .select('id')
        .eq('user_id', currentAdmin.user.id)
        .in('id', uniqueIds);
      if (productVerifyError || (verifiedProducts?.length || 0) !== uniqueIds.length) {
        throw productVerifyError || new Error('历史产品资料回读校验失败。');
      }
    }

    if (migratedProspectIds.length) {
      const uniqueIds = Array.from(new Set(migratedProspectIds));
      const { data: verifiedProspects, error: prospectVerifyError } = await admin
        .from('creator_prospects')
        .select('id')
        .eq('user_id', currentAdmin.user.id)
        .in('id', uniqueIds);
      if (prospectVerifyError || (verifiedProspects?.length || 0) !== uniqueIds.length) {
        throw prospectVerifyError || new Error('历史红人开发资料回读校验失败。');
      }
    }

    const { error: profileError } = await admin
      .from('account_profiles')
      .update({ legacy_migrated_at: now, updated_at: now })
      .eq('user_id', currentAdmin.user.id);
    if (profileError) throw profileError;

    return NextResponse.json({
      success: true,
      data: { migratedKeys: Object.keys(allowedLegacy) },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '历史数据迁移失败。' },
      { status: 500 },
    );
  }
}

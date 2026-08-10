export type AIProviderPresetId = 'deepseek' | 'openai' | 'custom';

export type AIModelPreset = {
  id: string;
  label: string;
  description: string;
  recommended?: boolean;
};

export type AIProviderPreset = {
  id: AIProviderPresetId;
  label: string;
  description: string;
  apiUrl: string;
  models: AIModelPreset[];
  defaultModel: string;
};

export const AI_PROVIDER_PRESETS: Record<AIProviderPresetId, AIProviderPreset> = {
  deepseek: {
    id: 'deepseek',
    label: 'DeepSeek 官方',
    description: '自动配置官方接口，适合日常翻译和邮件生成。',
    apiUrl: 'https://api.deepseek.com/chat/completions',
    models: [
      {
        id: 'deepseek-v4-flash',
        label: 'DeepSeek V4 Flash',
        description: '速度快、成本较低，推荐日常使用。',
        recommended: true,
      },
      {
        id: 'deepseek-v4-pro',
        label: 'DeepSeek V4 Pro',
        description: '复杂判断能力更强，适合更高要求的任务。',
      },
    ],
    defaultModel: 'deepseek-v4-flash',
  },
  openai: {
    id: 'openai',
    label: 'OpenAI 官方',
    description: '自动配置 OpenAI Chat Completions 官方接口。',
    apiUrl: 'https://api.openai.com/v1/chat/completions',
    models: [
      {
        id: 'gpt-4.1-mini',
        label: 'GPT-4.1 mini',
        description: '速度和成本平衡，推荐日常邮件与翻译。',
        recommended: true,
      },
      {
        id: 'gpt-4.1',
        label: 'GPT-4.1',
        description: '理解与生成能力更强，适合复杂合作沟通。',
      },
      {
        id: 'gpt-4o-mini',
        label: 'GPT-4o mini',
        description: '兼容性较好，可用于常规文本任务。',
      },
    ],
    defaultModel: 'gpt-4.1-mini',
  },
  custom: {
    id: 'custom',
    label: '其他 OpenAI 兼容接口',
    description: '适用于第三方中转、区域服务或其他兼容平台。',
    apiUrl: '',
    models: [],
    defaultModel: '',
  },
};

export function inferAIProviderPreset(
  apiUrl: string | undefined,
  savedPreset?: string,
): AIProviderPresetId {
  if (savedPreset === 'deepseek' || savedPreset === 'openai' || savedPreset === 'custom') {
    return savedPreset;
  }

  const normalized = String(apiUrl || '').trim().toLowerCase();
  if (normalized.includes('api.deepseek.com')) return 'deepseek';
  if (normalized.includes('api.openai.com')) return 'openai';
  return 'custom';
}

export function applyAIProviderPreset(
  providerId: AIProviderPresetId,
  currentApiUrl: string,
  currentModelName: string,
  previousProviderId?: AIProviderPresetId,
) {
  const preset = AI_PROVIDER_PRESETS[providerId];
  if (providerId === 'custom') {
    return {
      apiUrl: currentApiUrl,
      modelName: currentModelName,
    };
  }

  const canKeepModel = previousProviderId === providerId
    && preset.models.some((model) => model.id === currentModelName.trim());

  return {
    apiUrl: preset.apiUrl,
    modelName: canKeepModel ? currentModelName.trim() : preset.defaultModel,
  };
}

export type AIConfigValidation = {
  apiUrl?: string;
  apiKey?: string;
  modelName?: string;
};

export function validateAIProviderConfig({
  apiUrl,
  modelName,
  hasApiKey,
}: {
  apiUrl: string;
  modelName: string;
  hasApiKey: boolean;
}): AIConfigValidation {
  const errors: AIConfigValidation = {};
  const trimmedUrl = apiUrl.trim();
  const trimmedModel = modelName.trim();

  if (!trimmedUrl) {
    errors.apiUrl = '请选择模型服务，或填写完整的 API 请求地址。';
  } else {
    try {
      const parsed = new URL(trimmedUrl);
      const isLocal = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
      if (parsed.protocol !== 'https:' && !(isLocal && parsed.protocol === 'http:')) {
        errors.apiUrl = 'API 地址必须使用 HTTPS；本机 localhost 调试可使用 HTTP。';
      } else if (!parsed.pathname.toLowerCase().includes('/chat/completions')) {
        errors.apiUrl = '这里需要完整请求地址，结尾通常为 /chat/completions。';
      }
    } catch {
      errors.apiUrl = 'API 地址格式不正确，请填写完整的 https:// 地址。';
    }
  }

  if (!hasApiKey) errors.apiKey = '请填写 API Key。';
  if (!trimmedModel) {
    errors.modelName = '请选择或填写模型名称。';
  } else if (/\s/.test(trimmedModel)) {
    errors.modelName = '模型名称中不能包含空格。';
  }

  return errors;
}

export function hasAIConfigErrors(errors: AIConfigValidation) {
  return Boolean(errors.apiUrl || errors.apiKey || errors.modelName);
}


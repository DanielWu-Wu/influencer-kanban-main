export type AgentFeishuRecord = {
  recordId: string;
  channelName: string;
  email: string;
  region: string;
  collaborationStatus: string;
  hasReply: string;
  progress: string;
  notes: string;
  fields: Record<string, string>;
};

export type AgentProductContext = {
  name: string;
  model: string;
  status: string;
  productUrl: string;
  sellingPoints: string;
  technicalSpecifications: string;
  notes: string;
  markets: Array<{
    targetMarket: string;
    siteName: string;
    promotionBudget: string;
    cooperationRequirements: string;
    mustMention: string;
    prohibitedContent: string;
  }>;
};

export type AgentGmailContext = {
  connected: boolean;
  recentThreads: Array<{
    subject: string;
    from: string;
    to: string;
    date: string;
  }>;
  contactHistories: Array<{
    email: string;
    messages: Array<{
      subject: string;
      from: string;
      to: string;
      date: string;
      body: string;
    }>;
  }>;
};

export type AgentActionField = {
  fieldName: string;
  fieldLabel?: string;
  value: string;
};

export type AgentAction = {
  id: string;
  type: 'update_feishu_record';
  recordId: string;
  influencerName: string;
  reason: string;
  fields: AgentActionField[];
};

export type AgentResponse = {
  reply: string;
  summaryBullets?: string[];
  actions: AgentAction[];
  needsConfirmation: boolean;
  warnings?: string[];
};

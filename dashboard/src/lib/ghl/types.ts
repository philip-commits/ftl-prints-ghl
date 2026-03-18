export interface GHLContact {
  id: string;
  name?: string;
  email?: string;
  phone?: string;
}

export interface GHLCustomField {
  id: string;
  fieldValueString?: string;
  fieldValueFiles?: Array<{ url: string; meta?: { name?: string; size?: number } }>;
}

export interface GHLOpportunity {
  id: string;
  contact: GHLContact;
  pipelineStageId: string;
  createdAt: string;
  lastStageChangeAt?: string;
  lastStatusChangeAt?: string;
  source?: string;
  monetaryValue?: number;
  customFields?: GHLCustomField[];
}

export interface ParsedLead {
  id: string;
  name: string;
  email: string;
  phone: string;
  contactId: string;
  stage: string;
  stageId: string;
  source: string;
  monetaryValue: number;
  days_created: number;
  days_in_stage: number;
  artwork?: string[];
  quantity?: string;
  project_details?: string;
  service_type?: string;
  budget?: string;
  sizes?: string;
}

export interface ConversationMeta {
  unreadCount: number;
  lastMessageDirection?: string;
  lastMessageDate?: string | number;
  lastMessageType?: string;
  lastOutboundMessageAction?: string;
  lastManualMessageDate?: string;
  conversationId?: string;
  outboundCount: number;
  lastOutboundCallDate?: string | number | null;
  lastOutboundSmsDate?: string | number | null;
  lastOutboundEmailDate?: string | number | null;
  notes: NoteEntry[];
  messages: MessageEntry[];
}

export interface NoteEntry {
  body: string;
  dateAdded: string;
}

export interface MessageEntry {
  direction: string;
  channel: string;
  body: string;
  date: string;
}

export interface EnrichedLead extends ParsedLead {
  isInternational: boolean;
  missingInfo: string[];
  waitingOnArtwork: boolean;
  hasArtwork: boolean;
  hasQuantity: boolean;
  hasSizes: boolean;
  hasProjectDetails: boolean;
  needsReply: boolean;
  lastMessageType: string | null;
  hasManualOutreach: boolean;
  daysSinceLastContact: number | null;
  daysSinceLastCall: number | null;
  daysSinceLastSms: number | null;
  daysSinceLastEmail: number | null;
  outboundCount: number;
  noConversation: boolean;
  conversationId: string | null;
  notes: NoteEntry[];
  conversationHistory: MessageEntry[];
  suggestedAction: string;
  suggestedPriority: string;
  hint: string;
  reactivated: boolean;
}

export interface ActionItem {
  id: number;
  priority: string;
  actionType: string;
  label: string;
  contactId: string;
  contactName: string;
  contactCompany?: string;
  contactEmail?: string;
  contactPhone?: string;
  opportunityId: string;
  stage: string;
  context: string;
  recommendation: string;
  conversationHistory: MessageEntry[];
  notes: NoteEntry[];
  messageType: string | null;
  subject?: string;
  message?: string;
  smsMessage?: string;
  noAnswerSms?: string;
  noAnswerSubject?: string;
  noAnswerEmail?: string;
  targetStageId?: string;
  international: boolean;
  reactivated: boolean;
  artwork?: string[];
}

export interface NoActionItem {
  contactName: string;
  stage: string;
  reason: string;
  opportunityId?: string;
}

export interface DashboardData {
  actions: ActionItem[];
  noAction: NoActionItem[];
  inactiveSummary: Record<string, number>;
  generatedAt: string;
}

export interface SentStatus {
  [key: string]: { status: string; ts: number };
}

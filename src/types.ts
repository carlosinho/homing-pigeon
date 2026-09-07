export type Account = {
  id: number;
  email: string;
  connected: 0 | 1;
  created_at: string;
  updated_at: string;
};

export type FetchJob = {
  id: number;
  account_id: number;
  query: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  total_estimate: number;
  discovered_count: number;
  processed_count: number;
  skipped_count: number;
  error: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
};

export type ActivityEvent = {
  id: number;
  account_id: number;
  event_type: 'messages_deleted';
  item_count: number;
  created_at: string;
};

export type MessageAttachment = {
  filename: string;
  mimeType: string;
  sizeBytes: number;
};

export type Message = {
  sender_email: string;
  subject: string;
  received_at: number;
  rfc_message_id: string;
  gmail_search: string;
  gmail_message_id: string;
  gmail_thread_id: string;
  size_bytes: number;
  attachment_count: number;
  attachment_bytes: number;
  attachments: MessageAttachment[];
};

export type Sender = {
  sender_email: string;
  message_count: number;
  total_size_bytes: number;
};

export type Domain = {
  sender_domain: string;
  message_count: number;
};

export type Page<T> = {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
};

export type MessagePage = Page<Message> & {
  inventoryTotal: number;
};

export interface UserItem {
  id: string;
  name: string;
  email?: string;
  role: string;
  autoApprove: boolean;
  maxRequests?: number;
  plexId?: string;
  jellyfinId?: string;
  avatar?: string;
  createdAt: string;
  _count: { requests: number };
}

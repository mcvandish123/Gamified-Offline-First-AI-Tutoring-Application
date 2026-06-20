import { Injectable, BadRequestException } from '@nestjs/common';
import { SupabaseService } from '../supabase.service';

@Injectable()
export class ModulesService {
  constructor(private supabase: SupabaseService) {}

  async getAllForUser(userId: string) {
    const client = this.supabase.getClient();

    const { data, error } = await client
      .from('modules')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) throw new BadRequestException(error.message);

    // Attach a chat_count to each module — derived from module_chats,
    // since modules itself doesn't store a count column.
    const moduleIds = (data ?? []).map((m) => m.id);

    if (moduleIds.length === 0) {
      return { success: true, modules: [] };
    }

    const { data: chatRows, error: chatError } = await client
      .from('module_chats')
      .select('module_id')
      .in('module_id', moduleIds);

    if (chatError) throw new BadRequestException(chatError.message);

    const countsByModule: Record<string, number> = {};
    for (const row of chatRows ?? []) {
      countsByModule[row.module_id] = (countsByModule[row.module_id] ?? 0) + 1;
    }

    const modulesWithCounts = (data ?? []).map((mod) => ({
      ...mod,
      chat_count: countsByModule[mod.id] ?? 0,
    }));

    return { success: true, modules: modulesWithCounts };
  }

  async createModule(userId: string, title: string) {
    const client = this.supabase.getClient();

    const { data, error } = await client
      .from('modules')
      .insert({
        user_id: userId,
        resource_id: null,
        title,
        summary: null,
        key_terms: null,
        difficulty: 'easy',
      })
      .select()
      .single();

    if (error) throw new BadRequestException(error.message);

    return { success: true, module: { ...data, chat_count: 0 } };
  }

  async deleteModule(userId: string, moduleId: string) {
    const client = this.supabase.getClient();

    const { error } = await client
      .from('modules')
      .delete()
      .eq('id', moduleId)
      .eq('user_id', userId);

    if (error) throw new BadRequestException(error.message);

    return { success: true, message: 'Module deleted' };
  }

  async getOne(userId: string, moduleId: string) {
    const client = this.supabase.getClient();

    const { data, error } = await client
      .from('modules')
      .select('*')
      .eq('id', moduleId)
      .eq('user_id', userId)
      .single();

    if (error) throw new BadRequestException(error.message);

    return { success: true, module: data };
  }

  // Chats
  async getChats(userId: string, moduleId: string) {
    const client = this.supabase.getClient();

    const { data, error } = await client
      .from('module_chats')
      .select('*')
      .eq('module_id', moduleId)
      .eq('user_id', userId)
      .order('created_at', { ascending: true });

    if (error) throw new BadRequestException(error.message);

    return { success: true, chats: data };
  }

  async syncChats(
    userId: string,
    moduleId: string,
    messages: {
      role: string;
      content: string;
      conversation_id: string;
      created_at?: string;
    }[],
  ) {
    const client = this.supabase.getClient();

    const rows = messages.map((m) => ({
      module_id: moduleId,
      conversation_id: m.conversation_id,
      user_id: userId,
      role: m.role,
      content: m.content,
      created_at: m.created_at ?? new Date().toISOString(),
    }));

    const { data, error } = await client
      .from('module_chats')
      .insert(rows)
      .select();

    if (error) throw new BadRequestException(error.message);

    return { success: true, synced: data };
  }

  // Conversations — named chat threads within a module, shown on the
  // "Recent Conversations" list (Library → Notebook → Chats tab).
  async getConversations(userId: string, moduleId: string) {
    const client = this.supabase.getClient();

    const { data: conversations, error } = await client
      .from('conversations')
      .select('*')
      .eq('module_id', moduleId)
      .eq('user_id', userId)
      .order('updated_at', { ascending: false });

    if (error) throw new BadRequestException(error.message);

    const conversationIds = (conversations ?? []).map((c) => c.id);

    if (conversationIds.length === 0) {
      return { success: true, conversations: [] };
    }

    // Pull every message for these conversations once, then derive each
    // conversation's preview (last message) and message count in memory —
    // cheaper than N round trips, one per conversation.
    const { data: messages, error: msgError } = await client
      .from('module_chats')
      .select('conversation_id, role, content, created_at')
      .in('conversation_id', conversationIds)
      .order('created_at', { ascending: true });

    if (msgError) throw new BadRequestException(msgError.message);

    const lastMessageByConv: Record<
      string,
      { content: string; created_at: string }
    > = {};
    const countByConv: Record<string, number> = {};

    for (const m of messages ?? []) {
      countByConv[m.conversation_id] =
        (countByConv[m.conversation_id] ?? 0) + 1;
      // messages are ascending, so the last one we see per conversation
      // is naturally the most recent — no extra sort needed.
      lastMessageByConv[m.conversation_id] = {
        content: m.content,
        created_at: m.created_at,
      };
    }

    const enriched = (conversations ?? []).map((c) => ({
      ...c,
      message_count: countByConv[c.id] ?? 0,
      last_message: lastMessageByConv[c.id]?.content ?? null,
      last_message_at: lastMessageByConv[c.id]?.created_at ?? c.created_at,
    }));

    return { success: true, conversations: enriched };
  }

  async createConversation(userId: string, moduleId: string, title: string) {
    const client = this.supabase.getClient();

    const now = new Date().toISOString();

    const { data, error } = await client
      .from('conversations')
      .insert({
        module_id: moduleId,
        user_id: userId,
        title,
        created_at: now,
        updated_at: now,
      })
      .select()
      .single();

    if (error) throw new BadRequestException(error.message);

    return { success: true, conversation: data };
  }

  async getConversationMessages(
    userId: string,
    moduleId: string,
    conversationId: string,
  ) {
    const client = this.supabase.getClient();

    const { data, error } = await client
      .from('module_chats')
      .select('*')
      .eq('module_id', moduleId)
      .eq('conversation_id', conversationId)
      .eq('user_id', userId)
      .order('created_at', { ascending: true });

    if (error) throw new BadRequestException(error.message);

    return { success: true, messages: data };
  }
}

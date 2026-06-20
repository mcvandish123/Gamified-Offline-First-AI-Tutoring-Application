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
    messages: { role: string; content: string; created_at?: string }[],
  ) {
    const client = this.supabase.getClient();

    const rows = messages.map((m) => ({
      module_id: moduleId,
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
}

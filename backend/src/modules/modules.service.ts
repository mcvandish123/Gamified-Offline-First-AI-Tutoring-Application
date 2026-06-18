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

    return { success: true, modules: data };
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

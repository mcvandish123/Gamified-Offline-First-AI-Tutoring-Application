import { Injectable, BadRequestException } from '@nestjs/common';
import { SupabaseService } from '../supabase.service';

@Injectable()
export class UsersService {
  constructor(private supabase: SupabaseService) {}

  async getProfile(userId: string) {
    const client = this.supabase.getClient();

    const { data, error } = await client
      .from('users')
      .select('id, email, username, avatar_url, created_at')
      .eq('id', userId)
      .single();

    if (error) throw new BadRequestException(error.message);

    return { success: true, user: data };
  }

  async updateProfile(userId: string, username?: string, avatarUrl?: string) {
    const client = this.supabase.getClient();

    const { data, error } = await client
      .from('users')
      .update({ username, avatar_url: avatarUrl })
      .eq('id', userId)
      .select()
      .single();

    if (error) throw new BadRequestException(error.message);

    return { success: true, user: data };
  }

  async getProgress(userId: string) {
    const client = this.supabase.getClient();

    const { data, error } = await client
      .from('user_progress')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (error) throw new BadRequestException(error.message);

    return { success: true, progress: data };
  }
}

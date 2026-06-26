import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

@Injectable()
export class SupabaseService {
  private client: SupabaseClient;

  constructor(private config: ConfigService) {
    this.client = createClient(
      this.config.get('SUPABASE_URL')!,
      this.config.get('SUPABASE_SERVICE_ROLE_KEY')!,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      },
    );
  }

  getClient(): SupabaseClient {
    return this.client;
  }

  private verifiedUsers = new Set<string>();

  async ensureUserExists(
    userId: string,
    email: string,
    username: string,
  ): Promise<void> {
    if (this.verifiedUsers.has(userId)) return;

    const client = this.getClient();

    // Check if profile exists
    const { data: profile } = await client
      .from('users')
      .select('id')
      .eq('id', userId)
      .maybeSingle();

    if (!profile) {
      console.log(
        `User profile for ${userId} (${email}) is missing. Auto-creating public.users row.`,
      );
      await client.from('users').insert({
        id: userId,
        email: email,
        username: username || email.split('@')[0],
      });
    }

    // Check if progress row exists
    const { data: progress } = await client
      .from('user_progress')
      .select('user_id')
      .eq('user_id', userId)
      .maybeSingle();

    if (!progress) {
      console.log(
        `User progress for ${userId} is missing. Auto-creating public.user_progress row.`,
      );
      await client.from('user_progress').insert({
        user_id: userId,
      });
    }

    this.verifiedUsers.add(userId);
  }
}

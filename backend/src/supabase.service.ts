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
        global: {
          headers: {
            Authorization: `Bearer ${this.config.get('SUPABASE_SERVICE_ROLE_KEY')}`,
          },
        },
      },
    );
  }

  getClient(): SupabaseClient {
    return this.client;
  }
}

import { Controller, Get, Query, Headers } from '@nestjs/common';
import { XpLogService } from './xp-log.service';
import { SupabaseService } from '../supabase.service';
import { extractUserPayload } from '../extract-user-id';

@Controller('xp-log')
export class XpLogController {
  constructor(
    private xpLogService: XpLogService,
    private supabase: SupabaseService,
  ) {}

  // Shared helper to resolve the authenticated user's id from the bearer token
  private async getUserId(authorization: string): Promise<string> {
    const payload = extractUserPayload(authorization);
    const userId = payload.sub;
    const email = payload.email || '';
    const username = payload.user_metadata?.username || '';
    await this.supabase.ensureUserExists(userId, email, username);
    return userId;
  }

  // GET /xp-log?days=30 — used to render the progress chart on the frontend
  @Get()
  async getRecent(
    @Headers('authorization') authorization: string,
    @Query('days') days?: string,
  ) {
    const userId = await this.getUserId(authorization);
    const parsedDays = days ? parseInt(days, 10) : 30;
    return this.xpLogService.getRecentForUser(userId, parsedDays);
  }
}

import { Controller, Get, Query, Headers } from '@nestjs/common';
import { XpLogService } from './xp-log.service';
import { SupabaseService } from '../supabase.service';

@Controller('xp-log')
export class XpLogController {
  constructor(
    private xpLogService: XpLogService,
    private supabase: SupabaseService,
  ) {}

  // Shared helper to resolve the authenticated user's id from the bearer token
  private async getUserId(authorization: string): Promise<string> {
    const token = authorization?.replace('Bearer ', '');
    const { data, error } = await this.supabase.getClient().auth.getUser(token);
    if (error) throw new Error('Unauthorized');
    return data.user.id;
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

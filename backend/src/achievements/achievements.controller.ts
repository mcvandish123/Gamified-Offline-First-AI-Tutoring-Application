import { Controller, Get, Headers } from '@nestjs/common';
import { AchievementsService } from './achievements.service';
import { SupabaseService } from '../supabase.service';
import { extractUserPayload } from '../extract-user-id';

@Controller('achievements')
export class AchievementsController {
  constructor(
    private achievementsService: AchievementsService,
    private supabase: SupabaseService,
  ) {}

  private async getUserId(authorization: string): Promise<string> {
    const payload = extractUserPayload(authorization);
    const userId = payload.sub;
    const email = payload.email || '';
    const username = payload.user_metadata?.username || '';
    await this.supabase.ensureUserExists(userId, email, username);
    return userId;
  }

  @Get()
  async getAll() {
    return this.achievementsService.getAll();
  }

  @Get('me')
  async getMine(@Headers('authorization') authorization: string) {
    const userId = await this.getUserId(authorization);
    return this.achievementsService.getUnlockedForUser(userId);
  }
}

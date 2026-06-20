import { Controller, Get, Headers } from '@nestjs/common';
import { AchievementsService } from './achievements.service';
import { SupabaseService } from '../supabase.service';

@Controller('achievements')
export class AchievementsController {
  constructor(
    private achievementsService: AchievementsService,
    private supabase: SupabaseService,
  ) {}

  private async getUserId(authorization: string): Promise<string> {
    const token = authorization?.replace('Bearer ', '');
    const { data, error } = await this.supabase.getClient().auth.getUser(token);
    if (error) throw new Error('Unauthorized');
    return data.user.id;
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

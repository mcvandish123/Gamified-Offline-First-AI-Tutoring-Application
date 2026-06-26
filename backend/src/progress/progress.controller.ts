import { Controller, Get, Patch, Body, Param, Headers } from '@nestjs/common';
import { ProgressService } from './progress.service';
import { SupabaseService } from '../supabase.service';
import { extractUserPayload } from '../extract-user-id';

class UpdateProgressDto {
  masteryScore!: number;
}

@Controller()
export class ProgressController {
  constructor(
    private progressService: ProgressService,
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

  @Get('modules/:moduleId/progress')
  async getForModule(
    @Headers('authorization') authorization: string,
    @Param('moduleId') moduleId: string,
  ) {
    const userId = await this.getUserId(authorization);
    return this.progressService.getForModule(userId, moduleId);
  }

  @Patch('modules/:moduleId/progress')
  async updateProgress(
    @Headers('authorization') authorization: string,
    @Param('moduleId') moduleId: string,
    @Body() body: UpdateProgressDto,
  ) {
    const userId = await this.getUserId(authorization);
    return this.progressService.updateProgress(
      userId,
      moduleId,
      body.masteryScore,
    );
  }
}

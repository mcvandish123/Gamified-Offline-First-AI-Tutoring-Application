import { Controller, Get, Patch, Body, Param, Headers } from '@nestjs/common';
import { ProgressService } from './progress.service';
import { SupabaseService } from '../supabase.service';

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
    const token = authorization?.replace('Bearer ', '');
    const { data, error } = await this.supabase.getClient().auth.getUser(token);
    if (error) throw new Error('Unauthorized');
    return data.user.id;
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

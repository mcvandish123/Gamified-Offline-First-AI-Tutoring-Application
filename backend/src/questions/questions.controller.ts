import { Controller, Get, Param, Headers } from '@nestjs/common';
import { QuestionsService } from './questions.service';
import { SupabaseService } from '../supabase.service';

@Controller()
export class QuestionsController {
  constructor(
    private questionsService: QuestionsService,
    private supabase: SupabaseService,
  ) {}

  private async getUserId(authorization: string): Promise<string> {
    const token = authorization?.replace('Bearer ', '');
    const { data, error } = await this.supabase.getClient().auth.getUser(token);
    if (error) throw new Error('Unauthorized');
    return data.user.id;
  }

  @Get('modules/:moduleId/questions')
  async getForModule(
    @Headers('authorization') authorization: string,
    @Param('moduleId') moduleId: string,
  ) {
    const userId = await this.getUserId(authorization);
    return this.questionsService.getForModule(userId, moduleId);
  }

  @Get('questions/:id')
  async getOne(
    @Headers('authorization') authorization: string,
    @Param('id') id: string,
  ) {
    const userId = await this.getUserId(authorization);
    return this.questionsService.getOne(userId, id);
  }
}

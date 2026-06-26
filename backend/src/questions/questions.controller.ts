import { Controller, Get, Post, Body, Param, Headers } from '@nestjs/common';
import { QuestionsService } from './questions.service';
import { SupabaseService } from '../supabase.service';
import { extractUserPayload } from '../extract-user-id';

class GenerateQuestionsDto {
  difficulty!: string;
  conversationId?: string;
}

@Controller()
export class QuestionsController {
  constructor(
    private questionsService: QuestionsService,
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

  @Post('modules/:moduleId/questions/generate')
  async generateQuestions(
    @Headers('authorization') authorization: string,
    @Param('moduleId') moduleId: string,
    @Body() body: GenerateQuestionsDto,
  ) {
    const userId = await this.getUserId(authorization);
    return this.questionsService.generateQuestionsForModule(
      userId,
      moduleId,
      body.difficulty,
      body.conversationId,
    );
  }
}


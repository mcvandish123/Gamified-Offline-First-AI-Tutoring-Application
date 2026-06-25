import { Controller, Get, Post, Body, Param, Headers } from '@nestjs/common';
import { FlashcardsService } from './flashcards.service';
import { SupabaseService } from '../supabase.service';

class RecordProgressDto {
  flashcardId!: string;
  wasCorrect!: boolean;
}

@Controller()
export class FlashcardsController {
  constructor(
    private flashcardsService: FlashcardsService,
    private supabase: SupabaseService,
  ) {}

  private async getUserId(authorization: string): Promise<string> {
    const token = authorization?.replace('Bearer ', '');
    const { data, error } = await this.supabase.getClient().auth.getUser(token);
    if (error) throw new Error('Unauthorized');
    return data.user.id;
  }

  @Get('modules/:moduleId/flashcards')
  async getForModule(
    @Headers('authorization') authorization: string,
    @Param('moduleId') moduleId: string,
  ) {
    const userId = await this.getUserId(authorization);
    return this.flashcardsService.getForModule(userId, moduleId);
  }

  @Post('flashcards/progress')
  async recordProgress(
    @Headers('authorization') authorization: string,
    @Body() body: RecordProgressDto,
  ) {
    const userId = await this.getUserId(authorization);
    return this.flashcardsService.recordProgress(
      userId,
      body.flashcardId,
      body.wasCorrect,
    );
  }

  @Post('modules/:moduleId/conversations/:conversationId/flashcards/generate')
  async generateFlashcards(
    @Headers('authorization') authorization: string,
    @Param('moduleId') moduleId: string,
    @Param('conversationId') conversationId: string,
  ) {
    const userId = await this.getUserId(authorization);
    return this.flashcardsService.generateFlashcardsFromConversation(
      userId,
      moduleId,
      conversationId,
    );
  }
}

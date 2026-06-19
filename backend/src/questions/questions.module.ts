import { Module } from '@nestjs/common';
import { QuestionsController } from './questions.controller';
import { QuestionsService } from './questions.service';
import { SupabaseService } from '../supabase.service';

@Module({
  controllers: [QuestionsController],
  providers: [QuestionsService, SupabaseService],
})
export class QuestionsModule {}

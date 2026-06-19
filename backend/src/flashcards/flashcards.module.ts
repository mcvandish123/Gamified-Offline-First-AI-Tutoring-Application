import { Module } from '@nestjs/common';
import { FlashcardsController } from './flashcards.controller';
import { FlashcardsService } from './flashcards.service';
import { SupabaseService } from '../supabase.service';

@Module({
  controllers: [FlashcardsController],
  providers: [FlashcardsService, SupabaseService],
})
export class FlashcardsModule {}

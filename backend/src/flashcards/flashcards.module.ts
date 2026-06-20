import { Module } from '@nestjs/common';
import { FlashcardsController } from './flashcards.controller';
import { FlashcardsService } from './flashcards.service';
import { SupabaseService } from '../supabase.service';
import { AchievementsModule } from '../achievements/achievements.module';
import { XpLogModule } from '../xp-log/xp-log.module';

@Module({
  imports: [AchievementsModule, XpLogModule],
  controllers: [FlashcardsController],
  providers: [FlashcardsService, SupabaseService],
})
export class FlashcardsModule {}

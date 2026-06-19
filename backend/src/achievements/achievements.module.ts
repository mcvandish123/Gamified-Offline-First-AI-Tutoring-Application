import { Module } from '@nestjs/common';
import { AchievementsController } from './achievements.controller';
import { AchievementsService } from './achievements.service';
import { SupabaseService } from '../supabase.service';

@Module({
  controllers: [AchievementsController],
  providers: [AchievementsService, SupabaseService],
  exports: [AchievementsService],
})
export class AchievementsModule {}

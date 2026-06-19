import { Module } from '@nestjs/common';
import { ProgressController } from './progress.controller';
import { ProgressService } from './progress.service';
import { SupabaseService } from '../supabase.service';
import { AchievementsModule } from '../achievements/achievements.module';
import { XpLogModule } from '../xp-log/xp-log.module'; //

@Module({
  imports: [AchievementsModule, XpLogModule],
  controllers: [ProgressController],
  providers: [ProgressService, SupabaseService],
})
export class ProgressModule {}

import { Module } from '@nestjs/common';
import { XpLogController } from './xp-log.controller';
import { XpLogService } from './xp-log.service';
import { SupabaseService } from '../supabase.service';

@Module({
  controllers: [XpLogController],
  providers: [XpLogService, SupabaseService],
  // Exported so other modules (flashcards, progress, future game module)
  // can inject XpLogService and log XP without duplicating this logic
  exports: [XpLogService],
})
export class XpLogModule {}

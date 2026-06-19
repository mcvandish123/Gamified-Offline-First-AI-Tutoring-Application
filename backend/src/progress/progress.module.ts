import { Module } from '@nestjs/common';
import { ProgressController } from './progress.controller';
import { ProgressService } from './progress.service';
import { SupabaseService } from '../supabase.service';

@Module({
  controllers: [ProgressController],
  providers: [ProgressService, SupabaseService],
})
export class ProgressModule {}

import { Module } from '@nestjs/common';
import { ModulesController } from './modules.controller';
import { ModulesService } from './modules.service';
import { SupabaseService } from '../supabase.service';

@Module({
  controllers: [ModulesController],
  providers: [ModulesService, SupabaseService],
})
export class ModulesModule {}
